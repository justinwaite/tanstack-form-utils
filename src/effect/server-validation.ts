import { Data, Effect, Schema, SchemaIssue } from "effect";

import { formDataToObject, type SubmissionResponse } from "../server-validation.ts";
import { coerceFormValue } from "./coercion.ts";
import { FormDataError, parseFormData } from "./parse-form-data.ts";

/**
 * Signals a form validation failure. The reply is returned (not thrown) so
 * React Router populates `actionData` without triggering the error boundary.
 * Pair with a 4xx `init.status` so the response is correctly classified in
 * browser dev tools and server logs.
 */
export class FormValidationError extends Data.TaggedError("FormValidationError")<{
  readonly reply: SubmissionResponse;
  readonly init?: ResponseInit;
}> {}

// ─── Effect-schema form parsing ───────────────────────────────────────────────

/**
 * The reply function returned by a successful `parseSubmission` call.
 * Calling it with no arguments produces a success `SubmissionResponse`; passing
 * `formErrors` / `fieldErrors` lets you attach manual server-side annotations.
 */
export type SubmissionReplyFn = (opts?: {
  formErrors?: string[];
  fieldErrors?: Partial<Record<string, string>>;
}) => SubmissionResponse;

/** Singleton formatter — avoids recreating the closure on every request. */
const issueFormatter = SchemaIssue.makeFormatterStandardSchemaV1();

/** Normalises a Standard Schema V1 path segment to a string key. */
function pathSegmentToString(segment: PropertyKey | { readonly key: PropertyKey }): string {
  if (typeof segment === "object" && segment !== null) {
    return String((segment as { key: PropertyKey }).key);
  }
  return String(segment);
}

/** Maps Standard Schema V1 failure issues into the SubmissionResponse format. */
function schemaFailureToResponse(
  failureResult: ReturnType<typeof issueFormatter>,
): SubmissionResponse {
  const formErrors: string[] = [];
  const fieldErrors: Partial<Record<string, string>> = {};

  for (const issue of failureResult.issues) {
    if (!issue.path || issue.path.length === 0) {
      formErrors.push(issue.message);
    } else {
      fieldErrors[issue.path.map(pathSegmentToString).join(".")] = issue.message;
    }
  }

  return {
    success: false,
    errorMap: { onServer: formErrors.length > 0 ? formErrors : undefined },
    fieldErrors,
  };
}

/** Builds a reply function for the success branch of `parseSubmission`. */
function makeSubmissionReplyFn(): SubmissionReplyFn {
  return function reply(opts): SubmissionResponse {
    const formErrors = opts?.formErrors;
    const fieldErrors = opts?.fieldErrors ?? {};
    const hasErrors = (formErrors?.length ?? 0) > 0 || Object.values(fieldErrors).some(Boolean);
    return {
      success: !hasErrors,
      errorMap: { onServer: formErrors?.length ? formErrors : undefined },
      fieldErrors,
    };
  };
}

type ParseSubmissionResult<A> = Effect.Effect<
  { value: A; reply: SubmissionReplyFn },
  FormValidationError | FormDataError
>;

/**
 * Parses and validates form data from a request using an Effect schema.
 *
 * Combines three steps that are otherwise manual — body parsing, object
 * conversion, and schema decoding — into a single yieldable Effect:
 *
 * ```ts
 * const { value, reply } = yield* parseSubmission(request, { schema: MySchema });
 * return { reply: reply(), result: value.name };
 * ```
 *
 * **Failure modes:**
 * - Unreadable request body → `RouteFailure<string>` with status 422 (thrown,
 *   triggers error boundary — this is an unrecoverable protocol error, not a
 *   user-facing validation issue).
 * - Schema validation error → `FormValidationError<{ reply: SubmissionResponse }>` with
 *   status 400 (returned, populates `actionData` without triggering error boundary).
 *
 * The `init` option controls the HTTP status code of validation error responses
 * (defaults to 400). On success, call `reply()` to produce a `SubmissionResponse`
 * with `success: true` to pass back as `actionData`.
 */
export function parseSubmission<A>(
  request: Request,
  options: {
    schema: Schema.Decoder<A>;
    init?: ResponseInit;
  },
): ParseSubmissionResult<A> {
  const validationInit = options.init ?? { status: 400 };

  const toFormError = (response: SubmissionResponse): FormValidationError =>
    new FormValidationError({
      reply: response,
      init: validationInit,
    });

  return Effect.gen(function* () {
    const fd = yield* parseFormData(request);

    // Coerce string leaves (e.g. "2" → 2) toward the schema's expected types so
    // the server validates the same shape the client did.
    const input = coerceFormValue(options.schema, formDataToObject(fd));

    const value = yield* Schema.decodeUnknownEffect(options.schema)(input).pipe(
      Effect.mapError((schemaError) =>
        toFormError(schemaFailureToResponse(issueFormatter(schemaError.issue))),
      ),
    );

    return { value, reply: makeSubmissionReplyFn() };
  });
}
