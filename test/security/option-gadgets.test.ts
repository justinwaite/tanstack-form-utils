/**
 * Option gadgets (CWE-1321, WSTG-INJT-22). SECURITY.md, "Option gadgets".
 * Finding F-13 in audits/2026-09-18-form-parsing/REPORT.md.
 *
 * If other code in the process pollutes `Object.prototype`, an option that the
 * caller did not set must not pick up the polluted value. A security limit that
 * a polluted prototype can turn off is a gadget.
 */
import { Effect, Schema } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";
import z from "zod";

import * as effectEntry from "../../src/effect/index.ts";
import { formDataToObject, readRequestBody } from "../../src/index.ts";
import * as zodEntry from "../../src/zod/index.ts";
import { consumers, effectConsumer, fields, reasonOf, schemas, urlencoded } from "./harness.ts";
import { installPrototypeGuard } from "./prototype-guard.ts";

installPrototypeGuard();

const proto = Object.prototype as Record<string, unknown>;
const POLLUTED = [
  "limits",
  "init",
  "maxDepth",
  "maxArrayLength",
  "maxArraySlots",
  "maxFields",
  "maxBodyBytes",
];

// Remove the test's own pollution before the prototype guard runs.
afterEach(() => {
  for (const key of POLLUTED) delete proto[key];
});

describe.each(consumers)("$name consumer", (consumer) => {
  it("ignores a polluted Object.prototype.limits", async () => {
    proto.limits = { maxArrayLength: 2 ** 32, maxArraySlots: 2 ** 40 };
    const outcome = await consumer.submit(urlencoded("items.4294967294=1"), schemas.items);
    expect(reasonOf(outcome)).toBe("array-index");
  });

  it.each([
    ["maxDepth", 1000, "a." + "b.".repeat(40) + "c=1", "depth"],
    ["maxArrayLength", 2 ** 32, "items.4294967294=1", "array-index"],
    [
      "maxArraySlots",
      2 ** 40,
      Array.from({ length: 11 }, (_, i) => `t.${i}.9999=x`).join("&"),
      "array-index",
    ],
    [
      "maxFields",
      2 ** 32,
      Array.from({ length: 10_001 }, (_, i) => `f${i}=x`).join("&"),
      "field-count",
    ],
  ])("ignores a polluted Object.prototype.%s", async (key, value, body, reason) => {
    proto[key] = value;
    expect(reasonOf(await consumer.submit(urlencoded(body), schemas.passthrough))).toBe(reason);
    expect(reasonOf(await consumer.submit(urlencoded(body), schemas.passthrough, {}))).toBe(reason);
  });

  it("ignores a polluted Object.prototype.maxBodyBytes", async () => {
    proto.maxBodyBytes = 2 ** 40;
    const request = new Request("https://app.example/", {
      method: "POST",
      body: "name=a",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": String(2 ** 31),
      },
    });
    expect(reasonOf(await consumer.submit(request, schemas.user, {}))).toBe("body-size");
  });
});

describe("effect consumer: init", () => {
  it("ignores a polluted Object.prototype.init", async () => {
    proto.init = { status: 200 };
    const outcome = await effectConsumer.submit(urlencoded("name=a&name=b"), schemas.user);
    expect(outcome).toMatchObject({ tag: "invalid", status: 400 });
  });
});

describe("limits that are not non-negative integers are a programming error", () => {
  const bad = [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "5", null];

  it.each(bad)("formDataToObject throws a TypeError for maxDepth = %j", (value) => {
    expect(() => formDataToObject(fields("a"), { maxDepth: value as number })).toThrow(TypeError);
  });

  it.each(bad)("readRequestBody throws a TypeError for maxBodyBytes = %j", async (value) => {
    await expect(
      readRequestBody(urlencoded("a=1"), { maxBodyBytes: value as number }),
    ).rejects.toThrow(TypeError);
  });

  it("the Zod parseSubmission throws a TypeError", () => {
    expect(() =>
      zodEntry.parseSubmission(fields("a"), { schema: z.object({}), limits: { maxFields: -1 } }),
    ).toThrow(TypeError);
  });

  it("the Effect parseSubmission dies with a TypeError", async () => {
    const program = effectEntry.parseSubmission(fields("a"), {
      schema: Schema.Struct({}),
      limits: { maxFields: -1 },
    });
    await expect(Effect.runPromise(program)).rejects.toThrow(TypeError);
  });
});
