/**
 * Effect-schema variant of `useAppForm`.
 *
 * Drop-in replacement for `useAppForm` that accepts an Effect `Schema.Decoder`
 * instead of a Zod schema. The schema is converted to Standard Schema V1 format
 * internally so TanStack Form can run client-side validation identically to the
 * Zod version. All other options and return values are identical to `useAppForm`.
 *
 * Pair with `parseEffectSubmission` on the server so the same Effect schema
 * validates both client and server without maintaining two schemas.
 *
 * Note: Effect's `toStandardSchemaV1` returns `StandardSchemaV1<unknown, T>`
 * (encoded→type order) while TanStack expects `StandardSchemaV1<T, unknown>`
 * (input→output order). They are runtime-identical — only the `types` annotation
 * differs — so `TOnDynamic` is hardcoded to `FormValidateOrFn<TFormData>` and
 * a single targeted cast is applied internally.
 */

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
import { Schema } from "effect";
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
import { type FormSubmitMeta } from "./use-app-form";

const fieldComponents = {
  // TODO: figure out how to allow consumers to register field components
};
const formComponents = {
  // TODO: figure out how to allow consumers to register form components
};

const { useAppForm: useAppFormBase } = createFormHook({
  fieldComponents,
  formComponents,
  formContext,
  fieldContext,
});

/**
 * Converts an Effect `Schema.Decoder` to a TanStack-compatible `FormValidateOrFn`.
 *
 * Effect's `toStandardSchemaV1` returns `StandardSchemaV1<Encoded, Type>` while
 * TanStack's `FormValidateOrFn` requires `StandardSchemaV1<Input, Output>` with
 * the parameter order reversed. The runtime contract is identical; only the
 * `~standard.types` annotation differs. This targeted cast bridges the nominal gap.
 */
function toFormValidator<TFormData>(
  schema: Schema.Decoder<TFormData>,
): FormValidateOrFn<TFormData> {
  return Schema.toStandardSchemaV1(schema) as FormValidateOrFn<TFormData>;
}

/**
 * Effect-schema counterpart of `useAppForm`. Accepts a `Schema.Decoder` in
 * place of a Zod schema; everything else — field registration, submission,
 * server error merging, and `onServerSuccess` / `onServerFailure` callbacks —
 * behaves identically.
 *
 * `TOnDynamic` is fixed to `FormValidateOrFn<TFormData>` rather than exposed as
 * a generic because Effect's standard-schema type has reversed type parameters
 * vs TanStack's expectation. The runtime behavior is correct.
 */
export function useAppEffectForm<
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
  FormValidateOrFn<TFormData>,
  TOnDynamicAsync,
  TOnServer,
  TSubmitMeta & FormSubmitMeta
> & {
  /** Effect schema for client-side validation. */
  schema: Schema.Decoder<TFormData>;
  /** Latest `SubmissionResponse` from the server action. */
  serverResult?: SubmissionResponse | undefined;
  fetcher?: FetcherWithComponents<unknown>;
  focusOnError?: boolean;
  onServerSuccess?: () => void;
  onServerFailure?: () => void;
  shouldRevalidatePage?: boolean;
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
  FormValidateOrFn<TFormData>,
  TOnDynamicAsync,
  TOnServer,
  TSubmitMeta & FormSubmitMeta,
  typeof fieldComponents,
  typeof formComponents
> & { fetcher?: FetcherWithComponents<unknown>; id?: string } {
  useOnSuccess({ serverResult, fetcher, onSuccessCallback });
  useOnFailure({ serverResult, fetcher, onFailureCallback });

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
      onDynamic: toFormValidator(schema),
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

  if (fetcher) Object.assign(hook, { fetcher });
  if (id) Object.assign(hook, { id });

  return hook;
}

/**
 * Merges server-returned errors into the client-side form state. Handles both
 * form-level errors (via `mergeForm`) and field-level errors (via `fieldMetaBase`).
 */
function mergeServerErrors(
  baseForm: AnyFormApi,
  serverResult: SubmissionResponse,
): AnyFormApi {
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

/** Clears server errors when the user edits a field that had one. */
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

/** Memoised transform wrapper. See `useAppForm` for rationale. */
const useTransform: (
  fn: (formBase: AnyFormApi) => AnyFormApi,
  deps?: unknown[],
) => (data: unknown) => unknown = useCallback as never;

function useOnSuccess({
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

function useOnFailure({
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
