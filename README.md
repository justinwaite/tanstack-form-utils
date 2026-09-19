# @justinwaite/tanstack-form-utils

This package provides helpers that connect [TanStack Form](https://tanstack.com/form) to
[React Router](https://reactrouter.com) framework mode. You bring your own field components, your own form components, and one schema. The package then handles four tasks:

- Client-side validation.
- Native `<Form>` submission.
- Server-side validation with the same schema.
- Merging of server errors into the client form.

The package has two entry points, one for each schema library. Use [`@justinwaite/tanstack-form-utils/zod`](#zod) to validate with a Zod schema. Use [`@justinwaite/tanstack-form-utils/effect`](#effect) to validate with an Effect `Schema`.

The root entry point [`@justinwaite/tanstack-form-utils`](#root) exports the pieces that both entry points share. These pieces are the `<AppForm>` element, the FormData helpers, and a function that creates the form contexts.

---

## Install

Run this command to install the package:

```sh
pnpm add @justinwaite/tanstack-form-utils
```

Next, install the peer dependencies (packages that your project must provide) for the entry points that you use:

```sh
pnpm add @tanstack/react-form react react-router
pnpm add zod      # for the /zod entry
pnpm add effect   # for the /effect entry
```

---

## How it fits together

Both entry points follow the same five steps. Only the schema type and the server parse helper are different.

1. Create the contexts once with `createFormHookContexts()`. Keep the `useFieldContext` and `useFormContext` hooks for your components to read.
2. Build your field components and form components, for example an `<Input>` and a `<SubmitButton>`. Each component reads the form state through the contexts from step 1.
3. Create the form hook with `createAppFormHook`. Both the `/zod` and `/effect` entry points export it. Pass the contexts and your component maps to it. The call returns a typed `useAppForm` and `withForm`.
4. Render the form with the `<AppForm>` element and your registered components. When the user submits, the package serializes the values to `FormData` and posts them through React Router or a `fetcher`.
5. Validate on the server in your `action` with `parseSubmission`. Both entry points use the same name. Use the same schema that the client uses. Return the result of `reply()` as `actionData`. Pass `actionData` back to `useAppForm` as `serverResult`. The form then shows the field errors and the form errors from the server.

The client validates the live values that the user typed. The server validates parsed `FormData`, and all `FormData` values are strings. Because of this difference, the server parse helpers coerce (convert) the strings to the types that the schema expects. For example, `"2"` becomes `2` and `"on"` becomes `true`. The same schema then passes on both sides. See [Type coercion](#type-coercion).

---

## <a id="zod"></a>`/zod`

### Exports

| Export                                              | Kind      | Description                                                                                              |
| --------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------- |
| `createAppFormHook(config)`                         | function  | Creates `{ useAppForm, withForm }` bound to your contexts and components.                                |
| `useOnSuccess` / `useOnFailure`                     | hooks     | Run a callback once after the server reports success or failure and the navigation or fetcher goes idle. |
| `parseSubmission(payload, { schema })`              | function  | Parses and validates `FormData`, `URLSearchParams`, or an object on the server.                          |
| `formDataToObject`, `objectToFormData`, `parsePath` | functions | Helpers that convert between `FormData` and a nested object. Re-exported from the root.                  |
| `SubmissionResponse`                                | type      | The normalized shape of the server result.                                                               |

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

A field component reads its state from `useFieldContext`. Import the hook from the file that calls `createFormHookContexts()`:

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

`parseSubmission` returns a discriminated union (a union whose `status` field names the variant):

```ts
type Submission =
  | { status: "success"; value: Output; reply: ReplyFn }
  | { status: "error"; error: z.ZodError; reply: ReplyFn };
```

Call `reply()` to produce the `SubmissionResponse`. Optionally pass `{ formErrors, fieldErrors }` to it. Return the result as `actionData`, and pass it back through `serverResult`.

---

## <a id="effect"></a>`/effect`

The `/effect` entry point works like `/zod`. The schema is an Effect `Schema`, and the server helper is an `Effect`.

### Exports

| Export                                        | Kind     | Description                                                                                                   |
| --------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| `createAppFormHook(config)`                   | function | Creates `{ useAppForm, withForm }` bound to your contexts and components.                                     |
| `useOnSuccess` / `useOnFailure`               | hooks    | Same as in the `/zod` entry point.                                                                            |
| `parseSubmission(request, { schema, init? })` | function | Yields `{ value, reply }`. Fails with `FormValidationError` on invalid input.                                 |
| `FormValidationError`                         | class    | Tagged error that carries the `reply`. You return it instead of throwing it, so that it becomes `actionData`. |
| `SubmissionReplyFn`                           | type     | The `reply` function that `parseSubmission` returns on success.                                               |

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

`parseSubmission` is yieldable (you can use it with `yield*` inside `Effect.gen`). On success, return its `reply()`. On a validation error, it fails with `FormValidationError`. Return the `reply` of that error. React Router then fills `actionData` and does not use the error boundary.

`parseSubmission` selects the body parse method from the `Content-Type` header of the request. It reads a JSON media type (`application/json` or `*+json`) with `request.json()`. It reads any other type with `request.formData()`. If the body cannot be parsed, for example because the JSON or the form data is malformed, the Effect raises an `InvalidBodyError`.

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

The root entry point exports the pieces that do not depend on the schema library.

| Export                   | Kind      | Description                                                                                                                                                                                                    |
| ------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AppForm`                | component | Wraps the `<Form>` of React Router (or `fetcher.Form`). Captures the `intent` of the submitter and renders inside `form.AppForm`. Pass `form={...}` and any `<Form>` props (`method`, `action`, `encType`, …). |
| `createFormHookContexts` | function  | Re-export of the TanStack function that creates the contexts.                                                                                                                                                  |
| `objectToFormData(obj)`  | function  | Serializes a nested object to `FormData` with dot and bracket paths (`items.0.name`). The marker for an empty array is `key[]`.                                                                                |
| `formDataToObject(fd)`   | function  | The inverse. Parses `FormData` or `URLSearchParams` into a nested object.                                                                                                                                      |
| `parsePath(name)`        | function  | Parses a field path string (`items[0].name`) into segments.                                                                                                                                                    |
| `FormSubmitMeta`         | type      | Submit metadata (`event`, `target`, `method`, …) that the package passes through the submission.                                                                                                               |
| `SubmissionResponse`     | type      | `{ success, errorMap, fieldErrors }`. The shape of the server result.                                                                                                                                          |

For the security policy, see [SECURITY.md](./SECURITY.md).

---

## `useAppForm` configuration

`useAppForm` accepts the standard `FormOptions` of TanStack Form (`defaultValues`, `validators`, `listeners`, …). It also accepts these properties:

| Property               | Type                             | Default | Description                                                                                                                                                                            |
| ---------------------- | -------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema`               | Zod `$ZodType` / Effect `Schema` | None    | Required. Validates the form on `onDynamic`. The server uses the same schema.                                                                                                          |
| `serverResult`         | `SubmissionResponse`             | None    | The latest `actionData`. The form merges the field errors and form errors from the server into its state. When the user edits a field, the form clears the server error of that field. |
| `fetcher`              | `FetcherWithComponents`          | None    | Submits through a fetcher instead of a navigation. `<AppForm>` then uses `fetcher.Form`.                                                                                               |
| `focusOnError`         | `boolean`                        | `true`  | If a submit fails, focuses the first `[aria-invalid="true"]` field.                                                                                                                    |
| `onServerSuccess`      | `() => void`                     | None    | Runs once after the server reports success and the request finishes.                                                                                                                   |
| `onServerFailure`      | `() => void`                     | None    | Runs once after the server reports failure and the request finishes.                                                                                                                   |
| `shouldRevalidatePage` | `boolean`                        | `true`  | Controls whether React Router revalidates the loaders after a successful submit.                                                                                                       |
| `id`                   | `string`                         | None    | The form id. The package applies it to the rendered `<form>`.                                                                                                                          |

The hook returns the standard app-form API, with your registered `form.AppField` and `form.AppForm` components. If you provide `fetcher` and `id`, the hook also returns them.

---

## Type coercion

`FormData` contains only strings. A `number`, `boolean`, or `bigint` field therefore arrives on the server as `"2"`, `"on"`, or `"9"`. The same schema must be valid on both the client and the server. To achieve this, the `parseSubmission` helper in both entry points reads your schema. It coerces the string values to the expected types before it validates them. You do not change your schema, and no type metadata travels with the request. Plain form posts without JavaScript therefore also work.

The package coerces these types today:

- `number`.
- `boolean`: `"on"` and `"true"` become `true`, and `"false"` becomes `false`.
- `bigint`.
- Empty strings become `undefined`, so `.optional()` fields pass.

If a value cannot convert, the package keeps the original string. The validator then reports a normal "expected …" error.

For Effect date fields, use `Schema.DateFromString`. It decodes a string natively, and coercion leaves it unchanged. `Schema.Date` expects a real `Date` instance, so the package cannot coerce it from a form string. The package does coerce `z.date()` in Zod.

The package does not coerce these schema types yet. It passes them through unchanged:

- Genuine multi-member unions.
- Mixed tuples.
- Records.
- Literals.
- Recursive schemas.
