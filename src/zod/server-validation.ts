import type { $ZodType, input, output } from "zod/v4/core";

import z from "zod";

import {
  formDataToObject,
  type SubmissionResponse,
} from "../server-validation";

export {
  formDataToObject,
  objectToFormData,
  parsePath,
  type SubmissionResponse,
} from "../server-validation";

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
  payload: FormData | URLSearchParams | unknown,
  { schema }: { schema: Schema },
): Submission<Schema> {
  const normalizedPayload =
    payload instanceof FormData || payload instanceof URLSearchParams
      ? formDataToObject(payload)
      : payload;
  const result = z.safeParse(schema, normalizedPayload);
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
      !!errorMap.onServer?.length ||
      !!error ||
      Object.values(fieldErrors).some(Boolean);
    return {
      success: !hasErrors,
      errorMap,
      fieldErrors,
    } satisfies SubmissionResponse;
  };
}
