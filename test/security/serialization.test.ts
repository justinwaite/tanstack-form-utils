/**
 * Client serialization with `objectToFormData` (CWE-140). SECURITY.md,
 * "Serialization". Finding F-20 in audits/2026-09-18-form-parsing/REPORT.md.
 *
 * The client turns form state into FormData, and the server turns it back. A
 * key that holds a path delimiter changes the shape of the data on the way, so
 * `objectToFormData` refuses it.
 */
import { Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";
import z from "zod";

import { objectToFormData } from "../../src/index.ts";
import { consumers, multipart } from "./harness.ts";
import { installPrototypeGuard } from "./prototype-guard.ts";

installPrototypeGuard();

describe("objectToFormData refuses keys with path delimiters (F-20)", () => {
  it.each([
    { "a.b": 1 },
    { prefs: { "a.b": 1 } },
    { prefs: { "x[0]": 2 } },
    { prefs: { "[x]": 2 } },
    { prefs: { "x]": 2 } },
    { "": 1 },
    { prefs: { "": 1 } },
    { list: [{ "a.b": 1 }] },
  ])("throws a TypeError for %j", (state) => {
    expect(() => objectToFormData(state)).toThrow(TypeError);
  });

  it("accepts ordinary keys", () => {
    expect(() => objectToFormData({ prefs: { "a-b": 1, a_b: 2, "a b": 3 } })).not.toThrow();
  });
});

describe.each(consumers)(
  "$name consumer: round trip from client state to server value",
  (consumer) => {
    const state = {
      name: "Jane",
      age: 42,
      ratio: 0.5,
      active: true,
      muted: false,
      big: 12345678901234567890n,
      when: new Date("2024-02-29T12:34:56.789Z"),
      tags: ["a", "b"],
      empty: [] as string[],
      nested: { items: [{ qty: 1 }, { qty: 2 }] },
    };

    const schema = {
      zod: z.object({
        name: z.string(),
        age: z.number(),
        ratio: z.number(),
        active: z.boolean(),
        muted: z.boolean(),
        big: z.bigint(),
        when: z.date(),
        tags: z.array(z.string()),
        empty: z.array(z.string()),
        nested: z.object({ items: z.array(z.object({ qty: z.number() })) }),
      }),
      effect: Schema.Struct({
        name: Schema.String,
        age: Schema.Number,
        ratio: Schema.Number,
        active: Schema.Boolean,
        muted: Schema.Boolean,
        big: Schema.BigInt,
        when: Schema.DateFromString,
        tags: Schema.Array(Schema.String),
        empty: Schema.Array(Schema.String),
        nested: Schema.Struct({ items: Schema.Array(Schema.Struct({ qty: Schema.Number })) }),
      }),
    };

    it("gives the server the same value that the client had", async () => {
      const outcome = await consumer.submit(multipart(objectToFormData(state)), schema);
      expect(outcome).toEqual({ tag: "accepted", value: state });
    });
  },
);
