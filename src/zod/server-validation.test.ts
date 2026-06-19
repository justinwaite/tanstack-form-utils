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
});
