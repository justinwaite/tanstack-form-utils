import invariant from "tiny-invariant";
import { describe, expect, it } from "vite-plus/test";
import z from "zod";

import { coerceFormValue } from "./coercion.ts";
import { parseSubmission } from "./server-validation.ts";

describe("coerceFormValue", () => {
  it("coerces a numeric string to a number", () => {
    const schema = z.object({ age: z.number() });
    expect(coerceFormValue(schema, { age: "2" })).toEqual({ age: 2 });
  });

  it("coerces checkbox / boolean strings", () => {
    const schema = z.object({ a: z.boolean(), b: z.boolean(), c: z.boolean() });
    expect(coerceFormValue(schema, { a: "on", b: "true", c: "false" })).toEqual({
      a: true,
      b: true,
      c: false,
    });
  });

  it("coerces a bigint string", () => {
    const schema = z.object({ big: z.bigint() });
    expect(coerceFormValue(schema, { big: "9007199254740993" })).toEqual({
      big: 9007199254740993n,
    });
  });

  it("coerces an ISO date string to a Date", () => {
    const schema = z.object({ when: z.date() });
    const result = coerceFormValue(schema, {
      when: "2026-01-15T00:00:00.000Z",
    }) as { when: Date };
    expect(result.when).toBeInstanceOf(Date);
    expect(result.when.toISOString()).toBe("2026-01-15T00:00:00.000Z");
  });

  it("strips empty strings to undefined so optional fields pass", () => {
    const schema = z.object({ age: z.number().optional() });
    expect(coerceFormValue(schema, { age: "" })).toEqual({ age: undefined });
  });

  it("leaves string fields untouched", () => {
    const schema = z.object({ name: z.string() });
    expect(coerceFormValue(schema, { name: "2" })).toEqual({ name: "2" });
  });

  it("returns the original string when conversion fails", () => {
    const schema = z.object({ age: z.number() });
    expect(coerceFormValue(schema, { age: "abc" })).toEqual({ age: "abc" });
  });

  it("coerces leaves inside nested objects", () => {
    const schema = z.object({
      profile: z.object({ age: z.number(), active: z.boolean() }),
    });
    expect(coerceFormValue(schema, { profile: { age: "30", active: "on" } })).toEqual({
      profile: { age: 30, active: true },
    });
  });

  it("coerces leaves inside arrays", () => {
    const schema = z.object({ scores: z.array(z.number()) });
    expect(coerceFormValue(schema, { scores: ["1", "2", "3"] })).toEqual({
      scores: [1, 2, 3],
    });
  });

  it("coerces inside arrays of objects", () => {
    const schema = z.object({
      items: z.array(z.object({ qty: z.number() })),
    });
    expect(coerceFormValue(schema, { items: [{ qty: "2" }, { qty: "5" }] })).toEqual({
      items: [{ qty: 2 }, { qty: 5 }],
    });
  });

  it("unwraps defaulted fields", () => {
    const schema = z.object({ age: z.number().default(18) });
    expect(coerceFormValue(schema, { age: "21" })).toEqual({ age: 21 });
  });

  it("leaves already-typed values untouched", () => {
    const schema = z.object({ age: z.number() });
    expect(coerceFormValue(schema, { age: 7 })).toEqual({ age: 7 });
  });
});

describe("parseSubmission with type coercion", () => {
  const schema = z.object({
    name: z.string().nonempty(),
    age: z.number().min(18),
    subscribed: z.boolean(),
  });

  it("validates a numeric/boolean form that previously failed", () => {
    const fd = new FormData();
    fd.append("name", "Jane");
    fd.append("age", "42");
    fd.append("subscribed", "on");

    const submission = parseSubmission(fd, { schema });

    expect(submission.status).toBe("success");
    invariant(submission.status === "success", "should be success");
    expect(submission.value).toEqual({
      name: "Jane",
      age: 42,
      subscribed: true,
    });
  });

  it("still reports a validation error for a genuinely invalid number", () => {
    const fd = new FormData();
    fd.append("name", "Jane");
    fd.append("age", "12"); // below min(18) after coercion
    fd.append("subscribed", "false");

    const submission = parseSubmission(fd, { schema });

    expect(submission.status).toBe("error");
  });

  it("reports a type error (not a crash) for non-numeric input", () => {
    const fd = new FormData();
    fd.append("name", "Jane");
    fd.append("age", "not-a-number");
    fd.append("subscribed", "on");

    const submission = parseSubmission(fd, { schema });

    expect(submission.status).toBe("error");
  });
});
