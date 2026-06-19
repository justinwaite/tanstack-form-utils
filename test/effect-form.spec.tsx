/**
 * End-to-end browser tests for the Effect-Schema variant. Mirrors the Zod spec
 * but validates with an Effect `Schema` on both sides: the client validator is
 * derived from the schema, and the server action runs the Effect-returning
 * `parseSubmission` through `Effect.runPromise`.
 */
import { Effect, Schema } from "effect";
import { useState } from "react";
import { useActionData } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { type SubmissionResponse } from "../src/server-validation.ts";
import { parseSubmission } from "../src/effect/index.ts";

import { renderRoute } from "./app/render-route.tsx";
import { AppForm, useAppEffectForm } from "./app/effect-form.ts";

const SignupSchema = Schema.Struct({
  name: Schema.String.check(Schema.makeFilter((s) => s.trim().length > 0 || "Name is required")),
  email: Schema.String.check(Schema.makeFilter((s) => /.+@.+/.test(s) || "Invalid email")),
});

type Signup = typeof SignupSchema.Type;

const emptyValues: Signup = { name: "", email: "" };

/** Runs the Effect `parseSubmission` and returns a `{ reply }` payload for the route. */
async function runAction(request: Request, fieldErrors?: Partial<Record<string, string>>) {
  return Effect.runPromise(
    parseSubmission(request, { schema: SignupSchema }).pipe(
      Effect.map(({ reply }) => ({ reply: reply(fieldErrors ? { fieldErrors } : undefined) })),
      Effect.catchTag("FormValidationError", (e) => Effect.succeed(e.reply)),
    ),
  );
}

function makeSignupForm(opts: { onSuccess?: () => void; onFailure?: () => void }) {
  return function SignupForm() {
    const actionData = useActionData() as { reply: SubmissionResponse } | undefined;
    const [status, setStatus] = useState("");

    const form = useAppEffectForm({
      schema: SignupSchema,
      serverResult: actionData?.reply,
      defaultValues: emptyValues,
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

        <form.SubmitButton>Sign up</form.SubmitButton>
        <p data-testid="status">{status}</p>
      </AppForm>
    );
  };
}

describe("effect useAppForm — client validation", () => {
  it("blocks submit and shows Effect schema errors", async () => {
    const action = vi.fn();
    await renderRoute(makeSignupForm({}), action as never);

    await userEvent.click(page.getByRole("button", { name: "Sign up" }));

    await expect.element(page.getByText("Name is required")).toBeVisible();
    await expect.element(page.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    expect(action).not.toHaveBeenCalled();
  });
});

describe("effect useAppForm — successful submit", () => {
  it("validates client + server with one Effect schema and fires onServerSuccess", async () => {
    const onSuccess = vi.fn();
    const action = ({ request }: { request: Request }) => runAction(request);
    await renderRoute(makeSignupForm({ onSuccess }), action);

    await userEvent.fill(page.getByLabelText("Name"), "Ada Lovelace");
    await userEvent.fill(page.getByLabelText("Email"), "ada@example.test");
    await userEvent.click(page.getByRole("button", { name: "Sign up" }));

    await expect.element(page.getByTestId("status")).toHaveTextContent("success");
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });
});

describe("effect useAppForm — server-side field errors", () => {
  it("merges and clears a server field error", async () => {
    const action = ({ request }: { request: Request }) =>
      runAction(request, { email: "Email already registered" });
    await renderRoute(makeSignupForm({}), action);

    await userEvent.fill(page.getByLabelText("Name"), "Ada Lovelace");
    await userEvent.fill(page.getByLabelText("Email"), "ada@example.test");
    await userEvent.click(page.getByRole("button", { name: "Sign up" }));

    await expect.element(page.getByText("Email already registered")).toBeVisible();
    await expect.element(page.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");

    await userEvent.fill(page.getByLabelText("Email"), "different@example.test");
    await expect.element(page.getByText("Email already registered")).not.toBeInTheDocument();
  });
});

describe("effect useAppForm — number coercion (regression)", () => {
  // Regression: form state holds a real `number`, so `Schema.Number` passes on
  // the client. `objectToFormData` serializes it to a string ("42") on submit,
  // and the server's `parseSubmission` must coerce it back to a number —
  // otherwise decoding fails server-side even though the client passed.
  it("deserializes a number field that FormData carried as a string", async () => {
    const QuantitySchema = Schema.Struct({
      quantity: Schema.Number.check(Schema.makeFilter((n) => n >= 1 || "Must be at least 1")),
    });
    let received: unknown;
    const action = ({ request }: { request: Request }) =>
      Effect.runPromise(
        parseSubmission(request, { schema: QuantitySchema }).pipe(
          Effect.map(({ value, reply }) => {
            received = value;
            return { reply: reply() };
          }),
          Effect.catchTag("FormValidationError", (e) => Effect.succeed(e.reply)),
        ),
      );

    function QuantityForm() {
      const actionData = useActionData() as { reply: SubmissionResponse } | undefined;
      const [status, setStatus] = useState("");
      const form = useAppEffectForm({
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

    // If the server didn't coerce "42" back to 42, decoding would fail and the
    // status would read "failure".
    await expect.element(page.getByTestId("status")).toHaveTextContent("success");
    expect(received).toEqual({ quantity: 42 });
    expect(typeof (received as { quantity: unknown }).quantity).toBe("number");
  });
});
