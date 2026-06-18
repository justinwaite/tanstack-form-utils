import type { $ZodType } from "zod/v4/core";

import {
  type AnyFieldApi,
  type AnyFormApi,
  type FormAsyncValidateOrFn,
  type FormValidateOrFn,
  createFormHook,
} from "@tanstack/react-form";
import { type ComponentType, type Context } from "react";

import {
  type AppFormOptions,
  type AppFormReturn,
  useSharedFormProps,
} from "../core";

export { useOnFailure, useOnSuccess } from "../core";

/**
 * Creates a Zod-backed `useAppForm` (plus `withForm`) bound to the consumer's
 * own field/form components and form contexts.
 *
 * The consumer owns the contexts — create them once with
 * `createFormHookContexts()` and pass them in alongside your component maps.
 * Use the matching `useFieldContext` / `useFormContext` from that same call
 * inside your components so they read the right context.
 *
 * ```ts
 * const { fieldContext, formContext, useFieldContext, useFormContext } =
 *   createFormHookContexts();
 *
 * export const { useAppForm, withForm } = createZodForm({
 *   fieldContext,
 *   formContext,
 *   fieldComponents: { Input, Checkbox },
 *   formComponents: { SubmitButton },
 * });
 * ```
 */
export function createZodForm<
  TFieldComponents extends Record<string, ComponentType<any>>,
  TFormComponents extends Record<string, ComponentType<any>>,
>(config: {
  fieldComponents: TFieldComponents;
  formComponents: TFormComponents;
  fieldContext: Context<AnyFieldApi>;
  formContext: Context<AnyFormApi>;
}) {
  const { useAppForm: useAppFormBase, withForm } = createFormHook(config);

  /**
   * App-level wrapper around TanStack Form's `useAppForm` that provides
   * opinionated defaults for validation, server error handling, and submit
   * behavior.
   *
   * Mirrors the full generic signature of TanStack's `useAppForm` so inference
   * flows through to the consumer without casts. The `TOnDynamic` slot is fixed
   * to `$ZodType<unknown, TFormData>` since we always validate against a Zod
   * schema (output type unconstrained to support schemas with transforms).
   *
   * `TSubmitMeta` is intersected with `FormSubmitMeta` so consumers can extend
   * the submit meta while guaranteeing the form event is always available.
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
    $ZodType<unknown, TFormData>,
    TOnDynamicAsync,
    TOnServer,
    TSubmitMeta,
    $ZodType<unknown, TFormData>
  >): AppFormReturn<
    TFormData,
    TOnMount,
    TOnChange,
    TOnChangeAsync,
    TOnBlur,
    TOnBlurAsync,
    TOnSubmit,
    TOnSubmitAsync,
    $ZodType<unknown, TFormData>,
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
      validators: { onDynamic: schema },
      ...options,
    });

    if (fetcher) Object.assign(hook, { fetcher });
    if (id) Object.assign(hook, { id });

    return hook as never;
  }

  return { useAppForm, withForm };
}
