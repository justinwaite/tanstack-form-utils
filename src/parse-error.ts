/**
 * The error every server-side parser in this package throws for a malformed or
 * unsafe submission. Internal module: the public entry points re-export
 * `FormDataParseError` and `FormDataParseErrorReason` from
 * `server-validation.ts`.
 */

export type FormDataParseErrorReason =
  | "unsafe-key"
  | "conflicting-path"
  | "array-index"
  | "depth"
  | "field-count"
  | "empty-path"
  | "body-size"
  | "file-count"
  | "file-size"
  | "duplicate-key"
  | "malformed-string"
  | "non-finite-number";

/**
 * Thrown when a submission's structure is malformed or unsafe: a prototype key
 * (`__proto__`, `constructor`, `prototype`), conflicting paths, a duplicate
 * JSON key, a value that is not interoperable, or a limit exceeded. `reason`
 * identifies which. The message never includes a submitted value, and
 * truncates the submitted key.
 */
export class FormDataParseError extends Error {
  readonly reason: FormDataParseErrorReason;

  constructor(reason: FormDataParseErrorReason, detail: string) {
    super(`Malformed form submission: ${detail}`);
    this.name = "FormDataParseError";
    this.reason = reason;
  }
}

const MAX_KEY_IN_MESSAGE = 100;

/** Quotes a submitted key for an error message, truncated so attacker input can't bloat logs. */
export function describeKey(key: string): string {
  return JSON.stringify(
    key.length > MAX_KEY_IN_MESSAGE ? `${key.slice(0, MAX_KEY_IN_MESSAGE)}…` : key,
  );
}
