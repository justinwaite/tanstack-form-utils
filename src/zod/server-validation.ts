import type { $ZodType, input, output } from "zod/v4/core";

import z from "zod";

import { ownOption, resolveLimits } from "../limits.ts";
import {
  assertSafePayload,
  formDataToObject,
  type FormDataLimits,
  type SubmissionResponse,
} from "../server-validation.ts";
import { coerceFormValue } from "./coercion.ts";

export {
  DEFAULT_FORM_DATA_LIMITS,
  FormDataParseError,
  formDataToObject,
  objectToFormData,
  parsePath,
  type FormDataLimits,
  type FormDataParseErrorReason,
  type SubmissionResponse,
} from "../server-validation.ts";
export { readRequestBody } from "../request-body.ts";

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

/**
 * Parses and validates a submission with a Zod schema. Pass `FormData`,
 * `URLSearchParams`, or an already-parsed value. To read a `Request` with a
 * body size limit and a duplicate-key check for JSON, use `readRequestBody`:
 *
 * ```ts
 * const submission = parseSubmission(await readRequestBody(request), { schema });
 * ```
 *
 * Throws `FormDataParseError` for a malformed or unsafe payload (see
 * SECURITY.md), and a `TypeError` if a limit is not a non-negative integer.
 * Reads `schema` and `limits` only as own properties of `options`, so a
 * polluted `Object.prototype` can't supply them.
 */
export function parseSubmission<Schema extends $ZodType>(
  // `FormData`/`URLSearchParams` are normalized below; any other value (e.g. an
  // already-parsed action payload) is passed straight to the schema.
  payload: unknown,
  options: { schema: Schema; limits?: Partial<FormDataLimits> },
): Submission<Schema> {
  const schema = ownOption(options, "schema") as Schema;
  const limits = resolveLimits(ownOption(options, "limits"));
  // Both branches throw `FormDataParseError` for a malformed or unsafe payload
  // (conflicting paths, `__proto__` keys, limits exceeded — see SECURITY.md).
  let normalizedPayload: unknown;
  if (payload instanceof FormData || payload instanceof URLSearchParams) {
    normalizedPayload = formDataToObject(payload, limits);
  } else {
    assertSafePayload(payload, limits);
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
