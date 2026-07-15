import { Effect } from "effect";
import { InvalidBodyError } from "./body-error.ts";

/**
 * Parses form data from an HTTP request. Fails with `FormDataError` if the
 * body cannot be read as `multipart/form-data` or `application/x-www-form-urlencoded`.
 */
export const parseFormData = (request: Request): Effect.Effect<FormData, InvalidBodyError> =>
  Effect.tryPromise({
    try: () => request.formData(),
    catch: (cause) => new InvalidBodyError({ cause }),
  });
