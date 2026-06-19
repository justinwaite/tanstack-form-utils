/**
 * A minimal, dependency-free set of field/form components that mirror how
 * lazybooks wires up `@justinwaite/tanstack-form-utils`. These are deliberately
 * plain HTML (no design system) so the browser tests exercise the *library's*
 * behavior — field-context wiring, `aria-invalid`, error rendering, submit
 * disabling, server-error display — rather than any UI kit.
 *
 * Each component reads the field/form context created alongside the form hook
 * (see `./contexts.ts`), exactly like a real consumer's components do.
 */
import { useStore } from "@tanstack/react-form";
import type { ComponentPropsWithoutRef } from "react";

import { useFieldContext, useFormContext } from "./contexts.ts";

/** Wraps a field, exposing `data-invalid` for styling/queries (mirrors `TField`). */
export function Field({ children, ...props }: ComponentPropsWithoutRef<"div">) {
  const field = useFieldContext();
  const isInvalid = useStore(field.store, (s) => s.meta.isTouched && !s.meta.isValid);
  return (
    <div data-invalid={isInvalid || undefined} {...props}>
      {children}
    </div>
  );
}

/** A `<label htmlFor={field.name}>` (mirrors `TLabel`). */
export function Label(props: Omit<ComponentPropsWithoutRef<"label">, "htmlFor">) {
  const field = useFieldContext();
  return <label htmlFor={field.name} {...props} />;
}

/** Text input bound to the field, with `aria-invalid` driven by validation. */
export function Input(
  props: Omit<ComponentPropsWithoutRef<"input">, "id" | "name" | "value" | "onChange" | "onBlur">,
) {
  const field = useFieldContext<string>();
  const isInvalid = useStore(field.store, (s) => s.meta.isTouched && !s.meta.isValid);
  return (
    <input
      {...props}
      id={field.name}
      name={field.name}
      value={field.state.value ?? ""}
      onChange={(e) => field.handleChange(e.target.value)}
      onBlur={field.handleBlur}
      aria-invalid={isInvalid}
    />
  );
}

/**
 * Number input bound to the field. Crucially, `onChange` keeps the field value
 * a real `number` (via `valueAsNumber`), so a `z.number()` / `Schema.Number`
 * schema passes *client-side*. On submit the value is serialized to a string in
 * FormData, and the server's `parseSubmission` must coerce it back to a number —
 * the path the number-coercion regression test exercises.
 */
export function NumberInput(
  props: Omit<
    ComponentPropsWithoutRef<"input">,
    "id" | "name" | "type" | "value" | "onChange" | "onBlur"
  >,
) {
  const field = useFieldContext<number | undefined>();
  const isInvalid = useStore(field.store, (s) => s.meta.isTouched && !s.meta.isValid);
  return (
    <input
      {...props}
      type="number"
      id={field.name}
      name={field.name}
      value={field.state.value ?? ""}
      onChange={(e) =>
        field.handleChange(e.target.value === "" ? undefined : e.target.valueAsNumber)
      }
      onBlur={field.handleBlur}
      aria-invalid={isInvalid}
    />
  );
}

/** Textarea bound to the field (mirrors `TTextarea`). */
export function Textarea(
  props: Omit<
    ComponentPropsWithoutRef<"textarea">,
    "id" | "name" | "value" | "onChange" | "onBlur"
  >,
) {
  const field = useFieldContext<string>();
  const isInvalid = useStore(field.store, (s) => s.meta.isTouched && !s.meta.isValid);
  return (
    <textarea
      {...props}
      id={field.name}
      name={field.name}
      value={field.state.value ?? ""}
      onChange={(e) => field.handleChange(e.target.value)}
      onBlur={field.handleBlur}
      aria-invalid={isInvalid}
    />
  );
}

/** Checkbox bound to a boolean field (mirrors `TCheckbox`). */
export function Checkbox(
  props: Omit<
    ComponentPropsWithoutRef<"input">,
    "id" | "name" | "type" | "checked" | "onChange" | "onBlur"
  >,
) {
  const field = useFieldContext<boolean>();
  const isInvalid = useStore(field.store, (s) => s.meta.isTouched && !s.meta.isValid);
  return (
    <input
      {...props}
      type="checkbox"
      id={field.name}
      name={field.name}
      checked={field.state.value ?? false}
      onChange={(e) => field.handleChange(e.target.checked)}
      onBlur={field.handleBlur}
      aria-invalid={isInvalid}
    />
  );
}

/** Hidden input that serializes the field value (mirrors `THidden`). */
export function Hidden() {
  const field = useFieldContext<string>();
  return <input type="hidden" name={field.name} value={field.state.value ?? ""} />;
}

/** Renders the field's current validation errors (mirrors `TErrors`). */
export function Errors() {
  const field = useFieldContext();
  const errors = useStore(field.store, (s) => s.meta.errors);
  if (!errors.length) return null;
  return (
    <ul role="alert" data-field-errors={field.name}>
      {(errors as Array<{ message?: string } | undefined>).map((e, i) => (
        <li key={i}>{e?.message}</li>
      ))}
    </ul>
  );
}

/** Renders form-level (`onServer`) errors (mirrors `TFormErrors`). */
export function FormErrors() {
  const form = useFormContext();
  const errors = useStore(form.store, (s) => s.errorMap.onServer as string[] | undefined);
  if (!errors?.length) return null;
  return (
    <ul role="alert" data-form-errors="">
      {errors.map((e, i) => (
        <li key={i}>{e}</li>
      ))}
    </ul>
  );
}

/** Submit button disabled while the form is submitting (mirrors `TSubmitButton`). */
export function SubmitButton(props: ComponentPropsWithoutRef<"button">) {
  const form = useFormContext();
  return (
    <form.Subscribe selector={(s) => s.isSubmitting}>
      {(isSubmitting) => (
        <button type="submit" disabled={isSubmitting || props.disabled} {...props} />
      )}
    </form.Subscribe>
  );
}
