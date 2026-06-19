import { Data, Effect } from "effect";
import { HttpServerRespondable, HttpServerResponse } from "effect/unstable/http";

/**
 * Error raised when form data cannot be parsed from the request body.
 *
 * Implements the `Respondable` protocol so that, on the HTTP API surface, a
 * died `FormDataError` renders itself as a 422 response.
 */
export class FormDataError extends Data.TaggedError("FormDataError")<{
  readonly cause: unknown;
}> {
  /** Renders a 422 response when this error is surfaced as a defect on the HTTP API. */
  [HttpServerRespondable.symbol](): Effect.Effect<HttpServerResponse.HttpServerResponse> {
    return HttpServerResponse.json({ error: "Invalid request body" }, { status: 422 }).pipe(
      Effect.orDie,
    );
  }
}

/**
 * Parses form data from an HTTP request. Fails with `FormDataError` if the
 * body cannot be read as `multipart/form-data` or `application/x-www-form-urlencoded`.
 */
export const parseFormData = (request: Request): Effect.Effect<FormData, FormDataError> =>
  Effect.tryPromise({
    try: () => request.formData(),
    catch: (cause) => new FormDataError({ cause }),
  });
