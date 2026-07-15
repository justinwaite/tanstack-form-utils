import { Data, Effect } from "effect";
import { HttpServerRespondable, HttpServerResponse } from "effect/unstable/http";

/**
 * Error raised when a request body cannot be parsed to its declared Content-Type.
 *
 * Implements the `Respondable` protocol so that, on the HTTP API surface, a
 * died `InvalidBodyError` renders itself as a 422 response.
 */
export class InvalidBodyError extends Data.TaggedError("InvalidBodyError")<{
  readonly cause: unknown;
}> {
  /** Renders a 422 response when this error is surfaced as a defect on the HTTP API. */
  [HttpServerRespondable.symbol](): Effect.Effect<HttpServerResponse.HttpServerResponse> {
    return HttpServerResponse.json({ error: "Invalid request body" }, { status: 422 }).pipe(
      Effect.orDie,
    );
  }
}
