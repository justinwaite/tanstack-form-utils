/**
 * End-to-end browser tests for the Zod variant, driven through a real React
 * Router runtime (`createRoutesStub`). Every test exercises the real submit →
 * action → `serverResult` → merged-state flow in a real browser via Playwright.
 */
import { useState } from "react";
import { useActionData, useFetcher } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import z from "zod";

import { parseSubmission, type SubmissionResponse } from "../src/zod/index.ts";

import { renderRoute } from "./app/render-route.tsx";
import { AppForm, useAppForm } from "./app/zod-form.ts";

const InvoiceSchema = z.object({
  name: z.string().trim().nonempty("Name is required"),
  email: z.email("Invalid email"),
  notes: z.string().optional(),
  agreeToTerms: z.boolean().refine((v) => v, "You must agree to the terms"),
  lineItems: z.array(
    z.object({
      description: z.string().trim().nonempty("Description is required"),
      amount: z.string().trim().nonempty("Amount is required"),
    }),
  ),
});

type Invoice = z.input<typeof InvoiceSchema>;

const validValues: Invoice = {
  name: "Acme Corp",
  email: "billing@acme.test",
  notes: "",
  agreeToTerms: true,
  lineItems: [{ description: "Consulting", amount: "100" }],
};

/**
 * Builds an invoice form component bound to either a navigation submit
 * (`useSubmit`, the default) or a `useFetcher`. `onSuccess`/`onFailure` are the
 * library's `onServerSuccess`/`onServerFailure` callbacks; we also surface a
 * status string in the DOM so tests can await it.
 */
function makeInvoiceForm(opts: {
  mode: "navigation" | "fetcher";
  defaultValues?: Invoice;
  onSuccess?: () => void;
  onFailure?: () => void;
}) {
  return function InvoiceForm() {
    const actionData = useActionData() as { reply: SubmissionResponse } | undefined;
    const fetcher = useFetcher<{ reply: SubmissionResponse }>();
    const serverResult = opts.mode === "fetcher" ? fetcher.data?.reply : actionData?.reply;
    const [status, setStatus] = useState("");

    const form = useAppForm({
      ...(opts.mode === "fetcher" ? { fetcher } : {}),
      schema: InvoiceSchema,
      serverResult,
      defaultValues: opts.defaultValues ?? validValues,
      onServerSuccess() {
        setStatus("success");
        opts.onSuccess?.();
      },
      onServerFailure() {
        setStatus("failure");
        opts.onFailure?.();
      },
    });

    return (
      <AppForm form={form} method="post">
        <form.FormErrors />

        <form.AppField name="name">
          {(field) => (
            <field.Field>
              <field.Label>Name</field.Label>
              <field.Input />
              <field.Errors />
            </field.Field>
          )}
        </form.AppField>

        <form.AppField name="email">
          {(field) => (
            <field.Field>
              <field.Label>Email</field.Label>
              <field.Input />
              <field.Errors />
            </field.Field>
          )}
        </form.AppField>

        <form.AppField name="agreeToTerms">
          {(field) => (
            <field.Field>
              <field.Label>I agree to the terms</field.Label>
              <field.Checkbox />
              <field.Errors />
            </field.Field>
          )}
        </form.AppField>

        <form.AppField name="lineItems" mode="array">
          {(field) =>
            field.state.value.map((_, i) => (
              <div key={i}>
                <form.AppField name={`lineItems[${i}].description`}>
                  {(sub) => (
                    <sub.Field>
                      <sub.Label>Description</sub.Label>
                      <sub.Input />
                      <sub.Errors />
                    </sub.Field>
                  )}
                </form.AppField>
                <form.AppField name={`lineItems[${i}].amount`}>
                  {(sub) => (
                    <sub.Field>
                      <sub.Label>Amount</sub.Label>
                      <sub.Input />
                      <sub.Errors />
                    </sub.Field>
                  )}
                </form.AppField>
              </div>
            ))
          }
        </form.AppField>

        <form.SubmitButton>Submit</form.SubmitButton>

        <p data-testid="status">{status}</p>
      </AppForm>
    );
  };
}

describe("zod useAppForm — client validation", () => {
  it("blocks submit, shows field errors, and focuses the first invalid field", async () => {
    const action = vi.fn(() => ({ reply: { success: true } }));
    const empty: Invoice = {
      name: "",
      email: "",
      notes: "",
      agreeToTerms: false,
      lineItems: [{ description: "", amount: "" }],
    };
    await renderRoute(makeInvoiceForm({ mode: "navigation", defaultValues: empty }), action);

    await userEvent.click(page.getByRole("button", { name: "Submit" }));

    await expect.element(page.getByText("Name is required")).toBeVisible();
    await expect.element(page.getByText("Invalid email")).toBeVisible();
    await expect.element(page.getByText("You must agree to the terms")).toBeVisible();

    const name = page.getByLabelText("Name");
    await expect.element(name).toHaveAttribute("aria-invalid", "true");
    // First invalid field is focused (focusOnError default).
    await expect.element(name).toHaveFocus();

    // Client validation failed, so the server action never ran.
    expect(action).not.toHaveBeenCalled();
  });
});

describe("zod useAppForm — successful submit", () => {
  it("serializes nested + array form state and runs the action, then fires onServerSuccess", async () => {
    let received: unknown;
    const action = async ({ request }: { request: Request }) => {
      const submission = parseSubmission(await request.formData(), { schema: InvoiceSchema });
      received = submission.status === "success" ? submission.value : { error: true };
      return { reply: submission.reply() };
    };
    const onSuccess = vi.fn();
    await renderRoute(makeInvoiceForm({ mode: "navigation", onSuccess }), action);

    await userEvent.click(page.getByRole("button", { name: "Submit" }));

    await expect.element(page.getByTestId("status")).toHaveTextContent("success");
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(received).toEqual({
      name: "Acme Corp",
      email: "billing@acme.test",
      notes: "",
      agreeToTerms: true,
      lineItems: [{ description: "Consulting", amount: "100" }],
    });
  });
});

describe("zod useAppForm — server-side field errors", () => {
  it("merges a server field error, displays it, and clears it on change", async () => {
    const action = async ({ request }: { request: Request }) => {
      const submission = parseSubmission(await request.formData(), { schema: InvoiceSchema });
      // Client passed, but the server rejects this email.
      return {
        reply:
          submission.status === "success"
            ? submission.reply({ fieldErrors: { email: "Email already in use" } })
            : submission.reply(),
      };
    };
    await renderRoute(makeInvoiceForm({ mode: "navigation" }), action);

    await userEvent.click(page.getByRole("button", { name: "Submit" }));

    await expect.element(page.getByText("Email already in use")).toBeVisible();
    await expect.element(page.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");

    // Editing the field clears the server error (serverErrorListeners).
    await userEvent.fill(page.getByLabelText("Email"), "new@acme.test");
    await expect.element(page.getByText("Email already in use")).not.toBeInTheDocument();
  });
});

describe("zod useAppForm — form-level errors", () => {
  it("renders server form errors via FormErrors and fires onServerFailure", async () => {
    const onFailure = vi.fn();
    const action = async ({ request }: { request: Request }) => {
      const submission = parseSubmission(await request.formData(), { schema: InvoiceSchema });
      return {
        reply:
          submission.status === "success"
            ? submission.reply({ formErrors: ["Payment provider is down"] })
            : submission.reply(),
      };
    };
    await renderRoute(makeInvoiceForm({ mode: "navigation", onFailure }), action);

    await userEvent.click(page.getByRole("button", { name: "Submit" }));

    await expect.element(page.getByText("Payment provider is down")).toBeVisible();
    expect(onFailure).toHaveBeenCalledTimes(1);
  });
});

describe("zod useAppForm — empty arrays", () => {
  it("round-trips an empty array field through the submit/parse cycle", async () => {
    let received: unknown;
    const action = async ({ request }: { request: Request }) => {
      const submission = parseSubmission(await request.formData(), { schema: InvoiceSchema });
      received = submission.status === "success" ? submission.value : { error: true };
      return { reply: submission.reply() };
    };
    await renderRoute(
      makeInvoiceForm({
        mode: "navigation",
        defaultValues: { ...validValues, lineItems: [] },
      }),
      action,
    );

    await userEvent.click(page.getByRole("button", { name: "Submit" }));

    await expect.element(page.getByTestId("status")).toHaveTextContent("success");
    expect(received).toEqual({
      name: "Acme Corp",
      email: "billing@acme.test",
      notes: "",
      agreeToTerms: true,
      lineItems: [],
    });
  });
});

describe("zod useAppForm — fetcher variant", () => {
  it("submits through a useFetcher and fires onServerSuccess", async () => {
    const onSuccess = vi.fn();
    const action = async ({ request }: { request: Request }) => {
      const submission = parseSubmission(await request.formData(), { schema: InvoiceSchema });
      return { reply: submission.reply() };
    };
    await renderRoute(makeInvoiceForm({ mode: "fetcher", onSuccess }), action);

    await userEvent.click(page.getByRole("button", { name: "Submit" }));

    await expect.element(page.getByTestId("status")).toHaveTextContent("success");
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });
});

describe("zod useAppForm — number coercion (regression)", () => {
  // Regression: form state holds a real `number`, so `z.number()` passes on the
  // client. `objectToFormData` then serializes it to a string ("42"), and the
  // server's `parseSubmission` must coerce it back to a number — otherwise
  // `z.number()` fails server-side even though the client passed.
  it("deserializes a number field that FormData carried as a string", async () => {
    const QuantitySchema = z.object({
      quantity: z.number().int().min(1, "Must be at least 1"),
    });
    let received: unknown;
    const action = async ({ request }: { request: Request }) => {
      const submission = parseSubmission(await request.formData(), { schema: QuantitySchema });
      received = submission.status === "success" ? submission.value : { error: true };
      return { reply: submission.reply() };
    };

    function QuantityForm() {
      const actionData = useActionData() as { reply: SubmissionResponse } | undefined;
      const [status, setStatus] = useState("");
      const form = useAppForm({
        schema: QuantitySchema,
        serverResult: actionData?.reply,
        defaultValues: { quantity: 1 },
        onServerSuccess: () => setStatus("success"),
        onServerFailure: () => setStatus("failure"),
      });
      return (
        <AppForm form={form} method="post">
          <form.AppField name="quantity">
            {(field) => (
              <field.Field>
                <field.Label>Quantity</field.Label>
                <field.NumberInput />
                <field.Errors />
              </field.Field>
            )}
          </form.AppField>
          <form.SubmitButton>Submit</form.SubmitButton>
          <p data-testid="status">{status}</p>
        </AppForm>
      );
    }

    await renderRoute(QuantityForm, action);

    await userEvent.fill(page.getByLabelText("Quantity"), "42");
    await userEvent.click(page.getByRole("button", { name: "Submit" }));

    // If the server didn't coerce "42" back to 42, validation would fail and the
    // status would read "failure".
    await expect.element(page.getByTestId("status")).toHaveTextContent("success");
    expect(received).toEqual({ quantity: 42 });
    expect(typeof (received as { quantity: unknown }).quantity).toBe("number");
  });
});
