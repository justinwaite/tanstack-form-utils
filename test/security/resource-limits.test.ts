/**
 * Resource exhaustion (CWE-770, CWE-405, CAPEC-130, CAPEC-229, CAPEC-231,
 * ASVS V1.5.3). SECURITY.md, "Resource exhaustion". Findings F-2, F-3, F-6,
 * F-12, F-16, and F-19 in audits/2026-09-18-form-parsing/REPORT.md.
 *
 * A time limit of 50 ms marks a payload that must fail before the parser or the
 * schema does work in proportion to what the payload claims.
 */
import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_FORM_DATA_LIMITS } from "../../src/index.ts";
import {
  chunked,
  consumers,
  fields,
  json,
  multipart,
  reasonOf,
  schemas,
  timed,
  urlencoded,
} from "./harness.ts";
import { installPrototypeGuard } from "./prototype-guard.ts";

installPrototypeGuard();

const MiB = 1024 * 1024;

/** `items.<i>.tags.<last>=x` for `count` items: one small field per sparse array. */
function sparseTags(count: number, last = 9999): string {
  return Array.from({ length: count }, (_, i) => `items.${i}.tags.${last}=x`).join("&");
}

function manyFields(count: number): URLSearchParams {
  const params = new URLSearchParams();
  for (let i = 0; i < count; i++) params.append(`f${i}`, "x");
  return params;
}

describe.each(consumers)("$name consumer", (consumer) => {
  describe("array indices (F-2, F-3)", () => {
    it("rejects a 4-billion index in less than 50 ms", async () => {
      const [outcome, ms] = await timed(() =>
        consumer.submit(urlencoded("items.4294967294=1"), schemas.items),
      );
      expect(reasonOf(outcome)).toBe("array-index");
      expect(ms).toBeLessThan(50);
    });

    it("rejects the bracket form of a huge index", async () => {
      const outcome = await consumer.submit(urlencoded("items[99999999]=1"), schemas.items);
      expect(reasonOf(outcome)).toBe("array-index");
    });

    it("rejects a huge index nested inside an array", async () => {
      const outcome = await consumer.submit(urlencoded("m.0.99999999=1"), schemas.passthrough);
      expect(reasonOf(outcome)).toBe("array-index");
    });

    it("accepts the last index below maxArrayLength", async () => {
      const max = DEFAULT_FORM_DATA_LIMITS.maxArrayLength;
      const outcome = await consumer.submit(urlencoded(`items.${max - 1}=x`), schemas.items);
      if (outcome.tag !== "accepted") throw new Error(`expected accepted, got ${outcome.tag}`);
      expect((outcome.value as { items: unknown[] }).items).toHaveLength(max);
    });

    it("rejects the index equal to maxArrayLength", async () => {
      const max = DEFAULT_FORM_DATA_LIMITS.maxArrayLength;
      const outcome = await consumer.submit(urlencoded(`items.${max}=x`), schemas.items);
      expect(reasonOf(outcome)).toBe("array-index");
    });

    it("rejects `length` on an array", async () => {
      for (const body of ["items.0=a&items.length=4294967295", "items.0=a&items.length=0"]) {
        const outcome = await consumer.submit(urlencoded(body), schemas.items);
        expect(reasonOf(outcome)).toBe("conflicting-path");
      }
    });

    it("rejects any non-index key on an existing array", async () => {
      for (const body of ["items.0=a&items.name=b", "items[]=&items.foo=b"]) {
        const outcome = await consumer.submit(urlencoded(body), schemas.items);
        expect(reasonOf(outcome)).toBe("conflicting-path");
      }
    });

    it("uses a caller-supplied maxArrayLength", async () => {
      const limits = { maxArrayLength: 5 };
      expect(reasonOf(await consumer.submit(urlencoded("items.5=x"), schemas.items, limits))).toBe(
        "array-index",
      );
      const outcome = await consumer.submit(urlencoded("items.4=x"), schemas.items, limits);
      expect(outcome.tag).toBe("accepted");
    });
  });

  describe("total array slots across fields (F-12)", () => {
    it("rejects 100 sparse arrays (a 2 KB body) in less than 50 ms", async () => {
      const [outcome, ms] = await timed(() =>
        consumer.submit(urlencoded(sparseTags(100)), schemas.tags),
      );
      expect(reasonOf(outcome)).toBe("array-index");
      expect(ms).toBeLessThan(50);
    });

    it("rejects 1000 sparse arrays (a 21 KB body) in less than 50 ms", async () => {
      const [outcome, ms] = await timed(() =>
        consumer.submit(urlencoded(sparseTags(1000)), schemas.tags),
      );
      expect(reasonOf(outcome)).toBe("array-index");
      expect(ms).toBeLessThan(50);
    });

    it("counts the slots of every array, empty slots included", async () => {
      // items has 2 slots, each tags array has 10: 22 in total.
      const body = sparseTags(2, 9);
      const outcome = await consumer.submit(urlencoded(body), schemas.passthrough, {
        maxArraySlots: 21,
      });
      expect(reasonOf(outcome)).toBe("array-index");
      const ok = await consumer.submit(urlencoded(body), schemas.passthrough, {
        maxArraySlots: 22,
      });
      expect(ok.tag).toBe("accepted");
    });

    it("counts the arrays that duplicate keys make", async () => {
      const outcome = await consumer.submit(urlencoded("t=a&t=b&t=c&t=d"), schemas.passthrough, {
        maxArraySlots: 3,
      });
      expect(reasonOf(outcome)).toBe("array-index");
    });

    it("accepts a native form that skips an index (sparse arrays are allowed)", async () => {
      const outcome = await consumer.submit(urlencoded("items.0=a&items.2=c"), schemas.items);
      if (outcome.tag !== "accepted") throw new Error(`expected accepted, got ${outcome.tag}`);
      expect((outcome.value as { items: unknown[] }).items).toEqual(["a", undefined, "c"]);
    });
  });

  describe("path depth (F-6)", () => {
    const pathOfDepth = (depth: number) => Array.from({ length: depth }, () => "a").join(".");

    it("accepts a path at maxDepth", async () => {
      const key = pathOfDepth(DEFAULT_FORM_DATA_LIMITS.maxDepth);
      expect((await consumer.submit(urlencoded(fields(key)), schemas.passthrough)).tag).toBe(
        "accepted",
      );
    });

    it("rejects a path above maxDepth", async () => {
      const key = pathOfDepth(DEFAULT_FORM_DATA_LIMITS.maxDepth + 1);
      const outcome = await consumer.submit(urlencoded(fields(key)), schemas.passthrough);
      expect(reasonOf(outcome)).toBe("depth");
    });

    it("rejects a 20000-segment path without a stack overflow", async () => {
      const outcome = await consumer.submit(
        urlencoded(fields(pathOfDepth(20_000))),
        schemas.passthrough,
      );
      expect(reasonOf(outcome)).toBe("depth");
    });

    it("counts bracket segments toward depth", async () => {
      const key = "a" + "[0]".repeat(DEFAULT_FORM_DATA_LIMITS.maxDepth);
      const outcome = await consumer.submit(urlencoded(fields(key)), schemas.passthrough);
      expect(reasonOf(outcome)).toBe("depth");
    });

    it("uses a caller-supplied maxDepth", async () => {
      const limits = { maxDepth: 2 };
      const deep = await consumer.submit(urlencoded("a.b.c=x"), schemas.passthrough, limits);
      expect(reasonOf(deep)).toBe("depth");
      expect(await consumer.submit(urlencoded("a.b=x"), schemas.passthrough, limits)).toEqual({
        tag: "accepted",
        value: { a: { b: "x" } },
      });
    });
  });

  describe("field count (F-6)", () => {
    it("accepts exactly maxFields entries", async () => {
      const body = manyFields(DEFAULT_FORM_DATA_LIMITS.maxFields);
      expect((await consumer.submit(urlencoded(body), schemas.passthrough)).tag).toBe("accepted");
    });

    it("rejects more than maxFields entries", async () => {
      const body = manyFields(DEFAULT_FORM_DATA_LIMITS.maxFields + 1);
      const outcome = await consumer.submit(urlencoded(body), schemas.passthrough);
      expect(reasonOf(outcome)).toBe("field-count");
    });

    it("counts duplicate keys toward the limit", async () => {
      const body = Array.from({ length: 11 }, () => "tag=x").join("&");
      const outcome = await consumer.submit(urlencoded(body), schemas.passthrough, {
        maxFields: 10,
      });
      expect(reasonOf(outcome)).toBe("field-count");
    });
  });

  describe("JSON payloads get the same limits (F-16)", () => {
    it("rejects a JSON array above maxArrayLength", async () => {
      const body = JSON.stringify({ x: Array.from({ length: 11 }, () => 0) });
      const outcome = await consumer.submit(json(body), schemas.passthrough, {
        maxArrayLength: 10,
      });
      expect(reasonOf(outcome)).toBe("array-index");
    });

    it("rejects a JSON array of 1000000 items with the default limits", async () => {
      const body = `{"x":[${"0,".repeat(999_999)}0]}`;
      expect(reasonOf(await consumer.submit(json(body), schemas.passthrough))).toBe("array-index");
    });

    it("rejects a JSON object with more keys than maxFields", async () => {
      const entries = Array.from({ length: 11 }, (_, i) => `"k${i}":0`).join(",");
      const outcome = await consumer.submit(json(`{${entries}}`), schemas.passthrough, {
        maxFields: 10,
      });
      expect(reasonOf(outcome)).toBe("field-count");
    });

    it("counts JSON array items as fields", async () => {
      const outcome = await consumer.submit(json('{"x":[1,2,3,4,5]}'), schemas.passthrough, {
        maxFields: 5,
      });
      expect(reasonOf(outcome)).toBe("field-count");
    });

    it("rejects JSON arrays whose total length is above maxArraySlots", async () => {
      // Each JSON array item is also a field, so raise maxFields to reach the slot limit.
      const arrays = Array.from({ length: 11 }, (_, i) => `"a${i}":[${"0,".repeat(9_999)}0]`);
      const outcome = await consumer.submit(json(`{${arrays.join(",")}}`), schemas.passthrough, {
        maxFields: 1_000_000,
      });
      expect(reasonOf(outcome)).toBe("array-index");
    });

    it("rejects JSON nesting above maxDepth without a stack overflow", async () => {
      const body = '{"name":"a","x":' + "[".repeat(10_000) + "]".repeat(10_000) + "}";
      expect(reasonOf(await consumer.submit(json(body), schemas.user))).toBe("depth");
    });

    it("applies the limits to an already-parsed payload in less than 50 ms", async () => {
      const payload = { x: Array.from({ length: 1_000_000 }, () => 0) };
      const [outcome, ms] = await timed(() =>
        consumer.submit(payload, schemas.passthrough, { maxArrayLength: 10 }),
      );
      expect(reasonOf(outcome)).toBe("array-index");
      expect(ms).toBeLessThan(50);
    });

    it("counts the slots of a sparse already-parsed array", async () => {
      const sparse = () => {
        const x: unknown[] = [];
        x[9_999] = 0;
        return x;
      };
      const payload = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`a${i}`, sparse()]));
      const outcome = await consumer.submit(payload, schemas.passthrough);
      expect(reasonOf(outcome)).toBe("array-index");
    });
  });

  describe("body size (F-19)", () => {
    it("rejects a Content-Length above maxBodyBytes without a read of the body", async () => {
      const request = new Request("https://app.example/", {
        method: "POST",
        body: "name=a",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "content-length": String(1024 * MiB),
        },
      });
      const [outcome, ms] = await timed(() => consumer.submit(request, schemas.user));
      expect(reasonOf(outcome)).toBe("body-size");
      expect(request.bodyUsed).toBe(false);
      expect(ms).toBeLessThan(50);
    });

    it("stops a chunked body at maxBodyBytes", async () => {
      const { request, pulled } = chunked(4 * MiB, 16 * 1024);
      const outcome = await consumer.submit(request, schemas.user, { maxBodyBytes: 64 * 1024 });
      expect(reasonOf(outcome)).toBe("body-size");
      expect(pulled()).toBeLessThanOrEqual(64 * 1024 + 2 * 16 * 1024);
    });

    it("stops a chunked body at the default maxBodyBytes", async () => {
      const limit = DEFAULT_FORM_DATA_LIMITS.maxBodyBytes;
      const { request, pulled } = chunked(limit + 4 * MiB, 64 * 1024);
      const outcome = await consumer.submit(request, schemas.user);
      expect(reasonOf(outcome)).toBe("body-size");
      expect(pulled()).toBeLessThanOrEqual(limit + 2 * 64 * 1024);
    });

    it("counts the real bytes when Content-Length is smaller than the body", async () => {
      const { request } = chunked(1 * MiB, 16 * 1024);
      request.headers.set("content-length", "10");
      const outcome = await consumer.submit(request, schemas.user, { maxBodyBytes: 64 * 1024 });
      expect(reasonOf(outcome)).toBe("body-size");
    });

    it("rejects a JSON body above maxBodyBytes", async () => {
      const body = JSON.stringify({ name: "a".repeat(2048) });
      const outcome = await consumer.submit(json(body), schemas.user, { maxBodyBytes: 1024 });
      expect(reasonOf(outcome)).toBe("body-size");
    });

    it("accepts a body at maxBodyBytes", async () => {
      const body = "name=" + "a".repeat(1019);
      const outcome = await consumer.submit(urlencoded(body), schemas.user, { maxBodyBytes: 1024 });
      expect(outcome.tag).toBe("accepted");
    });
  });

  describe("files (F-19)", () => {
    function withFiles(count: number, bytes = 1): FormData {
      const fd = new FormData();
      fd.append("name", "a");
      for (let i = 0; i < count; i++) fd.append(`f${i}`, new File(["x".repeat(bytes)], `${i}.txt`));
      return fd;
    }

    it("rejects more files than maxFiles", async () => {
      const count = DEFAULT_FORM_DATA_LIMITS.maxFiles + 1;
      const outcome = await consumer.submit(multipart(withFiles(count)), schemas.user);
      expect(reasonOf(outcome)).toBe("file-count");
    });

    it("accepts exactly maxFiles files", async () => {
      const count = DEFAULT_FORM_DATA_LIMITS.maxFiles;
      expect((await consumer.submit(multipart(withFiles(count)), schemas.user)).tag).toBe(
        "accepted",
      );
    });

    it("rejects 50000 file parts", async () => {
      const outcome = await consumer.submit(multipart(withFiles(50_000)), schemas.user);
      expect(reasonOf(outcome)).toBe("file-count");
    });

    it("rejects a file above maxFileBytes", async () => {
      const outcome = await consumer.submit(multipart(withFiles(1, 2048)), schemas.user, {
        maxFileBytes: 1024,
      });
      expect(reasonOf(outcome)).toBe("file-size");
    });

    it("applies the file limits to a FormData object passed directly", async () => {
      const outcome = await consumer.submit(withFiles(3), schemas.user, { maxFiles: 2 });
      expect(reasonOf(outcome)).toBe("file-count");
    });

    it("does not count an empty file input", async () => {
      const fd = new FormData();
      fd.append("name", "a");
      fd.append("upload", new File([], ""));
      fd.append("upload2", new File([], ""));
      expect((await consumer.submit(multipart(fd), schemas.user, { maxFiles: 1 })).tag).toBe(
        "accepted",
      );
    });
  });
});
