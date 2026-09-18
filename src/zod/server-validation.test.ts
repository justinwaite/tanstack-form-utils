import invariant from "tiny-invariant";
import { describe, expect, it } from "vite-plus/test";
import z from "zod";

import { parseSubmission } from "./server-validation.ts";

// Tests for the shared FormData helpers (`parsePath`, `formDataToObject`,
// `objectToFormData`) live with their source in `../server-validation.test.ts`.
// This file covers only the Zod-specific `parseSubmission` entry point.

describe("parseSubmission with empty arrays", () => {
  const invoiceSchema = z.object({
    name: z.string().nonempty(),
    lineItems: z.array(
      z.object({
        description: z.string(),
        amount: z.string(),
      }),
    ),
  });

  it("validates an empty array field from FormData", () => {
    const fd = new FormData();
    fd.append("name", "Invoice #1");
    fd.append("lineItems[]", "");

    const submission = parseSubmission(fd, { schema: invoiceSchema });

    expect(submission.status).toBe("success");
    invariant(submission.status === "success", "should be success");
    expect(submission.value.lineItems).toEqual([]);
  });

  it("validates a non-empty array field from FormData", () => {
    const fd = new FormData();
    fd.append("name", "Invoice #1");
    fd.append("lineItems.0.description", "Widget");
    fd.append("lineItems.0.amount", "100");

    const submission = parseSubmission(fd, { schema: invoiceSchema });

    expect(submission.status).toBe("success");
    invariant(submission.status === "success", "should be success");
    expect(submission.value.lineItems).toEqual([{ description: "Widget", amount: "100" }]);
  });

  it("fails validation when required array field is missing entirely", () => {
    const fd = new FormData();
    fd.append("name", "Invoice #1");

    const submission = parseSubmission(fd, { schema: invoiceSchema });

    expect(submission.status).toBe("error");
  });

  it("throws a clear error for a colliding FormData key path instead of a raw TypeError", () => {
    const fd = new FormData();
    fd.append("name", "Invoice #1");
    fd.append("name.first", "Jo");

    expect(() => parseSubmission(fd, { schema: invoiceSchema })).toThrow(
      "Malformed form submission",
    );
  });

  it("throws a clear error for a colliding FormData key path regardless of entry order", () => {
    const fd = new FormData();
    fd.append("name.first", "Jo");
    fd.append("name", "Invoice #1");

    expect(() => parseSubmission(fd, { schema: invoiceSchema })).toThrow(
      "Malformed form submission",
    );
  });
});

describe("parseSubmission with a query string", () => {
  const signupSchema = z.object({
    name: z.string(),
    age: z.coerce.number(),
  });

  it("parses a URLSearchParams instance directly (e.g. a GET request's query string)", () => {
    const params = new URLSearchParams({ name: "Jane", age: "30" });

    const submission = parseSubmission(params, { schema: signupSchema });

    expect(submission.status).toBe("success");
    invariant(submission.status === "success", "should be success");
    expect(submission.value).toEqual({ name: "Jane", age: 30 });
  });
});

describe("parseSubmission with a JSON payload", () => {
  const signupSchema = z.object({
    name: z.string(),
    age: z.number(),
  });

  it("passes an already-parsed JSON body through untouched (e.g. from request.json())", () => {
    const submission = parseSubmission({ name: "Jane", age: 30 }, { schema: signupSchema });

    expect(submission.status).toBe("success");
    invariant(submission.status === "success", "should be success");
    expect(submission.value).toEqual({ name: "Jane", age: 30 });
  });
});
