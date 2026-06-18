/**
 * Framework-agnostic server-validation primitives shared by the Zod and Effect
 * variants. The schema-specific entry points (`parseSubmission` for Zod,
 * `parseEffectSubmission` for Effect) live in their respective folders and build
 * on the FormData helpers and `SubmissionResponse` shape defined here.
 */

/**
 * The normalized result of a server-side validation pass. Returned as
 * `actionData` and fed back into `useAppForm` via `serverResult` so client and
 * server share one error representation.
 */
export type SubmissionResponse = {
  success: boolean;
  errorMap: { onServer: string[] | undefined };
  fieldErrors: Partial<Record<string, string>>;
};

/**
 * Parses a TanStack Form-style path string into an array of string (object key)
 * and number (array index) segments.
 *
 * Supports both dot notation (`items.0.name`) and bracket notation
 * (`items[0].name`). Purely-numeric segments are treated as array indices.
 */
export function parsePath(path: string): Array<string | number> {
  return path
    .replace(/(^\[)|]/g, "")
    .replace(/\[/g, ".")
    .split(".")
    .filter(Boolean)
    .map((segment) => {
      const num = Number(segment);
      return Number.isInteger(num) && String(num) === segment ? num : segment;
    });
}

/**
 * Sets a value on a nested object/array structure using a parsed path.
 * Creates intermediate objects or arrays as needed based on whether the
 * next segment is a number (array) or string (object).
 */
function setNested(
  root: Record<string, unknown>,
  segments: Array<string | number>,
  value: unknown,
): void {
  let current: unknown = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    const next = segments[i + 1];
    const container = current as Record<string | number, unknown>;

    if (container[seg] == null) {
      container[seg] = typeof next === "number" ? [] : {};
    }
    current = container[seg];
  }

  const last = segments[segments.length - 1];
  (current as Record<string | number, unknown>)[last] = value;
}

/**
 * Converts FormData/URLSearchParams entries into a nested object structure
 * using TanStack Form's path conventions (dot and bracket notation).
 *
 * - Keys ending with `[]` (e.g. `lineItems[]`) are treated as empty-array
 *   sentinels and produce an empty array at that path.
 * - Empty File entries (no name, zero size) are normalized to `null`.
 * - Non-empty File/Blob entries are preserved as-is.
 * - Duplicate flat keys (same full path) are collected into arrays.
 */
export function formDataToObject(
  source: FormData | URLSearchParams,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const seen = new Map<string, number>();

  for (const [key, rawValue] of source.entries()) {
    if (key.endsWith("[]")) {
      const arrayPath = key.slice(0, -2);
      const segments = parsePath(arrayPath);
      setNested(result, segments, []);
      continue;
    }

    const value =
      rawValue instanceof File && rawValue.size === 0 && rawValue.name === ""
        ? null
        : rawValue;

    const segments = parsePath(key);

    if (segments.length === 1) {
      const flatKey = segments[0] as string;
      const count = seen.get(key) ?? 0;
      if (count === 0) {
        result[flatKey] = value;
      } else if (count === 1) {
        result[flatKey] = [result[flatKey], value];
      } else {
        (result[flatKey] as unknown[]).push(value);
      }
      seen.set(key, count + 1);
    } else {
      setNested(result, segments, value);
    }
  }

  return result;
}

/**
 * Converts a nested object (e.g. TanStack Form state) into FormData using
 * dot-notation paths that mirror TanStack Form's field naming convention.
 *
 * This is the inverse of `formDataToObject`.
 *
 * - `null` and `undefined` values are skipped.
 * - `File`/`Blob` values are appended as-is.
 * - Arrays are serialized with numeric path segments (e.g. `items.0.name`).
 * - Empty arrays emit a sentinel key `path[]` with an empty string value so
 *   that `formDataToObject` can reconstruct an empty array (rather than the
 *   field being absent entirely).
 * - All other primitives are coerced to strings.
 */
export function objectToFormData(obj: unknown): FormData {
  const formData = new FormData();

  if (obj == null || typeof obj !== "object") {
    return formData;
  }

  function walk(value: unknown, prefix: string): void {
    if (value === null || value === undefined) {
      return;
    }

    if (value instanceof File || value instanceof Blob) {
      formData.append(prefix, value);
      return;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        formData.append(`${prefix}[]`, "");
      } else {
        for (let i = 0; i < value.length; i++) {
          walk(value[i], `${prefix}.${i}`);
        }
      }
      return;
    }

    if (typeof value === "object" && !(value instanceof Date)) {
      for (const [key, nested] of Object.entries(value)) {
        walk(nested, prefix ? `${prefix}.${key}` : key);
      }
      return;
    }

    formData.append(prefix, String(value));
  }

  for (const [key, value] of Object.entries(obj)) {
    walk(value, key);
  }

  return formData;
}
