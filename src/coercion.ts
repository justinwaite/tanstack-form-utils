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
 * - Only strict forms convert (CWE-1286, ASVS V15.3.5). `Number` and `BigInt`
 *   also accept hexadecimal, binary, octal, white space, and `Infinity`, and
 *   `new Date` guesses at any string in the server time zone. Another
 *   component that reads the raw string would then see a different value than
 *   the schema saw.
 */

export type CoercibleKind = "number" | "boolean" | "bigint" | "date";

/** A decimal number: digits with an optional fraction and exponent. Linear time: no nested quantifiers. */
const DECIMAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** A decimal integer with an optional sign. */
const DECIMAL_INTEGER = /^[+-]?\d+$/;

/**
 * The most digits a bigint string may have. `BigInt` takes quadratic time in
 * the digit count. Python uses the same limit for the same reason
 * (CVE-2020-10735).
 */
export const MAX_BIGINT_DIGITS = 4300;

/** `YYYY-MM-DD`: the value of `<input type="date">`. Read as midnight UTC. */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * RFC 3339 `date-time`: seconds and a time zone are required. A local time with
 * no zone (the value of `<input type="datetime-local">`) is not coerced, because
 * the server can't know which zone the user meant. The schema gets the string.
 */
const DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|([+-])(\d{2}):(\d{2}))$/;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const days = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1]!;
  return day <= days;
}

/**
 * Parses a `YYYY-MM-DD` or RFC 3339 string to a `Date`, or returns `undefined`.
 * Builds the instant from its parts, so the result does not depend on the
 * JavaScript engine or the server time zone. Rejects a date that does not
 * exist, such as February 30.
 */
function parseStrictDate(value: string): Date | undefined {
  const dateOnly = DATE_ONLY.exec(value);
  const match = dateOnly ?? DATE_TIME.exec(value);
  if (!match) return undefined;

  const [, y, mo, d, h = "0", mi = "0", s = "0", fraction = "", sign, oh = "0", om = "0"] = match;
  const [year, month, day] = [Number(y), Number(mo), Number(d)];
  const [hour, minute, second] = [Number(h), Number(mi), Number(s)];
  const [offsetHour, offsetMinute] = [Number(oh), Number(om)];
  if (!isCalendarDate(year, month, day)) return undefined;
  if (hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) {
    return undefined;
  }

  const date = new Date(0);
  // `setUTCFullYear` keeps years 0-99 as written; `Date.UTC` would add 1900.
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, Number(fraction.slice(0, 3).padEnd(3, "0")));
  const offset = (sign === "-" ? -1 : 1) * (offsetHour * 60 + offsetMinute);
  return new Date(date.getTime() - offset * 60_000);
}

/**
 * Coerces a single form value toward `kind`. Returns the coerced value, the
 * original string if the string is not in the strict form for `kind` (so
 * validation reports the type error), or `undefined` for an empty string.
 *
 * - `number`: a decimal string (`5`, `-0.5`, `.5`, `1e3`) with a finite value.
 * - `bigint`: a decimal integer string of at most {@link MAX_BIGINT_DIGITS} digits.
 * - `boolean`: `on` or `true`, and `false`.
 * - `date`: `YYYY-MM-DD` (midnight UTC), or RFC 3339 with a time zone.
 */
export function coerceLeaf(value: unknown, kind: CoercibleKind): unknown {
  if (typeof value !== "string") return value;
  if (value === "") return undefined;

  switch (kind) {
    case "number": {
      if (!DECIMAL_NUMBER.test(value)) return value;
      const n = Number(value);
      return Number.isFinite(n) ? n : value;
    }
    case "boolean": {
      // `"on"` is what a native checkbox submits; `"true"`/`"false"` is what
      // `objectToFormData` produces via `String(boolean)`.
      if (value === "on" || value === "true") return true;
      if (value === "false") return false;
      return value;
    }
    case "bigint": {
      // Check the length before the pattern, so a huge string costs nothing.
      const digits = value.length - (value[0] === "+" || value[0] === "-" ? 1 : 0);
      if (digits > MAX_BIGINT_DIGITS || !DECIMAL_INTEGER.test(value)) return value;
      return BigInt(value);
    }
    case "date":
      return parseStrictDate(value) ?? value;
  }
}
