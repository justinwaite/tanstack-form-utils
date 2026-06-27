import { Effect, Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { coerceFormValue } from "./coercion.ts";

/** Decode a value against a schema, returning the typed result or throwing. */
function decode<A>(schema: Schema.Codec<A, unknown>, value: unknown): A {
  return Effect.runSync(Schema.decodeUnknownEffect(schema)(value));
}

describe("coerceFormValue (effect)", () => {
  it("coerces a numeric string to a number", () => {
    const schema = Schema.Struct({ age: Schema.Number });
    expect(coerceFormValue(schema, { age: "2" })).toEqual({ age: 2 });
  });

  it("coerces boolean strings", () => {
    const schema = Schema.Struct({
      a: Schema.Boolean,
      b: Schema.Boolean,
      c: Schema.Boolean,
    });
    expect(coerceFormValue(schema, { a: "on", b: "true", c: "false" })).toEqual({
      a: true,
      b: true,
      c: false,
    });
  });

  it("coerces a bigint string", () => {
    const schema = Schema.Struct({ big: Schema.BigInt });
    expect(coerceFormValue(schema, { big: "42" })).toEqual({ big: 42n });
  });

  it("strips empty strings to undefined for optional fields", () => {
    const schema = Schema.Struct({ age: Schema.optional(Schema.Number) });
    expect(coerceFormValue(schema, { age: "" })).toEqual({ age: undefined });
  });

  it("coerces the inner type of an optional field", () => {
    const schema = Schema.Struct({ age: Schema.optional(Schema.Number) });
    expect(coerceFormValue(schema, { age: "7" })).toEqual({ age: 7 });
  });

  it("leaves string fields untouched", () => {
    const schema = Schema.Struct({ name: Schema.String });
    expect(coerceFormValue(schema, { name: "2" })).toEqual({ name: "2" });
  });

  it("returns the original string when conversion fails", () => {
    const schema = Schema.Struct({ age: Schema.Number });
    expect(coerceFormValue(schema, { age: "abc" })).toEqual({ age: "abc" });
  });

  it("coerces leaves inside nested structs", () => {
    const schema = Schema.Struct({
      profile: Schema.Struct({ age: Schema.Number, active: Schema.Boolean }),
    });
    expect(coerceFormValue(schema, { profile: { age: "30", active: "on" } })).toEqual({
      profile: { age: 30, active: true },
    });
  });

  it("coerces leaves inside arrays", () => {
    const schema = Schema.Struct({ scores: Schema.Array(Schema.Number) });
    expect(coerceFormValue(schema, { scores: ["1", "2", "3"] })).toEqual({
      scores: [1, 2, 3],
    });
  });

  it("does not double-coerce an already-encoded leaf (NumberFromString)", () => {
    const schema = Schema.Struct({ age: Schema.NumberFromString });
    // Skipped by the walker (leaf has its own encoding); stays a string and the
    // schema's own codec turns it into a number at decode time.
    expect(coerceFormValue(schema, { age: "2" })).toEqual({ age: "2" });
    expect(decode(schema, coerceFormValue(schema, { age: "2" }))).toEqual({
      age: 2,
    });
  });

  it("leaves already-typed values untouched", () => {
    const schema = Schema.Struct({ age: Schema.Number });
    expect(coerceFormValue(schema, { age: 9 })).toEqual({ age: 9 });
  });
});

describe("coerced values decode successfully (effect)", () => {
  it("decodes a form that previously failed", () => {
    const schema = Schema.Struct({
      name: Schema.String,
      age: Schema.Number,
      subscribed: Schema.Boolean,
    });
    const raw = { name: "Jane", age: "42", subscribed: "on" };

    const decoded = decode(schema, coerceFormValue(schema, raw));

    expect(decoded).toEqual({ name: "Jane", age: 42, subscribed: true });
  });

  it("a Date field works via Schema.DateFromString without coercion", () => {
    const schema = Schema.Struct({ when: Schema.DateFromString });
    const coerced = coerceFormValue(schema, { when: "2026-01-15T00:00:00.000Z" });

    const decoded = decode(schema, coerced) as { when: Date };
    expect(decoded.when).toBeInstanceOf(Date);
    expect(decoded.when.toISOString()).toBe("2026-01-15T00:00:00.000Z");
  });
});
