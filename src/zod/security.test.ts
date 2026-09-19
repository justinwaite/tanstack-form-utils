/**
 * Security suite for the Zod `parseSubmission`. See SECURITY.md for the
 * standards, and audits/2026-09-18-form-parsing/REPORT.md for the
 * audit findings (F-n) each test covers.
 */
import { describe, expect, it } from "vite-plus/test";
import z from "zod";

import { installPrototypeGuard } from "../../test/prototype-guard.ts";

import { FormDataParseError } from "../server-validation.ts";
import { parseSubmission } from "./server-validation.ts";

installPrototypeGuard();

function reasonOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof FormDataParseError) return error.reason;
    throw error;
  }
  return undefined;
}

const userSchema = z.object({ name: z.string() });
const itemsSchema = z.object({ items: z.array(z.string().optional()) });

describe("prototype pollution (CWE-1321, F-1)", () => {
  it("rejects a __proto__ FormData key", () => {
    const fd = new FormData();
    fd.append("name", "Jane");
    fd.append("__proto__.polluted", "yes");
    expect(reasonOf(() => parseSubmission(fd, { schema: userSchema }))).toBe("unsafe-key");
  });

  it("rejects a constructor.prototype URLSearchParams key", () => {
    const p = new URLSearchParams("constructor.prototype.polluted=yes");
    expect(reasonOf(() => parseSubmission(p, { schema: userSchema }))).toBe("unsafe-key");
  });

  it("keeps the Malformed-submission message", () => {
    const p = new URLSearchParams("__proto__.polluted=yes");
    expect(() => parseSubmission(p, { schema: userSchema })).toThrow("Malformed form submission");
  });
});

describe("JSON payloads get the same key rules (ASVS V1.5.3, F-9)", () => {
  it("rejects a top-level __proto__ key", () => {
    const payload = JSON.parse('{"name":"a","__proto__":{"polluted":true}}');
    expect(reasonOf(() => parseSubmission(payload, { schema: userSchema }))).toBe("unsafe-key");
  });

  it("rejects a nested __proto__ key inside an array", () => {
    const payload = JSON.parse('{"items":[{"__proto__":{"polluted":true}}]}');
    expect(
      reasonOf(() =>
        parseSubmission(payload, { schema: z.object({ items: z.array(z.object({})) }) }),
      ),
    ).toBe("unsafe-key");
  });

  it("rejects a constructor.prototype chain", () => {
    const payload = JSON.parse('{"a":{"constructor":{"prototype":{"polluted":true}}}}');
    expect(reasonOf(() => parseSubmission(payload, { schema: z.object({}) }))).toBe("unsafe-key");
  });

  it("rejects JSON nesting above maxDepth without a stack overflow", () => {
    const payload = JSON.parse("[".repeat(10_000) + "]".repeat(10_000));
    expect(reasonOf(() => parseSubmission({ a: payload }, { schema: z.object({}) }))).toBe("depth");
  });

  it("does not descend into non-plain values (Date, File, class instances)", () => {
    class Model {
      constructor() {
        Object.defineProperty(this, "constructor", { value: "own", enumerable: true });
      }
    }
    const payload = {
      name: "a",
      when: new Date(0),
      file: new File(["x"], "x"),
      model: new Model(),
    };
    expect(() => parseSubmission(payload, { schema: userSchema })).not.toThrow();
  });

  it("accepts an ordinary JSON payload", () => {
    const result = parseSubmission({ name: "Jane" }, { schema: userSchema });
    expect(result.status).toBe("success");
  });
});

describe("resource exhaustion (CWE-770, F-2, F-3)", () => {
  it("rejects a huge sparse index before the schema walk allocates", () => {
    const p = new URLSearchParams("items.4294967294=1");
    const start = performance.now();
    expect(reasonOf(() => parseSubmission(p, { schema: itemsSchema }))).toBe("array-index");
    expect(performance.now() - start).toBeLessThan(50);
  });

  it("rejects an array length override", () => {
    const p = new URLSearchParams("items.0=a&items.length=4294967295");
    expect(reasonOf(() => parseSubmission(p, { schema: itemsSchema }))).toBe("conflicting-path");
  });

  it("passes caller limits through", () => {
    const p = new URLSearchParams("items.3=a");
    expect(
      reasonOf(() => parseSubmission(p, { schema: itemsSchema, limits: { maxArrayLength: 3 } })),
    ).toBe("array-index");
  });
});

describe("mass assignment (CWE-915, ASVS V15.3.3)", () => {
  it("strips undeclared keys from the output", () => {
    const p = new URLSearchParams("name=Jane&isAdmin=true&role=admin");
    const result = parseSubmission(p, { schema: userSchema });
    expect(result.status).toBe("success");
    if (result.status === "success") expect(result.value).toEqual({ name: "Jane" });
  });
});

describe("parameter pollution and type confusion (CWE-235, ASVS V15.3.5, V15.3.7)", () => {
  it("fails validation when a string field is submitted twice", () => {
    const p = new URLSearchParams("name=user&name=admin");
    expect(parseSubmission(p, { schema: userSchema }).status).toBe("error");
  });

  it("does not coerce a value the schema does not ask for", () => {
    const p = new URLSearchParams("name=123");
    const result = parseSubmission(p, { schema: userSchema });
    if (result.status !== "success") throw new Error("expected success");
    expect(result.value.name).toBe("123");
  });

  it("does not coerce an unknown boolean spelling", () => {
    const p = new URLSearchParams("ok=1");
    expect(parseSubmission(p, { schema: z.object({ ok: z.boolean() }) }).status).toBe("error");
  });
});

describe("reply field errors", () => {
  it("keeps dangerous-looking caller fieldErrors as own keys only", () => {
    const result = parseSubmission({ name: "a" }, { schema: userSchema });
    const reply = result.reply({ fieldErrors: JSON.parse('{"__proto__":"x"}') });
    expect(Object.getPrototypeOf(reply.fieldErrors)).toBe(Object.prototype);
  });
});
