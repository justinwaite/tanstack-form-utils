# @justinwaite/tanstack-form-utils

Opinionated helpers for using [TanStack Form](https://tanstack.com/form) with
[React Router](https://reactrouter.com) framework mode. You bring your own field
and form components and a single schema; the library wires up client-side
validation, native `<Form>` submission, server-side validation with the **same
schema**, and server→client error merging.

Two schema flavors are shipped as separate entry points:

- [`@justinwaite/tanstack-form-utils/zod`](#zod) — validate with a Zod schema.
- [`@justinwaite/tanstack-form-utils/effect`](#effect) — validate with an Effect
  `Schema`.

The root entry point [`@justinwaite/tanstack-form-utils`](#root) exposes the
shared pieces (the `<AppForm>` element, FormData helpers, and a context factory).

---

## Install

```sh
pnpm add @justinwaite/tanstack-form-utils
```

Peer dependencies (install what you use):

```sh
pnpm add @tanstack/react-form react react-router
pnpm add zod      # for the /zod entry
pnpm add effect   # for the /effect entry
```

---

## How it fits together

Both flavors follow the same five-step shape. Only the schema type and the
server parse helper differ.

1. **Create contexts** once with `createFormHookContexts()` and keep the
   `useFieldContext` / `useFormContext` hooks for your components to read.
2. **Build your field/form components** (an `<Input>`, `<SubmitButton>`, etc.).
   Each reads form state via the contexts from step 1.
3. **Create the form hook** with `createAppFormHook` (exported from both the
   `/zod` and `/effect` entry points), passing the contexts and your component
   maps. You get back a typed `useAppForm` (and `withForm`).
4. **Render** a form with the `<AppForm>` element and your registered
   components. Submitting serializes the values to `FormData` and posts them via
   React Router (or a `fetcher`).
5. **Validate on the server** in your `action` with `parseSubmission` (same name
   in both entry points) using the _same schema_, and return the `reply()` as
   `actionData`. Feed that back into `useAppForm` as `serverResult` to surface
   field- and form-level server errors inline.

Because the client validates the live (typed) values while the server validates
parsed `FormData` (all strings), the server parse helpers **coerce strings back
to the schema's expected types** (`"2"` → `2`, `"on"` → `true`, …) so the same
schema passes on both sides. See [Type coercion](#type-coercion).

---

## <a id="zod"></a>`/zod`

### Exports

| Export                                              | Kind      | Description                                                                                        |
| --------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------- |
| `createAppFormHook(config)`                         | function  | Creates `{ useAppForm, withForm }` bound to your contexts + components.                            |
| `useOnSuccess` / `useOnFailure`                     | hooks     | Run a callback once after the server reports success/failure and the navigation/fetcher goes idle. |
| `parseSubmission(payload, { schema })`              | function  | Parse + validate `FormData` / `URLSearchParams` / an object on the server.                         |
| `formDataToObject`, `objectToFormData`, `parsePath` | functions | FormData ⇄ nested object helpers (re-exported from the root).                                      |
| `SubmissionResponse`                                | type      | Normalized server result shape.                                                                    |

### Setup

```ts
// app/forms/form.ts
import { createFormHookContexts } from "@tanstack/react-form";
import { createAppFormHook } from "@justinwaite/tanstack-form-utils/zod";

import { TextField } from "./fields/text-field";
import { SubmitButton } from "./fields/submit-button";
import { FormErrors } from "./fields/form-errors";

export const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts();

export const { useAppForm, withForm } = createAppFormHook({
  fieldContext,
  formContext,
  fieldComponents: { TextField },
  formComponents: { SubmitButton, FormErrors },
});
```

A field component reads its state from `useFieldContext` (from the same
`createFormHookContexts()` call):

```tsx
// app/forms/fields/text-field.tsx
import { useStore } from "@tanstack/react-form";
import { useFieldContext } from "../form";

export function TextField({ label }: { label: string }) {
  const field = useFieldContext<string>();
  const errors = useStore(field.store, (s) => s.meta.errors);
  return (
    <label>
      {label}
      <input
        name={field.name}
        value={field.state.value}
        onChange={(e) => field.handleChange(e.target.value)}
        onBlur={field.handleBlur}
        aria-invalid={errors.length > 0}
      />
      {errors.length > 0 && <span role="alert">{errors[0]?.message}</span>}
    </label>
  );
}
```

### Client component

```tsx
// app/routes/signup.tsx
import { z } from "zod";
import { AppForm } from "@justinwaite/tanstack-form-utils";
import type { Route } from "./+types/signup";
import { useAppForm } from "../forms/form";

const SignupSchema = z.object({
  email: z.string().email(),
  age: z.number().min(18),
  subscribed: z.boolean(),
});

export default function Signup({ actionData }: Route.ComponentProps) {
  const form = useAppForm({
    schema: SignupSchema,
    serverResult: actionData,
    defaultValues: { email: "", age: 0, subscribed: false },
    onServerSuccess: () => console.log("saved!"),
  });

  return (
    <AppForm form={form} method="post">
      <form.AppField name="email">{(field) => <field.TextField label="Email" />}</form.AppField>
      <form.AppField name="age">{(field) => <field.TextField label="Age" />}</form.AppField>
      <form.AppForm>
        <form.FormErrors />
        <form.SubmitButton>Sign up</form.SubmitButton>
      </form.AppForm>
    </AppForm>
  );
}
```

### Server action

```ts
// app/routes/signup.tsx (continued)
export async function action({ request }: Route.ActionArgs) {
  const submission = parseSubmission(await request.formData(), {
    schema: SignupSchema,
  });

  if (submission.status === "error") {
    // `reply()` turns Zod issues into field/form errors for the client.
    return submission.reply();
  }

  // submission.value is fully typed: { email: string; age: number; subscribed: boolean }
  await createUser(submission.value);

  // Optionally attach manual errors: submission.reply({ formErrors: ["..."] })
  return submission.reply();
}
```

`parseSubmission` returns a discriminated union:

```ts
type Submission =
  | { status: "success"; value: Output; reply: ReplyFn }
  | { status: "error"; error: z.ZodError; reply: ReplyFn };
```

Call `reply()` (optionally with `{ formErrors, fieldErrors }`) to produce the
`SubmissionResponse` you return as `actionData` and pass back via `serverResult`.

---

## <a id="effect"></a>`/effect`

Identical ergonomics to `/zod`, but the schema is an Effect `Schema` and the
server helper is an `Effect`.

### Exports

| Export                                        | Kind     | Description                                                                             |
| --------------------------------------------- | -------- | --------------------------------------------------------------------------------------- |
| `createAppFormHook(config)`                   | function | Creates `{ useAppForm, withForm }` bound to your contexts + components.                 |
| `useOnSuccess` / `useOnFailure`               | hooks    | Same as the Zod flavor.                                                                 |
| `parseSubmission(request, { schema, init? })` | function | Yields `{ value, reply }`; fails with `FormValidationError` on invalid input.           |
| `FormValidationError`                         | class    | Tagged error carrying the `reply` (returned, not thrown, so it populates `actionData`). |
| `SubmissionReplyFn`                           | type     | The `reply` function returned on success.                                               |

### Setup

```ts
// app/forms/form.ts
import { createFormHookContexts } from "@tanstack/react-form";
import { createAppFormHook } from "@justinwaite/tanstack-form-utils/effect";

import { TextField } from "./fields/text-field";
import { SubmitButton } from "./fields/submit-button";

export const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts();

export const { useAppForm, withForm } = createAppFormHook({
  fieldContext,
  formContext,
  fieldComponents: { TextField },
  formComponents: { SubmitButton },
});
```

### Client component

```tsx
import { Schema } from "effect";
import { AppForm } from "@justinwaite/tanstack-form-utils";
import { useAppForm } from "../forms/form";

const SignupSchema = Schema.Struct({
  email: Schema.String,
  age: Schema.Number,
  // Use DateFromString (not Schema.Date) for form date fields — see Type coercion.
  startsOn: Schema.optional(Schema.DateFromString),
});

export default function Signup({ actionData }) {
  const form = useAppForm({
    schema: SignupSchema,
    serverResult: actionData,
    defaultValues: { email: "", age: 0, startsOn: undefined },
  });

  return (
    <AppForm form={form} method="post">
      <form.AppField name="email">{(field) => <field.TextField label="Email" />}</form.AppField>
      <form.AppForm>
        <form.SubmitButton>Sign up</form.SubmitButton>
      </form.AppForm>
    </AppForm>
  );
}
```

### Server action

`parseSubmission` is yieldable. Return its `reply()` on success; on a
validation error it fails with `FormValidationError`, whose `reply` you return
so React Router populates `actionData` without hitting the error boundary.

```ts
import { Effect } from "effect";
import { parseSubmission, FormValidationError } from "@justinwaite/tanstack-form-utils/effect";

export async function action({ request }: Route.ActionArgs) {
  const program = Effect.gen(function* () {
    const { value, reply } = yield* parseSubmission(request, {
      schema: SignupSchema,
    });

    yield* createUser(value); // value is typed: { email: string; age: number; ... }

    return reply();
  }).pipe(
    // Validation failures are returned (not thrown) as actionData.
    Effect.catchTag("FormValidationError", (e: FormValidationError<{ reply: unknown }>) =>
      Effect.succeed(e.reply.reply),
    ),
  );

  return Effect.runPromise(program);
}
```

---

## <a id="root"></a>Root (`@justinwaite/tanstack-form-utils`)

Shared, flavor-agnostic exports.

| Export                   | Kind      | Description                                                                                                                                                                                          |
| ------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AppForm`                | component | Wraps React Router's `<Form>` (or `fetcher.Form`), captures the submitter `intent`, and renders inside `form.AppForm`. Pass `form={...}` plus any `<Form>` props (`method`, `action`, `encType`, …). |
| `createFormHookContexts` | function  | Re-export of TanStack's context factory (convenience).                                                                                                                                               |
| `objectToFormData(obj)`  | function  | Serialize a nested object to `FormData` using dot/bracket paths (`items.0.name`, empty-array sentinel `key[]`).                                                                                      |
| `formDataToObject(fd)`   | function  | Inverse — parse `FormData` / `URLSearchParams` into a nested object.                                                                                                                                 |
| `parsePath(name)`        | function  | Parse a field path string (`items[0].name`) into segments.                                                                                                                                           |
| `FormSubmitMeta`         | type      | Submit metadata (`event`, `target`, `method`, …) threaded through submission.                                                                                                                        |
| `SubmissionResponse`     | type      | `{ success, errorMap, fieldErrors }` — the server result shape.                                                                                                                                      |

---

## `useAppForm` options

Beyond TanStack Form's standard `FormOptions` (`defaultValues`, `validators`,
`listeners`, …), the returned `useAppForm` accepts:

| Option                 | Type                             | Default | Description                                                                                                            |
| ---------------------- | -------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------- |
| `schema`               | Zod `$ZodType` / Effect `Schema` | —       | **Required.** Validates the form on `onDynamic`. The same schema is used server-side.                                  |
| `serverResult`         | `SubmissionResponse`             | —       | The latest `actionData`. Field/form server errors are merged into form state; editing a field clears its server error. |
| `fetcher`              | `FetcherWithComponents`          | —       | Submit via a fetcher instead of a navigation (`<AppForm>` uses `fetcher.Form`).                                        |
| `focusOnError`         | `boolean`                        | `true`  | Focus the first `[aria-invalid="true"]` field on a failed submit.                                                      |
| `onServerSuccess`      | `() => void`                     | —       | Fires once after the server reports success and the request settles.                                                   |
| `onServerFailure`      | `() => void`                     | —       | Fires once after the server reports failure and the request settles.                                                   |
| `shouldRevalidatePage` | `boolean`                        | `true`  | Whether React Router revalidates loaders after a successful submit.                                                    |
| `id`                   | `string`                         | —       | Form id, applied to the rendered `<form>`.                                                                             |

The hook returns the standard app-form API (with your registered
`form.AppField` / `form.AppForm` components), plus `fetcher` and `id` when
provided.

---

## Type coercion

`FormData` is all strings, so a `number`/`boolean`/`bigint` field arrives on the
server as `"2"` / `"on"` / `"9"`. To keep the **same schema** valid on both
client and server, `parseSubmission` and `parseSubmission` introspect your
schema and coerce string leaves to the expected types before validating — with
no changes to your schema and no type metadata on the wire (so plain,
no-JavaScript form posts work too).

Coerced today: `number`, `boolean` (`"on"`/`"true"` → `true`, `"false"` →
`false`), `bigint`, and empty strings → `undefined` (so `.optional()` fields
pass). A value that can't convert is left as the original string so the
validator still reports a proper "expected …" error.

**Effect dates:** use `Schema.DateFromString` for date fields — it decodes a
string natively (and is left untouched by coercion). `Schema.Date` expects a
real `Date` instance and cannot be coerced from a form string. (Zod's
`z.date()` _is_ coerced.)

Not yet coerced (passed through untouched): genuine multi-member unions, mixed
tuples, records, literals, and recursive schemas.
