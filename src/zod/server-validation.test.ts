import { describe, expect, it } from "vitest";
import z from "zod";
import invariant from "tiny-invariant";

import {
  formDataToObject,
  objectToFormData,
  parsePath,
  parseSubmission,
} from "./server-validation";

describe("parsePath", () => {
  it("parses a simple key", () => {
    expect(parsePath("name")).toEqual(["name"]);
  });

  it("parses dot-notation nested keys", () => {
    expect(parsePath("address.street")).toEqual(["address", "street"]);
  });

  it("parses bracket-notation array indices", () => {
    expect(parsePath("items[0].name")).toEqual(["items", 0, "name"]);
  });

  it("parses dot-notation array indices", () => {
    expect(parsePath("items.0.name")).toEqual(["items", 0, "name"]);
  });

  it("parses deeply nested paths", () => {
    expect(parsePath("a.b[2].c.d")).toEqual(["a", "b", 2, "c", "d"]);
  });

  it("parses consecutive array indices", () => {
    expect(parsePath("matrix[0][1]")).toEqual(["matrix", 0, 1]);
  });
});

describe("formDataToObject", () => {
  it("handles flat key-value pairs", () => {
    const fd = new FormData();
    fd.append("firstName", "Jane");
    fd.append("lastName", "Doe");

    expect(formDataToObject(fd)).toEqual({
      firstName: "Jane",
      lastName: "Doe",
    });
  });

  it("handles dot-notation nested objects", () => {
    const fd = new FormData();
    fd.append("address.street", "123 Main St");
    fd.append("address.city", "Springfield");

    expect(formDataToObject(fd)).toEqual({
      address: { street: "123 Main St", city: "Springfield" },
    });
  });

  it("handles bracket-notation array entries", () => {
    const fd = new FormData();
    fd.append("items[0].name", "Widget");
    fd.append("items[0].qty", "3");
    fd.append("items[1].name", "Gadget");
    fd.append("items[1].qty", "7");

    expect(formDataToObject(fd)).toEqual({
      items: [
        { name: "Widget", qty: "3" },
        { name: "Gadget", qty: "7" },
      ],
    });
  });

  it("handles dot-notation array entries", () => {
    const fd = new FormData();
    fd.append("tags.0", "alpha");
    fd.append("tags.1", "beta");

    expect(formDataToObject(fd)).toEqual({
      tags: ["alpha", "beta"],
    });
  });

  it("collects duplicate flat keys into arrays", () => {
    const fd = new FormData();
    fd.append("color", "red");
    fd.append("color", "blue");
    fd.append("color", "green");

    expect(formDataToObject(fd)).toEqual({
      color: ["red", "blue", "green"],
    });
  });

  it("normalizes empty File entries to null", () => {
    const fd = new FormData();
    fd.append("avatar", new File([], "", { type: "application/octet-stream" }));

    expect(formDataToObject(fd)).toEqual({ avatar: null });
  });

  it("preserves non-empty File entries", () => {
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });
    const fd = new FormData();
    fd.append("attachment", file);

    const result = formDataToObject(fd);
    expect(result.attachment).toBeInstanceOf(File);
    expect((result.attachment as File).name).toBe("hello.txt");
  });

  it("handles mixed flat and nested keys", () => {
    const fd = new FormData();
    fd.append("intent", "save");
    fd.append("contact.name", "Acme");
    fd.append("contact.email", "hi@acme.co");
    fd.append("lineItems[0].amount", "100");

    expect(formDataToObject(fd)).toEqual({
      intent: "save",
      contact: { name: "Acme", email: "hi@acme.co" },
      lineItems: [{ amount: "100" }],
    });
  });

  it("deserializes empty array sentinel into an empty array", () => {
    const fd = new FormData();
    fd.append("lineItems[]", "");

    expect(formDataToObject(fd)).toEqual({ lineItems: [] });
  });

  it("deserializes nested empty array sentinel", () => {
    const fd = new FormData();
    fd.append("invoice.lineItems[]", "");

    expect(formDataToObject(fd)).toEqual({ invoice: { lineItems: [] } });
  });

  it("works with URLSearchParams", () => {
    const params = new URLSearchParams();
    params.append("filters.status", "active");
    params.append("filters.type", "invoice");
    params.append("page", "1");

    expect(formDataToObject(params)).toEqual({
      filters: { status: "active", type: "invoice" },
      page: "1",
    });
  });
});

describe("objectToFormData", () => {
  it("handles flat key-value pairs", () => {
    const result = objectToFormData({ firstName: "Jane", lastName: "Doe" });

    expect(result.get("firstName")).toBe("Jane");
    expect(result.get("lastName")).toBe("Doe");
  });

  it("handles nested objects with dot-notation keys", () => {
    const result = objectToFormData({
      address: { street: "123 Main St", city: "Springfield" },
    });

    expect(result.get("address.street")).toBe("123 Main St");
    expect(result.get("address.city")).toBe("Springfield");
  });

  it("handles arrays with numeric path segments", () => {
    const result = objectToFormData({
      items: [
        { name: "Widget", qty: "3" },
        { name: "Gadget", qty: "7" },
      ],
    });

    expect(result.get("items.0.name")).toBe("Widget");
    expect(result.get("items.0.qty")).toBe("3");
    expect(result.get("items.1.name")).toBe("Gadget");
    expect(result.get("items.1.qty")).toBe("7");
  });

  it("handles flat arrays", () => {
    const result = objectToFormData({ tags: ["alpha", "beta"] });

    expect(result.get("tags.0")).toBe("alpha");
    expect(result.get("tags.1")).toBe("beta");
  });

  it("skips null and undefined values", () => {
    const result = objectToFormData({
      name: "test",
      empty: null,
      missing: undefined,
    });

    expect(result.get("name")).toBe("test");
    expect(result.has("empty")).toBe(false);
    expect(result.has("missing")).toBe(false);
  });

  it("preserves File entries", () => {
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });
    const result = objectToFormData({ attachment: file });

    const entry = result.get("attachment");
    expect(entry).toBeInstanceOf(File);
    expect((entry as File).name).toBe("hello.txt");
  });

  it("preserves Blob entries", () => {
    const blob = new Blob(["data"], { type: "application/octet-stream" });
    const result = objectToFormData({ doc: blob });

    expect(result.get("doc")).toBeInstanceOf(Blob);
  });

  it("coerces numbers and booleans to strings", () => {
    const result = objectToFormData({
      count: 42,
      active: true,
    } as unknown as Record<string, unknown>);

    expect(result.get("count")).toBe("42");
    expect(result.get("active")).toBe("true");
  });

  it("coerces Date values to strings", () => {
    const date = new Date("2026-01-15T00:00:00.000Z");
    const result = objectToFormData({
      createdAt: date,
    } as unknown as Record<string, unknown>);

    expect(result.get("createdAt")).toBe(date.toString());
  });

  it("handles deeply nested structures", () => {
    const result = objectToFormData({
      a: { b: [{ c: { d: "deep" } }] },
    });

    expect(result.get("a.b.0.c.d")).toBe("deep");
  });

  it("handles mixed flat and nested keys", () => {
    const result = objectToFormData({
      intent: "save",
      contact: { name: "Acme", email: "hi@acme.co" },
      lineItems: [{ amount: "100" }],
    });

    expect(result.get("intent")).toBe("save");
    expect(result.get("contact.name")).toBe("Acme");
    expect(result.get("contact.email")).toBe("hi@acme.co");
    expect(result.get("lineItems.0.amount")).toBe("100");
  });

  it("serializes empty arrays with a sentinel key", () => {
    const result = objectToFormData({ lineItems: [] });

    expect(result.get("lineItems[]")).toBe("");
    expect(result.has("lineItems.0")).toBe(false);
  });

  it("serializes nested empty arrays with a sentinel key", () => {
    const result = objectToFormData({
      invoice: { lineItems: [] },
    });

    expect(result.get("invoice.lineItems[]")).toBe("");
  });

  it("round-trips with formDataToObject", () => {
    const original = {
      name: "Invoice #1",
      customer: { id: "123", label: "Acme Corp" },
      items: [
        { name: "Widget", quantity: "2", unitPriceCents: "1000" },
        { name: "Gadget", quantity: "1", unitPriceCents: "2500" },
      ],
    };

    const formData = objectToFormData(original);
    const reconstructed = formDataToObject(formData);

    expect(reconstructed).toEqual(original);
  });

  it("round-trips empty arrays", () => {
    const original = {
      name: "Invoice #1",
      lineItems: [] as unknown[],
    };

    const formData = objectToFormData(original);
    const reconstructed = formDataToObject(formData);

    expect(reconstructed).toEqual(original);
  });
});

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
    expect(submission.value.lineItems).toEqual([
      { description: "Widget", amount: "100" },
    ]);
  });

  it("fails validation when required array field is missing entirely", () => {
    const fd = new FormData();
    fd.append("name", "Invoice #1");

    const submission = parseSubmission(fd, { schema: invoiceSchema });

    expect(submission.status).toBe("error");
  });
});
