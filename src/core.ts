/**
 * Shared runtime + types behind the Zod and Effect `useAppForm` factories.
 *
 * Everything here is independent of both the schema library and the registered
 * field/form components. Each variant factory (`createAppFormHook`, exported
 * from both `/zod` and `/effect`) supplies its own typed wrapper that:
 *   1. calls `createFormHook` with the consumer-provided contexts + components,
 *   2. converts its schema into a TanStack `onDynamic` validator,
 *   3. spreads `useSharedFormProps(...)` into `useAppFormBase` for the submit,
 *      validation, server-error-merge, and success/failure behavior.
 *
 * The big generic signatures are factored into `AppFormOptions` / `AppFormReturn`
 * so the variants only differ in their schema type and one conversion line.
 */

import {
  type AnyFormApi,
  type AppFieldExtendedReactFormApi,
  type FormAsyncValidateOrFn,
  type FormOptions,
  type FormValidateOrFn,
  mergeForm,
  revalidateLogic,
} from "@tanstack/react-form";
import { type ComponentType, useCallback, useEffect, useRef } from "react";
import {
  type Fetcher,
  type FetcherWithComponents,
  type FormEncType,
  type HTMLFormMethod,
  useNavigation,
  useSubmit,
} from "react-router";

import { type FormSubmitMeta } from "./app-form.tsx";
import { objectToFormData, type SubmissionResponse } from "./server-validation.ts";

/** Options every variant adds on top of TanStack's `FormOptions`. */
export type AppFormExtras<TSchema> = {
  /**
   * An optional fetcher to use instead of the built-in React Router `Form`.
   */
  fetcher?: FetcherWithComponents<unknown>;
  /**
   * Whether to focus the first invalid field on submit. Defaults to `true`.
   */
  focusOnError?: boolean;
  /**
   * Fires after the server returns a successful response and
   * submission/revalidation has settled.
   */
  onServerSuccess?: () => void;
  /**
   * Fires after the server returns a failure response and
   * submission/revalidation has settled.
   */
  onServerFailure?: () => void;
  /** Schema used for client-side validation (Zod or Effect, per variant). */
  schema: TSchema;
  /**
   * Latest server-validation result; merged into client form state and used to
   * drive `onServerSuccess` / `onServerFailure`.
   */
  serverResult?: SubmissionResponse | undefined;
  /**
   * Whether React Router should revalidate the page (fire loaders) after a
   * successful submission. Defaults to `true`.
   */
  shouldRevalidatePage?: boolean;
  /** ID of the form being created. */
  id?: string;
};

/** Full options object accepted by a variant's `useAppForm`. */
export type AppFormOptions<
  TFormData,
  TOnMount extends undefined | FormValidateOrFn<TFormData>,
  TOnChange extends undefined | FormValidateOrFn<TFormData>,
  TOnChangeAsync extends undefined | FormAsyncValidateOrFn<TFormData>,
  TOnBlur extends undefined | FormValidateOrFn<TFormData>,
  TOnBlurAsync extends undefined | FormAsyncValidateOrFn<TFormData>,
  TOnSubmit extends undefined | FormValidateOrFn<TFormData>,
  TOnSubmitAsync extends undefined | FormAsyncValidateOrFn<TFormData>,
  TOnDynamic extends undefined | FormValidateOrFn<TFormData>,
  TOnDynamicAsync extends undefined | FormAsyncValidateOrFn<TFormData>,
  TOnServer extends undefined | FormAsyncValidateOrFn<TFormData>,
  TSubmitMeta,
  TSchema,
> = FormOptions<
  TFormData,
  TOnMount,
  TOnChange,
  TOnChangeAsync,
  TOnBlur,
  TOnBlurAsync,
  TOnSubmit,
  TOnSubmitAsync,
  TOnDynamic,
  TOnDynamicAsync,
  TOnServer,
  TSubmitMeta & FormSubmitMeta
> &
  AppFormExtras<TSchema>;

/** Return type of a variant's `useAppForm`. */
export type AppFormReturn<
  TFormData,
  TOnMount extends undefined | FormValidateOrFn<TFormData>,
  TOnChange extends undefined | FormValidateOrFn<TFormData>,
  TOnChangeAsync extends undefined | FormAsyncValidateOrFn<TFormData>,
  TOnBlur extends undefined | FormValidateOrFn<TFormData>,
  TOnBlurAsync extends undefined | FormAsyncValidateOrFn<TFormData>,
  TOnSubmit extends undefined | FormValidateOrFn<TFormData>,
  TOnSubmitAsync extends undefined | FormAsyncValidateOrFn<TFormData>,
  TOnDynamic extends undefined | FormValidateOrFn<TFormData>,
  TOnDynamicAsync extends undefined | FormAsyncValidateOrFn<TFormData>,
  TOnServer extends undefined | FormAsyncValidateOrFn<TFormData>,
  TSubmitMeta,
  TFieldComponents extends Record<string, ComponentType<any>>,
  TFormComponents extends Record<string, ComponentType<any>>,
> = AppFieldExtendedReactFormApi<
  TFormData,
  TOnMount,
  TOnChange,
  TOnChangeAsync,
  TOnBlur,
  TOnBlurAsync,
  TOnSubmit,
  TOnSubmitAsync,
  TOnDynamic,
  TOnDynamicAsync,
  TOnServer,
  TSubmitMeta & FormSubmitMeta,
  TFieldComponents,
  TFormComponents
> & { fetcher?: FetcherWithComponents<unknown>; id?: string };

/**
 * Builds the shared `useAppFormBase` props every variant needs: submit→fetcher
 * wiring, the revalidate-on-submit logic, server-error clearing, server-error
 * merge via `transform`, and the success/failure effects.
 *
 * The variant is responsible only for `validators.onDynamic` (its converted
 * schema); it spreads the result of this hook into `useAppFormBase` alongside
 * that and any caller-supplied `...options`.
 */
export function useSharedFormProps({
  fetcher,
  focusOnError,
  listeners,
  serverResult,
  shouldRevalidatePage,
  onServerSuccess,
  onServerFailure,
}: {
  fetcher?: FetcherWithComponents<unknown>;
  focusOnError: boolean;
  // Typed loosely: the real `FormListeners<...>` is heavily generic and this is
  // internal glue spread back into `useAppFormBase`. The variant's public
  // signature is what enforces listener correctness for consumers.
  listeners?: any;
  serverResult?: SubmissionResponse | undefined;
  shouldRevalidatePage: boolean;
  onServerSuccess?: () => void;
  onServerFailure?: () => void;
}) {
  useOnSuccess({ serverResult, fetcher, onSuccessCallback: onServerSuccess });
  useOnFailure({ serverResult, fetcher, onFailureCallback: onServerFailure });

  const submit = useSubmit();

  const transform = useTransform(
    (baseForm) => {
      if (!serverResult) return baseForm;
      return mergeServerErrors(baseForm, serverResult);
    },
    [serverResult],
  );

  return {
    listeners: {
      ...listeners,
      // `props` is typed loosely here because this object is built outside the
      // contextual type of `useAppFormBase`; the variant spreads it in and the
      // public signature provides the real type safety.
      onChange(props: any) {
        serverErrorListeners.onChange(props);
        listeners?.onChange?.(props);
      },
    },
    validationLogic: revalidateLogic({
      mode: "submit",
      modeAfterSubmission: "change",
    }),
    // `props` is typed `any` so these handlers don't pin `useAppFormBase`'s
    // submit-meta inference to bare `FormSubmitMeta` — the variant's public
    // signature owns the real `TSubmitMeta & FormSubmitMeta` type. We read the
    // meta through a local `FormSubmitMeta` annotation for field-access safety.
    async onSubmit(props: any) {
      const value: unknown = props.value;
      const meta = props.meta as FormSubmitMeta;
      meta.event?.preventDefault();
      const method = (meta.target?.method as HTMLFormMethod | undefined) ?? meta.method ?? "post";
      const action = meta.target?.action ? new URL(meta.target.action).pathname : meta.action;
      const encType =
        (meta.target?.enctype as FormEncType | undefined) ??
        meta.encType ??
        "application/x-www-form-urlencoded";
      const formData = objectToFormData(value);
      await (fetcher?.submit ?? submit)(formData, {
        method,
        action,
        encType,
        defaultShouldRevalidate: shouldRevalidatePage,
      });
    },
    onSubmitInvalid(props: any) {
      const meta = props.meta as FormSubmitMeta;
      meta.event?.preventDefault();
      if (focusOnError) {
        const invalidInput = document.querySelector(
          '[aria-invalid="true"]',
        ) as HTMLInputElement | null;
        invalidInput?.focus();
      }
    },
    transform,
  };
}

/**
 * Merges server-returned errors into the client-side form state. Handles both
 * form-level errors (via `mergeForm`) and field-level errors (via `fieldMetaBase`).
 *
 * Fields are marked `isTouched: true` so that TanStack Form treats them as
 * visited and displays errors immediately, matching the behavior of fields the
 * user has already interacted with.
 */
function mergeServerErrors(baseForm: AnyFormApi, serverResult: SubmissionResponse): AnyFormApi {
  mergeForm(baseForm, { errorMap: serverResult.errorMap });

  for (const [field, error] of Object.entries(serverResult.fieldErrors)) {
    if (!error) continue;
    const issueFormat = [{ message: error }];
    const existing = baseForm.state.fieldMetaBase[field];
    if (existing) {
      existing.errorMap = { ...existing.errorMap, onServer: issueFormat };
      existing.isTouched = true;
    } else {
      baseForm.state.fieldMetaBase[field] = {
        isValidating: false,
        isTouched: true,
        isBlurred: true,
        isDirty: false,
        errorMap: { onServer: issueFormat },
        errorSourceMap: {},
        _arrayVersion: 0,
      };
    }
  }

  return baseForm;
}

/**
 * Field-level listener that clears server errors when a field value changes.
 * Without this, server errors persist indefinitely since they live in a
 * separate `onServer` slot of the errorMap that client-side validation never
 * touches.
 */
const serverErrorListeners = {
  onChange: ({ fieldApi }: { fieldApi: { form: AnyFormApi; name: string } }) => {
    const meta = fieldApi.form.getFieldMeta(fieldApi.name);
    if (meta?.errorMap.onServer) {
      fieldApi.form.setFieldMeta(fieldApi.name, (prev) => ({
        ...prev,
        errorMap: { ...prev.errorMap, onServer: undefined },
      }));
    }
    if (fieldApi.form.state.errorMap.onServer) {
      fieldApi.form.setErrorMap({ onServer: undefined });
    }
  },
} as const;

/**
 * Aliased from `useCallback` to get memoization with a deps array. TanStack
 * Form's `transform` option expects `(data: unknown) => unknown`, but the actual
 * runtime receives an `AnyFormApi` and returns one. This is the same pattern
 * used in `@tanstack/react-form-remix`'s `useTransform` — the cast is
 * unavoidable because the library doesn't export a properly-typed hook for this.
 */
const useTransform: (
  fn: (formBase: AnyFormApi) => AnyFormApi,
  deps?: unknown[],
) => (data: unknown) => unknown = useCallback as never;

/**
 * Fires `onSuccessCallback` once after the server reports success and the
 * submission/revalidation has gone idle.
 */
export function useOnSuccess({
  serverResult,
  fetcher,
  onSuccessCallback,
}: {
  serverResult?: SubmissionResponse;
  fetcher?: Fetcher;
  onSuccessCallback?: () => void;
}) {
  const calledRef = useRef(false);
  const navigation = useNavigation();
  const idle = fetcher ? fetcher.state === "idle" : navigation.state === "idle";
  const serverSuccess = serverResult?.success === true;

  useEffect(() => {
    if (serverSuccess && idle && !calledRef.current) {
      onSuccessCallback?.();
      calledRef.current = true;
    } else if (!serverSuccess || !idle) {
      calledRef.current = false;
    }
  }, [serverSuccess, idle, onSuccessCallback]);
}

/**
 * Mirror of {@link useOnSuccess} for the failure case.
 */
export function useOnFailure({
  serverResult,
  fetcher,
  onFailureCallback,
}: {
  serverResult?: SubmissionResponse;
  fetcher?: Fetcher;
  onFailureCallback?: () => void;
}) {
  const calledRef = useRef(false);
  const navigation = useNavigation();
  const idle = fetcher ? fetcher.state === "idle" : navigation.state === "idle";
  const serverFailure = serverResult?.success === false;

  useEffect(() => {
    if (serverFailure && idle && !calledRef.current) {
      onFailureCallback?.();
      calledRef.current = true;
    } else if (!serverFailure || !idle) {
      calledRef.current = false;
    }
  }, [serverFailure, idle, onFailureCallback]);
}
