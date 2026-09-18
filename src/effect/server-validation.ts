import { Data, Effect, Schema, SchemaIssue } from "effect";

import {
  formDataToObject,
  isJsonContentType,
  type SubmissionResponse,
} from "../server-validation.ts";
import { InvalidBodyError } from "./body-error.ts";
import { coerceFormValue } from "./coercion.ts";
import { parseFormData } from "./parse-form-data.ts";
import { parseJsonBody } from "./parse-json-body.ts";
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
  FormValidationError | InvalidBodyError
>;

/**
 * Converts `FormData`/`URLSearchParams` entries to an object (see
 * `formDataToObject`). Fails with `InvalidBodyError` for a malformed key path
 * (e.g. both `"name"` and `"name.first"` submitted).
 */
const tryFormDataToObject = (
  source: FormData | URLSearchParams,
): Effect.Effect<unknown, InvalidBodyError> =>
  Effect.try({
    try: () => formDataToObject(source),
    catch: (cause) => new InvalidBodyError({ cause }),
  });

/**
 * Resolves a `parseSubmission` payload down to `FormData`/`URLSearchParams`
 * or an already-parsed JSON value, reading a `Request`'s body/query string
 * when one is given.
 *
 * - A `GET`/`HEAD` request has no body, so its URL's query string is read
 *   instead.
 * - A JSON media type (`application/json`, `*+json`) is read with
 *   `request.json()`; anything else is read as `FormData`.
 * - A `FormData`/`URLSearchParams`/JSON value passed directly is returned
 *   unchanged.
 *
 * Fails with `InvalidBodyError` if the URL or body can't be read.
 */
const resolveEntries = (
  payload: Request | FormData | URLSearchParams | Schema.Json,
): Effect.Effect<unknown, InvalidBodyError> => {
  if (!(payload instanceof Request)) return Effect.succeed(payload);

  if (payload.method === "GET" || payload.method === "HEAD") {
    return Effect.try({
      try: () => new URL(payload.url).searchParams,
      catch: (cause) => new InvalidBodyError({ cause }),
    });
  }

  return isJsonContentType(payload) ? parseJsonBody(payload) : parseFormData(payload);
};

/**
 * Reads the raw, still-string-typed payload out of a `parseSubmission` input
 * (see {@link resolveEntries}), converting a `FormData`/`URLSearchParams`
 * result into a plain object via `formDataToObject`.
 *
 * Fails with `InvalidBodyError` if the URL, body, or form key paths can't be parsed.
 */
const resolveRawInput = (
  payload: Request | FormData | URLSearchParams | Schema.Json,
): Effect.Effect<unknown, InvalidBodyError> =>
  resolveEntries(payload).pipe(
    Effect.flatMap((entries) =>
      entries instanceof FormData || entries instanceof URLSearchParams
        ? tryFormDataToObject(entries)
        : Effect.succeed(entries),
    ),
  );

/**
 * Parses and validates a submission using an Effect schema.
 *
 * Accepts a `Request`, a `FormData`/`URLSearchParams` instance, or an
 * already-parsed payload (e.g. a JSON action body) — see {@link resolveRawInput}
 * for how each is read. Combines that body parsing with schema decoding into a
 * single yieldable Effect:
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
  payload: Request | FormData | URLSearchParams | Schema.Json,
  options: {
    schema: Schema.Codec<A, unknown>;
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
    const rawInput = yield* resolveRawInput(payload);

    // Coerce string leaves (e.g. "2" → 2) toward the schema's expected types so
    // the server validates the same shape the client did.
    const input = coerceFormValue(options.schema, rawInput);

    const value = yield* Schema.decodeUnknownEffect(options.schema)(input).pipe(
      Effect.mapError((schemaError) =>
        toFormError(schemaFailureToResponse(issueFormatter(schemaError.issue))),
      ),
    );

    return { value, reply: makeSubmissionReplyFn() };
  });
}
