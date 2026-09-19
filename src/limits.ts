/**
 * Limits on untrusted input, and safe reads of caller options. Internal module:
 * the public entry points re-export `FormDataLimits` and
 * `DEFAULT_FORM_DATA_LIMITS` from `server-validation.ts`.
 */

/**
 * Bounds on how much the server-side parsers read and build from untrusted
 * input. See SECURITY.md.
 */
export type FormDataLimits = {
  /**
   * Maximum number of entries read from a `FormData`/`URLSearchParams`, and
   * maximum number of object keys plus array items in a JSON payload.
   */
  maxFields: number;
  /** Maximum number of segments in a field path, and nesting depth of a JSON payload. */
  maxDepth: number;
  /** Array indices must be below this, so one tiny field can't allocate a huge array. */
  maxArrayLength: number;
  /**
   * Maximum total length of all arrays in one submission, empty slots included,
   * so many small sparse fields can't add up to millions of slots.
   */
  maxArraySlots: number;
  /** Maximum size of a request body, in bytes. `readRequestBody` stops reading above it. */
  maxBodyBytes: number;
  /** Maximum number of non-empty files in one submission. */
  maxFiles: number;
  /** Maximum size of one file, in bytes. */
  maxFileBytes: number;
};

const MiB = 1024 * 1024;

export const DEFAULT_FORM_DATA_LIMITS: Readonly<FormDataLimits> = Object.freeze({
  maxFields: 10_000,
  maxDepth: 32,
  maxArrayLength: 10_000,
  maxArraySlots: 100_000,
  maxBodyBytes: 10 * MiB,
  maxFiles: 100,
  maxFileBytes: 10 * MiB,
});

const LIMIT_KEYS = Object.keys(DEFAULT_FORM_DATA_LIMITS) as Array<keyof FormDataLimits>;

/**
 * Merges caller limits over the defaults. Reads only own properties, so a
 * polluted `Object.prototype` can't raise a limit. Throws a `TypeError` for a
 * value that is not a non-negative safe integer (a programming error, not bad
 * input). `undefined` keeps the default.
 */
export function resolveLimits(limits: Partial<FormDataLimits> | undefined): FormDataLimits {
  const resolved = { ...DEFAULT_FORM_DATA_LIMITS };
  if (limits == null) return resolved;
  for (const key of LIMIT_KEYS) {
    const value = ownOption(limits, key);
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`limits.${key} must be a non-negative integer`);
    }
    resolved[key] = value;
  }
  return resolved;
}

/**
 * Reads an option only if the caller set it on the object itself. An inherited
 * value, for example from a polluted `Object.prototype`, counts as absent.
 */
export function ownOption<T extends object, K extends keyof T>(
  options: T,
  key: K,
): T[K] | undefined {
  return Object.hasOwn(options, key) ? options[key] : undefined;
}
