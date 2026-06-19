/**
 * Shared, schema-agnostic leaf coercers.
 *
 * HTML FormData carries every value as a string, so a field whose schema
 * expects a `number` / `boolean` / `bigint` / `Date` arrives on the server as
 * `"2"` / `"on"` / `"9"` / an ISO string. These helpers convert a single string
 * leaf to its target runtime type. The per-variant walkers (`src/zod/coercion.ts`,
 * `src/effect/coercion.ts`) introspect the consumer's schema to decide which
 * kind each leaf is, then call {@link coerceLeaf}.
 *
 * Conventions (mirroring conform):
 * - Only strings are touched. Non-strings (already-typed values, `File`, `null`,
 *   arrays, objects) pass through untouched.
 * - An empty string becomes `undefined` so `.optional()` / defaulted fields work.
 * - On a failed conversion the *original string* is returned, so the real
 *   validator emits a proper "expected number" error instead of the coercer
 *   masking it.
 */

export type CoercibleKind = "number" | "boolean" | "bigint" | "date";

/**
 * Coerces a single form value toward `kind`. Returns the coerced value, the
 * original string if conversion fails (so validation reports the type error),
 * or `undefined` for an empty string.
 */
export function coerceLeaf(value: unknown, kind: CoercibleKind): unknown {
  if (typeof value !== "string") return value;
  if (value === "") return undefined;

  switch (kind) {
    case "number": {
      // Match conform: whitespace-only is not a valid number.
      const n = value.trim() === "" ? Number.NaN : Number(value);
      return Number.isNaN(n) ? value : n;
    }
    case "boolean": {
      // `"on"` is what a native checkbox submits; `"true"`/`"false"` is what
      // `objectToFormData` produces via `String(boolean)`.
      if (value === "on" || value === "true") return true;
      if (value === "false") return false;
      return value;
    }
    case "bigint": {
      try {
        return BigInt(value);
      } catch {
        return value;
      }
    }
    case "date": {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? value : date;
    }
  }
}
