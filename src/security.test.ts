/**
 * Security suite for the framework-agnostic FormData parser. Each `describe`
 * maps to a section of SECURITY.md, and each test names the standard item or
 * the audit finding (F-n) it covers. Findings are in
 * audits/2026-09-18-form-parsing/REPORT.md. Payload shapes come from the
 * advisories listed in SECURITY.md (qs, lodash, dot-prop, set-value,
 * object-path, dset).
 */
import { describe, expect, it } from "vite-plus/test";

import { installPrototypeGuard } from "../test/prototype-guard.ts";

import {
  DEFAULT_FORM_DATA_LIMITS,
  FormDataParseError,
  formDataToObject,
  parsePath,
} from "./server-validation.ts";

installPrototypeGuard();

function params(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

function fields(...keys: string[]): URLSearchParams {
  const p = new URLSearchParams();
  for (const key of keys) p.append(key, "polluted");
  return p;
}

function reasonOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof FormDataParseError) return error.reason;
    throw error;
  }
  return undefined;
}

// ─── Prototype pollution (CWE-1321, ASVS V15.3.6, F-1) ────────────────────────

describe("prototype pollution: dangerous path segments are rejected", () => {
  const payloads = [
    // qs CVE-2017-1000048 / CVE-2022-24999
    "__proto__[polluted]",
    "[__proto__][polluted]",
    "[__proto__].polluted",
    // dot-prop CVE-2020-8116, dset CVE-2020-28277
    "__proto__.polluted",
    "__proto__.__proto__.polluted",
    "a.__proto__.polluted",
    "a.b.__proto__.polluted",
    // Array elements (lodash zipObjectDeep CVE-2020-8203)
    "items.0.__proto__.polluted",
    "items[0][__proto__][polluted]",
    "items[0].__proto__.polluted",
    // constructor.prototype (lodash CVE-2019-10744, set-value CVE-2021-23440)
    "constructor.prototype.polluted",
    "constructor[prototype][polluted]",
    "a.constructor.prototype.polluted",
    "items.0.constructor.prototype.polluted",
    "a.constructor.constructor",
    "a.prototype",
    // Flat dangerous keys
    "__proto__",
    "constructor",
    "prototype",
    // Numeric child under a dangerous key (would create an array there)
    "__proto__.0",
    "__proto__[0]",
    // Bracket noise that normalizes to a dangerous key (object-path
    // CVE-2020-15256 class: the check must run on the normalized segment,
    // ASVS V1.1.1)
    "__pro]to__.polluted",
    "__proto__]].polluted",
    "]__proto__.polluted",
    "..__proto__..polluted",
    ".__proto__.polluted",
    "[[__proto__]].polluted",
  ];

  for (const key of payloads) {
    it(`rejects ${JSON.stringify(key)}`, () => {
      expect(reasonOf(() => formDataToObject(fields(key)))).toBe("unsafe-key");
    });
  }

  it("rejects the empty-array sentinel on a dangerous key", () => {
    expect(reasonOf(() => formDataToObject(fields("__proto__[]")))).toBe("unsafe-key");
    expect(reasonOf(() => formDataToObject(fields("a.__proto__[]")))).toBe("unsafe-key");
    expect(reasonOf(() => formDataToObject(fields("constructor.prototype[]")))).toBe("unsafe-key");
  });

  it("rejects a dangerous key that follows valid keys", () => {
    const p = params("name=Jane&items.0=a&items.__proto__.polluted=1");
    expect(reasonOf(() => formDataToObject(p))).toBe("unsafe-key");
  });

  it("rejects a repeated dangerous flat key", () => {
    expect(reasonOf(() => formDataToObject(params("__proto__=a&__proto__=b")))).toBe("unsafe-key");
  });

  it("rejects a dangerous key that carries a File value", () => {
    const fd = new FormData();
    fd.append("__proto__.polluted", new File(["x"], "x.txt"));
    expect(reasonOf(() => formDataToObject(fd))).toBe("unsafe-key");
  });

  it("rejects a percent-encoded dangerous key after the one URL decode", () => {
    expect(reasonOf(() => formDataToObject(params("%5F%5Fproto%5F%5F.polluted=1")))).toBe(
      "unsafe-key",
    );
    expect(reasonOf(() => formDataToObject(params("__proto__%5Bpolluted%5D=1")))).toBe(
      "unsafe-key",
    );
  });

  it("does not decode a second time: a double-encoded key stays literal (ASVS V1.1.1)", () => {
    const result = formDataToObject(params("%255F%255Fproto%255F%255F.x=1"));
    expect(result).toEqual({ "%5F%5Fproto%5F%5F": { x: "1" } });
  });

  it.each([
    ["__PROTO__.x", "__PROTO__"],
    ["＿＿proto＿＿.x", "＿＿proto＿＿"],
    ["__proto__ .x", "__proto__ "],
    ["Constructor.x", "Constructor"],
    ["_proto_.x", "_proto_"],
  ])("treats the look-alike %j as an ordinary key", (key, literal) => {
    const result = formDataToObject(fields(key));
    expect(Object.keys(result)).toEqual([literal]);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });

  it("leaves the result with its normal prototype", () => {
    const result = formDataToObject(params("a.b=1&c=2"));
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(result.a)).toBe(Object.prototype);
  });

  it("parsePath output is what the key rules run on", () => {
    expect(parsePath("__pro]to__.x")).toEqual(["__proto__", "x"]);
  });
});

// ─── Resource exhaustion (CWE-770, F-2, F-3, F-6) ─────────────────────────────

describe("resource exhaustion: array indices", () => {
  it("rejects a 4-billion index quickly instead of allocating (F-2)", () => {
    const start = performance.now();
    expect(reasonOf(() => formDataToObject(params("items.4294967294=1")))).toBe("array-index");
    expect(performance.now() - start).toBeLessThan(50);
  });

  it("rejects the bracket form of a huge index", () => {
    expect(reasonOf(() => formDataToObject(params("items[99999999]=1")))).toBe("array-index");
  });

  it("rejects a huge index nested inside an array", () => {
    expect(reasonOf(() => formDataToObject(params("m.0.99999999=1")))).toBe("array-index");
  });

  it("accepts the last index below maxArrayLength", () => {
    const max = DEFAULT_FORM_DATA_LIMITS.maxArrayLength;
    const result = formDataToObject(params(`items.${max - 1}=x`)) as { items: unknown[] };
    expect(result.items).toHaveLength(max);
  });

  it("rejects the index equal to maxArrayLength", () => {
    const max = DEFAULT_FORM_DATA_LIMITS.maxArrayLength;
    expect(reasonOf(() => formDataToObject(params(`items.${max}=x`)))).toBe("array-index");
  });

  it("rejects `length` on an array (F-3)", () => {
    expect(reasonOf(() => formDataToObject(params("items.0=a&items.length=4294967295")))).toBe(
      "conflicting-path",
    );
    expect(reasonOf(() => formDataToObject(params("items.0=a&items.length=0")))).toBe(
      "conflicting-path",
    );
  });

  it("rejects any non-index key on an existing array", () => {
    expect(reasonOf(() => formDataToObject(params("items.0=a&items.name=b")))).toBe(
      "conflicting-path",
    );
    expect(reasonOf(() => formDataToObject(params("items[]=&items.foo=b")))).toBe(
      "conflicting-path",
    );
  });

  it("honors a caller-supplied maxArrayLength", () => {
    const p = params("items.5=x");
    expect(reasonOf(() => formDataToObject(p, { maxArrayLength: 5 }))).toBe("array-index");
    const { items } = formDataToObject(p, { maxArrayLength: 6 }) as { items: unknown[] };
    expect(items).toHaveLength(6);
    expect(items[5]).toBe("x");
  });
});

describe("resource exhaustion: depth", () => {
  const pathOfDepth = (depth: number) => Array.from({ length: depth }, () => "a").join(".");

  it("accepts a path at maxDepth", () => {
    expect(() =>
      formDataToObject(fields(pathOfDepth(DEFAULT_FORM_DATA_LIMITS.maxDepth))),
    ).not.toThrow();
  });

  it("rejects a path above maxDepth", () => {
    expect(
      reasonOf(() => formDataToObject(fields(pathOfDepth(DEFAULT_FORM_DATA_LIMITS.maxDepth + 1)))),
    ).toBe("depth");
  });

  it("rejects a 20000-segment path without a stack overflow", () => {
    expect(reasonOf(() => formDataToObject(fields(pathOfDepth(20_000))))).toBe("depth");
  });

  it("counts bracket segments toward depth", () => {
    const key = "a" + "[0]".repeat(DEFAULT_FORM_DATA_LIMITS.maxDepth);
    expect(reasonOf(() => formDataToObject(fields(key)))).toBe("depth");
  });

  it("honors a caller-supplied maxDepth", () => {
    expect(reasonOf(() => formDataToObject(fields("a.b.c"), { maxDepth: 2 }))).toBe("depth");
    expect(formDataToObject(fields("a.b"), { maxDepth: 2 })).toEqual({ a: { b: "polluted" } });
  });
});

describe("resource exhaustion: field count", () => {
  function manyFields(count: number): URLSearchParams {
    const p = new URLSearchParams();
    for (let i = 0; i < count; i++) p.append(`f${i}`, "x");
    return p;
  }

  it("accepts exactly maxFields entries", () => {
    expect(() => formDataToObject(manyFields(DEFAULT_FORM_DATA_LIMITS.maxFields))).not.toThrow();
  });

  it("rejects more than maxFields entries", () => {
    expect(
      reasonOf(() => formDataToObject(manyFields(DEFAULT_FORM_DATA_LIMITS.maxFields + 1))),
    ).toBe("field-count");
  });

  it("counts duplicate keys toward the limit", () => {
    const p = new URLSearchParams();
    for (let i = 0; i < 11; i++) p.append("tag", "x");
    expect(reasonOf(() => formDataToObject(p, { maxFields: 10 }))).toBe("field-count");
  });
});

// ─── Path parsing (F-4, F-7, F-8, F-10) ───────────────────────────────────────

describe("path parsing: inherited property names are ordinary fields (F-4)", () => {
  it.each(["valueOf", "hasOwnProperty", "toString", "isPrototypeOf", "__defineGetter__"])(
    "parses %s.x as a nested field",
    (name) => {
      const result = formDataToObject(params(`${name}.x=1`));
      expect(Object.hasOwn(result, name)).toBe(true);
      expect(result[name]).toEqual({ x: "1" });
    },
  );

  it("parses an inherited name as a flat field", () => {
    const result = formDataToObject(params("toString=1&valueOf=2"));
    expect(result).toEqual({ toString: "1", valueOf: "2" });
  });

  it("collects duplicate inherited-name keys into an array", () => {
    expect(formDataToObject(params("valueOf=1&valueOf=2"))).toEqual({ valueOf: ["1", "2"] });
  });

  it("parses an inherited name inside a nested object", () => {
    expect(formDataToObject(params("a.hasOwnProperty.b=1"))).toEqual({
      a: { hasOwnProperty: { b: "1" } },
    });
  });
});

describe("path parsing: only canonical non-negative integers are indices (F-7)", () => {
  it.each(["-1", "01", "1e3", "0x1", " 1", "+1", "Infinity", "NaN"])(
    "keeps %j as a string segment",
    (segment) => {
      expect(parsePath(`items.${segment}`)).toEqual(["items", segment]);
    },
  );

  it("still treats canonical integers as indices", () => {
    expect(parsePath("items.0.10")).toEqual(["items", 0, 10]);
  });

  it("builds an object, not an array, for a negative segment", () => {
    const result = formDataToObject(params("items.-1=x"));
    expect(result).toEqual({ items: { "-1": "x" } });
    expect(Array.isArray(result.items)).toBe(false);
  });
});

describe("path parsing: empty paths are rejected (F-8)", () => {
  it.each(["", ".", "..", "[]", "[", "]", "[.]"])("rejects %j", (key) => {
    expect(reasonOf(() => formDataToObject(fields(key)))).toBe("empty-path");
  });

  it("never writes a key named `undefined`", () => {
    const result = formDataToObject(params("a=1"));
    expect(() => formDataToObject(fields("[]"))).toThrow(FormDataParseError);
    expect(Object.hasOwn(result, "undefined")).toBe(false);
  });
});

describe("error messages (F-10)", () => {
  function messageOf(fn: () => unknown): string {
    try {
      fn();
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error("expected a throw");
  }

  it("is a FormDataParseError with a Malformed-submission message", () => {
    const error = (() => {
      try {
        formDataToObject(fields("__proto__.x"));
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(FormDataParseError);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/^Malformed form submission/);
  });

  it("shortens a long key to at most 100 characters", () => {
    const key = "__proto__." + "x".repeat(5000);
    const message = messageOf(() => formDataToObject(fields(key)));
    expect(message.length).toBeLessThan(250);
  });

  it("never contains the submitted value", () => {
    const p = new URLSearchParams();
    p.append("name", "SECRET-VALUE-1");
    p.append("name.first", "SECRET-VALUE-2");
    const message = messageOf(() => formDataToObject(p));
    expect(message).not.toContain("SECRET-VALUE");
  });
});

// ─── Parameter pollution (CWE-235, ASVS V15.3.7) ──────────────────────────────

describe("parameter pollution", () => {
  it("collects duplicate flat keys into an array (never a silent pick)", () => {
    expect(formDataToObject(params("role=user&role=admin"))).toEqual({ role: ["user", "admin"] });
  });

  it("treats `role` and `[role]` as the same field, not a silent overwrite", () => {
    expect(formDataToObject(params("role=user&[role]=admin"))).toEqual({
      role: ["user", "admin"],
    });
  });

  it("rejects a key used as both a value and a container, in either order", () => {
    expect(reasonOf(() => formDataToObject(params("a=1&a.b=2")))).toBe("conflicting-path");
    expect(reasonOf(() => formDataToObject(params("a.b=2&a=1")))).toBe("conflicting-path");
  });
});
