/**
 * Mass assignment, parameter pollution, and interpretation mismatches between
 * input formats (CWE-915, CWE-235, CWE-176, WSTG-INJT-04, WSTG-INJT-20,
 * CAPEC-43, CAPEC-460, CAPEC-71, ASVS V1.5.3, V15.3.3, V15.3.7, RFC 7493).
 * SECURITY.md, "Mass assignment and parameter pollution" and "Input format
 * parity". Findings F-11, F-14, F-15, F-21, and F-22 in
 * audits/2026-09-18-form-parsing/REPORT.md.
 */
import { describe, expect, it } from "vite-plus/test";

import { consumers, get, json, multipart, reasonOf, schemas, urlencoded } from "./harness.ts";
import { installPrototypeGuard } from "./prototype-guard.ts";

installPrototypeGuard();

describe.each(consumers)("$name consumer", (consumer) => {
  describe("mass assignment (CWE-915, WSTG-INJT-20, ASVS V15.3.3)", () => {
    it("strips undeclared keys from the output", async () => {
      const outcome = await consumer.submit(
        urlencoded("name=Jane&isAdmin=true&role=admin&user[isAdmin]=true"),
        schemas.user,
      );
      expect(outcome).toEqual({ tag: "accepted", value: { name: "Jane" } });
    });

    it("strips undeclared keys from a JSON body", async () => {
      const outcome = await consumer.submit(json('{"name":"Jane","isAdmin":true}'), schemas.user);
      expect(outcome).toEqual({ tag: "accepted", value: { name: "Jane" } });
    });
  });

  describe("FormData duplicate keys (CWE-235, WSTG-INJT-04, ASVS V15.3.7)", () => {
    it("fails validation when a string field is sent twice", async () => {
      const outcome = await consumer.submit(urlencoded("name=user&name=admin"), schemas.user);
      expect(outcome.tag).toBe("invalid");
    });

    it("treats `role` and `[role]` as one field with two values (F-11)", async () => {
      const outcome = await consumer.submit(
        urlencoded("role=user&[role]=admin"),
        schemas.passthrough,
      );
      expect(outcome).toEqual({ tag: "accepted", value: { role: ["user", "admin"] } });
    });

    it("collects a nested duplicate key, and does not keep only the last value (F-15)", async () => {
      const body = "user.role=user&user.role=admin";
      expect(await consumer.submit(urlencoded(body), schemas.nestedRole)).toMatchObject({
        tag: "invalid",
      });
      expect(await consumer.submit(urlencoded(body), schemas.passthrough)).toEqual({
        tag: "accepted",
        value: { user: { role: ["user", "admin"] } },
      });
    });

    it("treats `items.0` and `items[0]` as one field with two values (F-15)", async () => {
      const outcome = await consumer.submit(
        urlencoded("items.0=user&items[0]=admin"),
        schemas.items,
      );
      expect(outcome.tag).toBe("invalid");
    });

    it("rejects a path under a field that was sent twice", async () => {
      for (const body of ["role=a&role=b&role.0=x", "a.b=1&a.b=2&a.b.2=x"]) {
        const outcome = await consumer.submit(urlencoded(body), schemas.passthrough);
        expect(reasonOf(outcome)).toBe("conflicting-path");
      }
    });

    it("rejects a key used as both a value and a container, in either order", async () => {
      for (const body of ["a=1&a.b=2", "a.b=2&a=1"]) {
        const outcome = await consumer.submit(urlencoded(body), schemas.passthrough);
        expect(reasonOf(outcome)).toBe("conflicting-path");
      }
    });
  });

  describe("JSON duplicate keys (CWE-235, RFC 7493 §2.3, F-14)", () => {
    it.each([
      '{"name":"a","role":"user","role":"admin"}',
      '{"name":"a","user":{"role":"user","role":"admin"}}',
      '{"name":"a","items":[{"k":1,"k":2}]}',
      // The same key after the JSON escape is decoded
      '{"name":"a","role":"user","r\\u006fle":"admin"}',
    ])("rejects %s", async (body) => {
      expect(reasonOf(await consumer.submit(json(body), schemas.withRole))).toBe("duplicate-key");
    });

    it("accepts the same key in different objects", async () => {
      const body = '{"name":"a","x":{"k":1},"y":{"k":2},"z":[{"k":1},{"k":2}]}';
      expect((await consumer.submit(json(body), schemas.user)).tag).toBe("accepted");
    });

    it("does not read a key inside a string value", async () => {
      const body = '{"name":"\\"name\\":1,","other":"{\\"name\\":2}"}';
      expect((await consumer.submit(json(body), schemas.user)).tag).toBe("accepted");
    });

    it("rejects the same data in both formats (parity, ASVS V1.5.3)", async () => {
      const form = await consumer.submit(
        urlencoded("name=a&role=user&role=admin"),
        schemas.withRole,
      );
      const body = await consumer.submit(
        json('{"name":"a","role":"user","role":"admin"}'),
        schemas.withRole,
      );
      expect(form.tag).not.toBe("accepted");
      expect(body.tag).not.toBe("accepted");
    });
  });

  describe("lone surrogates (CWE-176, RFC 7493 §2.1, F-21)", () => {
    it.each([
      '{"name":"\\ud800"}',
      '{"name":"a\\udc00b"}',
      '{"name":"a","qty\\ud800":1}',
      '{"name":"a","x":["\\udfaa"]}',
    ])("rejects %s", async (body) => {
      expect(reasonOf(await consumer.submit(json(body), schemas.user))).toBe("malformed-string");
    });

    it("rejects a lone surrogate in an already-parsed payload", async () => {
      expect(reasonOf(await consumer.submit({ name: "\ud800" }, schemas.user))).toBe(
        "malformed-string",
      );
    });

    it("accepts a valid surrogate pair", async () => {
      expect(await consumer.submit(json('{"name":"\\ud83d\\ude00"}'), schemas.user)).toEqual({
        tag: "accepted",
        value: { name: "😀" },
      });
    });

    it("never gives a FormData key or value a lone surrogate", async () => {
      const outcome = await consumer.submit(
        urlencoded("name=%ED%A0%80&k%ED%A0%80=1"),
        schemas.passthrough,
      );
      if (outcome.tag !== "accepted") throw new Error(`expected accepted, got ${outcome.tag}`);
      for (const [key, value] of Object.entries(outcome.value as Record<string, string>)) {
        expect(key.isWellFormed()).toBe(true);
        expect(value.isWellFormed()).toBe(true);
      }
    });
  });

  describe("request source (ASVS V15.3.7)", () => {
    it("reads only the body of a POST, never its query string", async () => {
      const request = urlencoded("name=a", "https://app.example/?role=admin");
      expect(await consumer.submit(request, schemas.withRole)).toEqual({
        tag: "accepted",
        value: { name: "a" },
      });
    });

    it("reads only the query string of a GET", async () => {
      expect(await consumer.submit(get("name=a&role=user"), schemas.withRole)).toEqual({
        tag: "accepted",
        value: { name: "a", role: "user" },
      });
    });

    it("does not read a text/plain body as JSON (JSON CSRF)", async () => {
      const outcome = await consumer.submit(json('{"name":"a"}', "text/plain"), schemas.user);
      expect(outcome.tag).not.toBe("accepted");
    });
  });

  describe("file names (CWE-22, WSTG-BUSL-08, RFC 7578 §4.2, F-22)", () => {
    it("keeps File.name as the client sent it, so the application must not use it as a path", async () => {
      const fd = new FormData();
      fd.append("upload", new File(["x"], "../../etc/p0"));
      const outcome = await consumer.submit(multipart(fd), schemas.passthrough);
      if (outcome.tag !== "accepted") throw new Error(`expected accepted, got ${outcome.tag}`);
      expect((outcome.value as { upload: File }).upload.name).toBe("../../etc/p0");
    });
  });
});
