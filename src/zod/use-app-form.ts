import type { $ZodType } from "zod/v4/core";

import {
  type AnyFormApi,
  type AppFieldExtendedReactFormApi,
  createFormHook,
  type FormAsyncValidateOrFn,
  type FormOptions,
  type FormValidateOrFn,
  mergeForm,
  revalidateLogic,
} from "@tanstack/react-form";
import { useCallback, useEffect, useRef } from "react";
import {
  type Fetcher,
  type FetcherWithComponents,
  type FormEncType,
  type HTMLFormMethod,
  useNavigation,
  useSubmit,
} from "react-router";
import { fieldContext, formContext } from "./context";
import { objectToFormData, type SubmissionResponse } from "./server-validation";
import type { FormSubmitMeta } from "./app-form";

export type AppForm = ReturnType<typeof useAppForm>;

const fieldComponents = {
  // TODO: figure out how to allow consumers to register the field components.
};
const formComponents = {
  // TODO: figure out how to allow consumers to register the form components.
};

export const { useAppForm: useAppFormBase, withForm } = createFormHook({
  fieldComponents,
  formComponents,
  formContext,
  fieldContext,
});

/**
 * App-level wrapper around TanStack Form's `useAppForm` that provides
 * opinionated defaults for validation, server error handling, and submit
 * behavior.
 *
 * This mirrors the full generic signature of TanStack's `useAppForm` so that
 * all type inference flows through to the consumer without casts. The
 * `TOnDynamic` slot is fixed to `$ZodType<unknown, TFormData>` since we always
 * validate against a Zod schema (output type is unconstrained to support
 * schemas with transforms).
 *
 * `TSubmitMeta` is intersected with `FormSubmitMeta` so consumers can extend
 * the submit meta with additional data while guaranteeing the form event is
 * always available.
 */
export function useAppForm<
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
  onServerSuccess: onSuccessCallback,
  onServerFailure: onFailureCallback,
  schema,
  serverResult,
  id,
  shouldRevalidatePage = true,
  ...options
}: FormOptions<
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
  TSubmitMeta & FormSubmitMeta
> & {
  /**
   * An optional fetcher to use instead of the built-in react router Form
   * component.
   */
  fetcher?: FetcherWithComponents<unknown>;
  /**
   * Whether or not to enable the behavior of focusing the first invalid field
   * on submit. Defaults to `true`.
   */
  focusOnError?: boolean;
  /**
   * Callback that fires after the server returns a successful response and
   * submission/revalidation has completed.
   * @returns void
   */
  onServerSuccess?: () => void;
  /**
   * Callback that fires after the server returns a failure response and
   * submission/revalidation has completed.
   * @returns void
   */
  onServerFailure?: () => void;
  /**
   * Zod schema of the form
   */
  schema: $ZodType<unknown, TFormData>;
  /**
   * The latest result from server-side validation that might include field or
   * form errors. Also indicates whether the submission was successful.
   */
  serverResult?: SubmissionResponse | undefined;
  /**
   * Determines whether to allow React Router to revalidate the page after submission (fire all loaders).
   * Defaults to true, can be set to false to prevent page revalidation on successful form submission
   */
  shouldRevalidatePage?: boolean;
  /**
   * ID of the form being created.
   */
  id?: string;
}): AppFieldExtendedReactFormApi<
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
  TSubmitMeta & FormSubmitMeta,
  typeof fieldComponents,
  typeof formComponents
> & { fetcher?: FetcherWithComponents<unknown>; id?: string } {
  useOnSuccess({
    serverResult,
    fetcher,
    onSuccessCallback,
  });
  useOnFailure({
    serverResult,
    fetcher,
    onFailureCallback,
  });
  const submit = useSubmit();

  const hook = useAppFormBase({
    listeners: {
      ...listeners,
      onChange(props) {
        serverErrorListeners.onChange(props as never);
        listeners?.onChange?.(props as never);
      },
    },
    validationLogic: revalidateLogic({
      mode: "submit",
      modeAfterSubmission: "change",
    }),
    validators: {
      onDynamic: schema,
    },
    async onSubmit({ meta, value }) {
      meta.event?.preventDefault();
      const method =
        (meta.target?.method as HTMLFormMethod | undefined) ??
        meta.method ??
        "post";
      const action = meta.target?.action
        ? new URL(meta.target.action).pathname
        : meta.action;
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
    onSubmitInvalid({ meta }) {
      meta.event?.preventDefault();
      if (focusOnError) {
        const invalidInput = document.querySelector(
          '[aria-invalid="true"]',
        ) as HTMLInputElement | null;
        invalidInput?.focus();
      }
    },
    transform: useTransform(
      (baseForm) => {
        if (!serverResult) return baseForm;
        return mergeServerErrors(baseForm, serverResult);
      },
      [serverResult],
    ),
    ...options,
  });
  if (fetcher) {
    Object.assign(hook, { fetcher });
  }
  if (id) {
    Object.assign(hook, { id });
  }
  return hook;
}

/**
 * Merges server-returned errors into the client-side form state. Handles both
 * form-level errors (via `mergeForm`) and field-level errors (via `fieldMetaBase`).
 *
 * Fields are marked `isTouched: true` so that TanStack Form treats them as visited
 * and displays errors immediately, matching the behavior of fields the user has
 * already interacted with.
 */
function mergeServerErrors(
  baseForm: AnyFormApi,
  serverResult: SubmissionResponse,
) {
  mergeForm(baseForm, {
    errorMap: serverResult.errorMap,
  });

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
  onChange: ({
    fieldApi,
  }: {
    fieldApi: { form: AnyFormApi; name: string };
  }) => {
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
 * Form's`transform` option expects `(data: unknown) => unknown`, but the actual
 * runtime receives an `AnyFormApi` and returns one. This is the same pattern
 * used in `@tanstack/react-form-remix`'s `useTransform` — the cast is
 * unavoidable because the library doesn't export a properly-typed hook for
 * this.
 */
const useTransform: (
  fn: (formBase: AnyFormApi) => AnyFormApi,
  deps?: unknown[],
) => (data: unknown) => unknown = useCallback as never;

/**
 * We hate useEffects but might as well hide them in this one usage and provide
 * a convenient callback for consumers to react to server success without
 * needing to add their own useEffect. Keep your friends close, and your
 * useEffects closer.
 * @param options
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
 * Mirror of success callback but for failure case. Can probably be combined once Justin's
 * infinite render loop lands but avoiding conflicts for now
 * @param serverResult
 * @param fetcher
 * @param onFailureCallback
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
  // serverFailure is only true if we have received a response (not undefined) and that response success status if `false`
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
