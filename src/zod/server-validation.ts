import type { $ZodType, input, output } from "zod/v4/core";

import z from "zod";

import { formDataToObject, type SubmissionResponse } from "../server-validation.ts";
import { coerceFormValue } from "./coercion.ts";

export {
  formDataToObject,
  objectToFormData,
  parsePath,
  type SubmissionResponse,
} from "../server-validation.ts";

type Submission<Schema extends $ZodType> =
  | {
      status: "success";
      value: output<Schema>;
      reply: ReturnType<typeof createReplyFn<Schema>>;
    }
  | {
      status: "error";
      reply: ReturnType<typeof createReplyFn<Schema>>;
      error: z.ZodError<output<Schema>>;
    };

export function parseSubmission<Schema extends $ZodType>(
  // `FormData`/`URLSearchParams` are normalized below; any other value (e.g. an
  // already-parsed action payload) is passed straight to the schema.
  payload: unknown,
  { schema }: { schema: Schema },
): Submission<Schema> {
  let normalizedPayload: unknown;
  if (payload instanceof FormData || payload instanceof URLSearchParams) {
    try {
      normalizedPayload = formDataToObject(payload);
    } catch (cause) {
      // A malformed key path (e.g. both `"name"` and `"name.first"` submitted)
      // makes `formDataToObject` throw; surface that as a clear, catchable
      // error instead of the raw "Cannot create property" TypeError.
      throw new Error("Malformed form submission: conflicting field name paths", { cause });
    }
  } else {
    normalizedPayload = payload;
  }
  // Coerce string leaves (e.g. "2" → 2) toward the schema's expected types so
  // the server validates the same shape the client did. Already-typed values
  // pass through untouched, so this is safe for non-FormData payloads too.
  const coercedPayload = coerceFormValue(schema, normalizedPayload);
  const result = z.safeParse(schema, coercedPayload);
  if (result.success) {
    return {
      status: "success",
      value: result.data,
      reply: createReplyFn(),
    } satisfies Submission<Schema>;
  } else {
    return {
      status: "error",
      reply: createReplyFn(result.error),
      error: result.error,
    } satisfies Submission<Schema>;
  }
}

function createReplyFn<TSchema>(error?: z.ZodError<output<TSchema>>) {
  return function reply(options?: {
    formErrors?: string[];
    fieldErrors?: Partial<Record<keyof input<TSchema> & string, string>>;
  }) {
    const baseFieldErrors = error
      ? Object.fromEntries(
          error.issues
            .filter((issue) => issue.path.length > 0)
            .map((issue) => [issue.path.join("."), issue.message]),
        )
      : undefined;
    const errorMap = {
      onServer: options?.formErrors?.length ? options.formErrors : undefined,
    };
    const fieldErrors = {
      ...baseFieldErrors,
      ...options?.fieldErrors,
    } as Partial<Record<string, string>>;
    const hasErrors =
      !!errorMap.onServer?.length || !!error || Object.values(fieldErrors).some(Boolean);
    return {
      success: !hasErrors,
      errorMap,
      fieldErrors,
    } satisfies SubmissionResponse;
  };
}
