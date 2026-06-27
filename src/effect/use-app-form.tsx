/**
 * Effect-schema variant of the `useAppForm` factory.
 *
 * Identical to the `/zod` variant except the schema is an Effect `Schema.Codec`
 * (converted to Standard Schema V1 internally) instead of a Zod schema. Pair
 * with `parseSubmission` on the server so one Effect schema validates both
 * client and server.
 *
 * Note: Effect's `toStandardSchemaV1` returns `StandardSchemaV1<unknown, T>`
 * (encoded→type order) while TanStack expects `StandardSchemaV1<T, unknown>`
 * (input→output order). They are runtime-identical — only the `types`
 * annotation differs — so the `TOnDynamic` slot is fixed to
 * `FormValidateOrFn<TFormData>` and a single targeted cast bridges the gap.
 */

import {
  type AnyFieldApi,
  type AnyFormApi,
  type FormAsyncValidateOrFn,
  type FormValidateOrFn,
  createFormHook,
} from "@tanstack/react-form";
import { Schema } from "effect";
import { type ComponentType, type Context } from "react";

import { type AppFormOptions, type AppFormReturn, useSharedFormProps } from "../core.ts";

export { useOnFailure, useOnSuccess } from "../core.ts";

/**
 * Converts an Effect `Schema.Codec` to a TanStack-compatible `FormValidateOrFn`.
 *
 * Effect's `toStandardSchemaV1` returns `StandardSchemaV1<Encoded, Type>` while
 * TanStack's `FormValidateOrFn` requires `StandardSchemaV1<Input, Output>` with
 * the parameter order reversed. The runtime contract is identical; only the
 * `~standard.types` annotation differs. This targeted cast bridges the nominal gap.
 */
function toFormValidator<TFormData>(
  schema: Schema.Codec<TFormData, unknown>,
): FormValidateOrFn<TFormData> {
  return Schema.toStandardSchemaV1(schema) as FormValidateOrFn<TFormData>;
}

/**
 * Creates an Effect-backed `useAppForm` (plus `withForm`) bound to the
 * consumer's own field/form components and form contexts. See the `/zod`
 * variant for the consumer setup pattern — this differs only in accepting a
 * `Schema.Codec` for `schema`.
 */
export function createAppFormHook<
  TFieldComponents extends Record<string, ComponentType<any>>,
  TFormComponents extends Record<string, ComponentType<any>>,
>(config: {
  fieldComponents: TFieldComponents;
  formComponents: TFormComponents;
  fieldContext: Context<AnyFieldApi>;
  formContext: Context<AnyFormApi>;
}) {
  const { useAppForm: useAppFormBase, ...exports } = createFormHook(config);

  /**
   * Effect-schema counterpart of `useAppForm`. Accepts a `Schema.Codec` in
   * place of a Zod schema; field registration, submission, server-error merging,
   * and `onServerSuccess` / `onServerFailure` behave identically.
   *
   * `TOnDynamic` is fixed to `FormValidateOrFn<TFormData>` rather than exposed as
   * a generic because Effect's standard-schema type has reversed type parameters
   * vs TanStack's expectation. The runtime behavior is correct.
   */
  function useAppForm<
    TFormData,
    TOnMount extends undefined | FormValidateOrFn<TFormData>,
    TOnChange extends undefined | FormValidateOrFn<TFormData>,
    TOnChangeAsync extends undefined | FormAsyncValidateOrFn<TFormData>,
    TOnBlur extends undefined | FormValidateOrFn<TFormData>,
    TOnBlurAsync extends undefined | FormAsyncValidateOrFn<TFormData>,
    TOnSubmit extends undefined | FormValidateOrFn<TFormData>,
    TOnSubmitAsync extends undefined | FormAsyncValidateOrFn<TFormData>,
    TOnDynamicAsync extends undefined | FormAsyncValidateOrFn<TFormData>,
    TOnServer extends undefined | FormAsyncValidateOrFn<TFormData>,
    TSubmitMeta,
  >({
    fetcher,
    focusOnError = true,
    listeners,
    onServerSuccess,
    onServerFailure,
    schema,
    serverResult,
    id,
    shouldRevalidatePage = true,
    ...options
  }: AppFormOptions<
    TFormData,
    TOnMount,
    TOnChange,
    TOnChangeAsync,
    TOnBlur,
    TOnBlurAsync,
    TOnSubmit,
    TOnSubmitAsync,
    FormValidateOrFn<TFormData>,
    TOnDynamicAsync,
    TOnServer,
    TSubmitMeta,
    Schema.Codec<TFormData, unknown>
  >): AppFormReturn<
    TFormData,
    TOnMount,
    TOnChange,
    TOnChangeAsync,
    TOnBlur,
    TOnBlurAsync,
    TOnSubmit,
    TOnSubmitAsync,
    FormValidateOrFn<TFormData>,
    TOnDynamicAsync,
    TOnServer,
    TSubmitMeta,
    TFieldComponents,
    TFormComponents
  > {
    const shared = useSharedFormProps({
      fetcher,
      focusOnError,
      listeners,
      serverResult,
      shouldRevalidatePage,
      onServerSuccess,
      onServerFailure,
    });

    const hook = useAppFormBase({
      ...shared,
      validators: { onDynamic: toFormValidator(schema) },
      ...options,
    });

    if (fetcher) Object.assign(hook, { fetcher });
    if (id) Object.assign(hook, { id });

    return hook as never;
  }

  return { useAppForm, ...exports };
}
