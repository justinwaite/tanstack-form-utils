/**
 * Security suite for the Effect `parseSubmission`. See SECURITY.md for the
 * standards, and audits/2026-09-18-form-parsing/REPORT.md for the
 * audit findings (F-n) each test covers.
 */
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { installPrototypeGuard } from "../../test/prototype-guard.ts";

import { FormDataParseError } from "../server-validation.ts";
import { parseSubmission } from "./server-validation.ts";

installPrototypeGuard();

const User = Schema.Struct({ name: Schema.String });
const Items = Schema.Struct({ items: Schema.Array(Schema.optional(Schema.String)) });

type Outcome =
  | { tag: "success"; value: unknown }
  | { tag: "invalid-body"; reason: string | undefined }
  | { tag: "validation" };

function run(
  payload: Parameters<typeof parseSubmission>[0],
  schema: Schema.Codec<unknown, unknown> = User as never,
  limits?: Parameters<typeof parseSubmission>[1]["limits"],
): Promise<Outcome> {
  return Effect.runPromise(
    parseSubmission(payload, { schema, limits }).pipe(
      Effect.map(({ value }): Outcome => ({ tag: "success", value })),
      Effect.catchTag("InvalidBodyError", (error) =>
        Effect.succeed<Outcome>({
          tag: "invalid-body",
          reason: error.cause instanceof FormDataParseError ? error.cause.reason : undefined,
        }),
      ),
      Effect.catchTag("FormValidationError", () => Effect.succeed<Outcome>({ tag: "validation" })),
    ),
  );
}

function post(body: BodyInit, url = "https://example.com/", headers?: HeadersInit): Request {
  return new Request(url, { method: "POST", body, headers });
}

describe("prototype pollution (CWE-1321, F-1)", () => {
  it("fails with InvalidBodyError for a __proto__ FormData key", async () => {
    const fd = new FormData();
    fd.append("name", "Jane");
    fd.append("__proto__.polluted", "yes");
    expect(await run(fd)).toEqual({ tag: "invalid-body", reason: "unsafe-key" });
  });

  it("fails for a __proto__ key in a urlencoded Request body", async () => {
    const request = post(new URLSearchParams("name=a&__proto__[polluted]=yes"));
    expect(await run(request)).toEqual({ tag: "invalid-body", reason: "unsafe-key" });
  });

  it("fails for a __proto__ key in a multipart Request body", async () => {
    const fd = new FormData();
    fd.append("constructor.prototype.polluted", "yes");
    expect(await run(post(fd))).toEqual({ tag: "invalid-body", reason: "unsafe-key" });
  });

  it("fails for a __proto__ key in a GET query string", async () => {
    const request = new Request("https://example.com/?__proto__.polluted=yes&name=a");
    expect(await run(request)).toEqual({ tag: "invalid-body", reason: "unsafe-key" });
  });
});

describe("JSON payloads get the same key rules (ASVS V1.5.3, F-9)", () => {
  const json = { "content-type": "application/json" };

  it("fails for a __proto__ key in a JSON Request body", async () => {
    const request = post('{"name":"a","__proto__":{"polluted":true}}', undefined, json);
    expect(await run(request)).toEqual({ tag: "invalid-body", reason: "unsafe-key" });
  });

  it("fails for a nested constructor.prototype chain in a JSON body", async () => {
    const request = post('{"name":"a","x":[{"constructor":{"prototype":{}}}]}', undefined, json);
    expect(await run(request)).toEqual({ tag: "invalid-body", reason: "unsafe-key" });
  });

  it("fails for deep JSON nesting without a stack overflow", async () => {
    const body = '{"name":"a","x":' + "[".repeat(10_000) + "]".repeat(10_000) + "}";
    expect(await run(post(body, undefined, json))).toEqual({
      tag: "invalid-body",
      reason: "depth",
    });
  });

  it("fails for a __proto__ key in an already-parsed payload", async () => {
    const payload = JSON.parse('{"name":"a","__proto__":{"polluted":true}}');
    expect(await run(payload)).toEqual({ tag: "invalid-body", reason: "unsafe-key" });
  });

  it("accepts an ordinary JSON body", async () => {
    expect(await run(post('{"name":"a"}', undefined, json))).toEqual({
      tag: "success",
      value: { name: "a" },
    });
  });
});

describe("resource exhaustion (CWE-770, F-2, F-3)", () => {
  it("fails fast for a huge sparse index", async () => {
    const start = performance.now();
    expect(await run(new URLSearchParams("items.4294967294=1"), Items as never)).toEqual({
      tag: "invalid-body",
      reason: "array-index",
    });
    expect(performance.now() - start).toBeLessThan(50);
  });

  it("fails for an array length override", async () => {
    expect(
      await run(new URLSearchParams("items.0=a&items.length=4294967295"), Items as never),
    ).toEqual({ tag: "invalid-body", reason: "conflicting-path" });
  });

  it("passes caller limits through", async () => {
    expect(await run(new URLSearchParams("name=a&x=b"), User as never, { maxFields: 1 })).toEqual({
      tag: "invalid-body",
      reason: "field-count",
    });
  });
});

describe("mass assignment (CWE-915, ASVS V15.3.3)", () => {
  it("drops undeclared keys from the output", async () => {
    expect(await run(new URLSearchParams("name=Jane&isAdmin=true"))).toEqual({
      tag: "success",
      value: { name: "Jane" },
    });
  });
});

describe("parameter pollution (CWE-235, ASVS V15.3.7)", () => {
  const WithRole = Schema.Struct({ name: Schema.String, role: Schema.optional(Schema.String) });

  it("reads only the body of a POST, never its query string", async () => {
    const request = post(new URLSearchParams("name=a"), "https://example.com/?role=admin");
    expect(await run(request, WithRole as never)).toEqual({
      tag: "success",
      value: { name: "a" },
    });
  });

  it("reads only the query string of a GET", async () => {
    const request = new Request("https://example.com/?name=a&role=user");
    expect(await run(request, WithRole as never)).toEqual({
      tag: "success",
      value: { name: "a", role: "user" },
    });
  });

  it("fails validation when a string field is submitted twice", async () => {
    expect(await run(new URLSearchParams("name=user&name=admin"))).toEqual({ tag: "validation" });
  });
});
