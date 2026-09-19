/**
 * Field path parsing and error messages (CWE-1321, CWE-20, CWE-117).
 * SECURITY.md, "Path parsing". Findings F-4, F-7, F-8, and F-10 in
 * audits/2026-09-18-form-parsing/REPORT.md.
 */
import { describe, expect, it } from "vite-plus/test";

import { parsePath } from "../../src/index.ts";
import { consumers, fields, reasonOf, schemas, urlencoded } from "./harness.ts";
import { installPrototypeGuard } from "./prototype-guard.ts";

installPrototypeGuard();

describe("parsePath (unit)", () => {
  it("normalizes bracket noise before the key rules run", () => {
    expect(parsePath("__pro]to__.x")).toEqual(["__proto__", "x"]);
  });

  it.each(["-1", "01", "1e3", "0x1", " 1", "+1", "Infinity", "NaN"])(
    "keeps %j as a string segment (F-7)",
    (segment) => {
      expect(parsePath(`items.${segment}`)).toEqual(["items", segment]);
    },
  );

  it("treats canonical integers as indices", () => {
    expect(parsePath("items.0.10")).toEqual(["items", 0, 10]);
  });
});

describe.each(consumers)("$name consumer", (consumer) => {
  describe("inherited property names are ordinary fields (F-4)", () => {
    it.each(["valueOf", "hasOwnProperty", "toString", "isPrototypeOf", "__defineGetter__"])(
      "parses %s.x as a nested field",
      async (name) => {
        const outcome = await consumer.submit(urlencoded(`${name}.x=1`), schemas.passthrough);
        expect(outcome).toEqual({ tag: "accepted", value: { [name]: { x: "1" } } });
      },
    );

    it("parses an inherited name as a flat field", async () => {
      const outcome = await consumer.submit(
        urlencoded("toString=1&valueOf=2"),
        schemas.passthrough,
      );
      expect(outcome).toEqual({ tag: "accepted", value: { toString: "1", valueOf: "2" } });
    });

    it("collects duplicate inherited-name keys into an array", async () => {
      const outcome = await consumer.submit(urlencoded("valueOf=1&valueOf=2"), schemas.passthrough);
      expect(outcome).toEqual({ tag: "accepted", value: { valueOf: ["1", "2"] } });
    });

    it("parses an inherited name inside a nested object", async () => {
      const outcome = await consumer.submit(
        urlencoded("a.hasOwnProperty.b=1"),
        schemas.passthrough,
      );
      expect(outcome).toEqual({ tag: "accepted", value: { a: { hasOwnProperty: { b: "1" } } } });
    });
  });

  describe("only canonical non-negative integers are indices (F-7)", () => {
    it("builds an object, not an array, for a negative segment", async () => {
      const outcome = await consumer.submit(urlencoded("items.-1=x"), schemas.passthrough);
      expect(outcome).toEqual({ tag: "accepted", value: { items: { "-1": "x" } } });
    });
  });

  describe("empty paths are rejected (F-8)", () => {
    it.each(["", ".", "..", "[]", "[", "]", "[.]"])("rejects %j", async (key) => {
      const outcome = await consumer.submit(urlencoded(fields(key)), schemas.passthrough);
      expect(reasonOf(outcome)).toBe("empty-path");
    });
  });

  describe("error messages (F-10, CWE-117)", () => {
    it("starts with Malformed form submission", async () => {
      const outcome = await consumer.submit(urlencoded(fields("__proto__.x")), schemas.user);
      if (outcome.tag !== "rejected") throw new Error("expected a rejection");
      expect(outcome.message).toMatch(/Malformed form submission/);
    });

    it("shortens a long key", async () => {
      const key = "__proto__." + "x".repeat(5000);
      const outcome = await consumer.submit(urlencoded(fields(key)), schemas.user);
      if (outcome.tag !== "rejected") throw new Error("expected a rejection");
      expect(outcome.message.length).toBeLessThan(250);
    });

    it("never contains the submitted value", async () => {
      const body = "name=SECRET-VALUE-1&name.first=SECRET-VALUE-2";
      const outcome = await consumer.submit(urlencoded(body), schemas.user);
      if (outcome.tag !== "rejected") throw new Error("expected a rejection");
      expect(outcome.message).not.toContain("SECRET-VALUE");
    });
  });
});
