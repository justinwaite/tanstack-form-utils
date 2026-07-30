import { Effect } from "effect";
import { InvalidBodyError } from "./body-error.ts";

/**
 * Parses a JSON body from an HTTP request. Fails with `InvalidBodyError` if the
 * body cannot be read or is not valid JSON.
 */
export const parseJsonBody = (request: Request): Effect.Effect<unknown, InvalidBodyError> =>
  Effect.tryPromise({
    try: () => request.json(),
    catch: (cause) => new InvalidBodyError({ cause }),
  });
