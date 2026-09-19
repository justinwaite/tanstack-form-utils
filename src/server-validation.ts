/**
 * Framework-agnostic server-validation primitives shared by the Zod and Effect
 * variants. The schema-specific entry points (`parseSubmission`, exported from
 * both the `/zod` and `/effect` folders) build on the FormData helpers and
 * `SubmissionResponse` shape defined here.
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
 * Bounds on how much structure `formDataToObject` (and the JSON payload check
 * in `parseSubmission`) will build from untrusted input. See SECURITY.md.
 */
export type FormDataLimits = {
  /** Maximum number of entries read from a `FormData`/`URLSearchParams`. */
  maxFields: number;
  /** Maximum number of segments in a field path, and nesting depth of a JSON payload. */
  maxDepth: number;
  /** Array indices must be below this, so one tiny field can't allocate a huge array. */
  maxArrayLength: number;
};

export const DEFAULT_FORM_DATA_LIMITS: Readonly<FormDataLimits> = Object.freeze({
  maxFields: 10_000,
  maxDepth: 32,
  maxArrayLength: 10_000,
});

export type FormDataParseErrorReason =
  | "unsafe-key"
  | "conflicting-path"
  | "array-index"
  | "depth"
  | "field-count"
  | "empty-path";

/**
 * Thrown when a submission's structure is malformed or unsafe: a prototype key
 * (`__proto__`, `constructor`, `prototype`), conflicting paths, or a limit
 * exceeded. `reason` identifies which. The message never includes a submitted
 * value, and truncates the submitted key.
 */
export class FormDataParseError extends Error {
  readonly reason: FormDataParseErrorReason;

  constructor(reason: FormDataParseErrorReason, detail: string) {
    super(`Malformed form submission: ${detail}`);
    this.name = "FormDataParseError";
    this.reason = reason;
  }
}

/**
 * Keys that reach a prototype when used as a property name. The same list
 * TanStack Form's `mergeForm` guards against.
 */
const UNSAFE_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

/** True for a key that could write through to a prototype (`__proto__`, `constructor`, `prototype`). */
export function isUnsafeKey(key: PropertyKey): boolean {
  return UNSAFE_KEYS.has(String(key));
}

const MAX_KEY_IN_MESSAGE = 100;

/** Quotes a submitted key for an error message, truncated so attacker input can't bloat logs. */
function describeKey(key: string): string {
  return JSON.stringify(
    key.length > MAX_KEY_IN_MESSAGE ? `${key.slice(0, MAX_KEY_IN_MESSAGE)}…` : key,
  );
}

function resolveLimits(limits: Partial<FormDataLimits> | undefined): FormDataLimits {
  return { ...DEFAULT_FORM_DATA_LIMITS, ...limits };
}

/** A canonical non-negative integer: `0`, `7`, `42` — not `-1`, `01`, `1e3`, or `0x1`. */
const ARRAY_INDEX = /^(?:0|[1-9]\d*)$/;

/**
 * Parses a TanStack Form-style path string into an array of string (object key)
 * and number (array index) segments.
 *
 * Supports both dot notation (`items.0.name`) and bracket notation
 * (`items[0].name`). Only canonical non-negative integers are treated as array
 * indices; `-1`, `01`, or `1e3` stay string keys.
 */
export function parsePath(path: string): Array<string | number> {
  return path
    .replace(/(^\[)|]/g, "")
    .replace(/\[/g, ".")
    .split(".")
    .filter(Boolean)
    .map((segment) => (ARRAY_INDEX.test(segment) ? Number(segment) : segment));
}

type Container = Record<string | number, unknown>;

/** True for a value that can hold nested keys (a plain object or an array). */
function isContainer(value: unknown): value is Container {
  return typeof value === "object" && value !== null;
}

/** Reads an own property only, so inherited names like `valueOf` count as absent. */
function ownValue(container: Container, segment: string | number): unknown {
  return Object.hasOwn(container, segment) ? container[segment] : undefined;
}

/** Builds the error thrown when a submission uses the same path as both a leaf value and a container. */
function conflictingPathError(key: string): FormDataParseError {
  return new FormDataParseError(
    "conflicting-path",
    `Conflicting form field paths: ${describeKey(key)} is used as both a value and a container`,
  );
}

/**
 * Rejects a parsed path that is empty, too deep, or contains a prototype key.
 * Runs on the normalized segments, so bracket noise such as `__pro]to__` can't
 * slip past (ASVS V1.1.1).
 */
function assertSafePath(key: string, segments: Array<string | number>, limits: FormDataLimits) {
  if (segments.length === 0) {
    throw new FormDataParseError("empty-path", `empty field name ${describeKey(key)}`);
  }
  if (segments.length > limits.maxDepth) {
    throw new FormDataParseError(
      "depth",
      `field ${describeKey(key)} is nested deeper than ${limits.maxDepth} levels`,
    );
  }
  for (const segment of segments) {
    if (isUnsafeKey(segment)) {
      throw new FormDataParseError(
        "unsafe-key",
        `field ${describeKey(key)} uses the reserved key "${segment}"`,
      );
    }
  }
}

/**
 * Arrays accept only in-range numeric indices. A named key (e.g. `length`) or
 * a huge index would let one tiny field resize the array to billions of slots.
 */
function assertWritable(
  container: Container,
  segment: string | number,
  key: string,
  limits: FormDataLimits,
): void {
  if (!Array.isArray(container)) return;
  if (typeof segment !== "number") {
    throw new FormDataParseError(
      "conflicting-path",
      `Conflicting form field paths: ${describeKey(key)} uses a named key on an array`,
    );
  }
  if (segment >= limits.maxArrayLength) {
    throw new FormDataParseError(
      "array-index",
      `field ${describeKey(key)} has an array index of ${limits.maxArrayLength} or more`,
    );
  }
}

/**
 * Sets a value on a nested object/array structure using a parsed path.
 * Creates intermediate objects or arrays as needed based on whether the
 * next segment is a number (array) or string (object).
 *
 * Throws if a segment is already a leaf value (e.g. `"name"` was submitted as
 * a flat key before `"name.first"`) or already a container where a leaf value
 * is being set (the reverse order) — the same conflict either way.
 */
function setNested(
  root: Container,
  segments: Array<string | number>,
  value: unknown,
  key: string,
  limits: FormDataLimits,
): void {
  let current = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    assertWritable(current, seg, key, limits);

    const existing = ownValue(current, seg);
    if (existing == null) {
      const created: Container =
        typeof segments[i + 1] === "number" ? ([] as unknown as Container) : {};
      current[seg] = created;
      current = created;
    } else if (isContainer(existing)) {
      current = existing;
    } else {
      throw conflictingPathError(segments.slice(0, i + 1).join("."));
    }
  }

  const last = segments[segments.length - 1]!;
  assertWritable(current, last, key, limits);
  if (isContainer(ownValue(current, last))) {
    throw conflictingPathError(segments.join("."));
  }
  current[last] = value;
}

/**
 * Converts FormData/URLSearchParams entries into a nested object structure
 * using TanStack Form's path conventions (dot and bracket notation).
 *
 * - Keys ending with `[]` (e.g. `lineItems[]`) are treated as empty-array
 *   sentinels and produce an empty array at that path.
 * - Empty File entries (no name, zero size) are normalized to `null`.
 * - Non-empty File/Blob entries are preserved as-is.
 * - Duplicate flat keys (same normalized path) are collected into arrays.
 *
 * Throws `FormDataParseError` (see SECURITY.md) if:
 * - the same base path is submitted as both a leaf value and a container
 *   (e.g. both `"name"` and `"name.first"`), regardless of order;
 * - a path segment is `__proto__`, `constructor`, or `prototype`;
 * - a path is empty, or exceeds `limits.maxDepth` segments;
 * - an array index is `limits.maxArrayLength` or more, or a named key is set
 *   on an array;
 * - there are more than `limits.maxFields` entries.
 */
export function formDataToObject(
  source: FormData | URLSearchParams,
  limits?: Partial<FormDataLimits>,
): Record<string, unknown> {
  const resolved = resolveLimits(limits);
  const result: Record<string, unknown> = {};
  const seen = new Map<string | number, number>();
  let fieldCount = 0;

  for (const [key, rawValue] of source.entries()) {
    if (++fieldCount > resolved.maxFields) {
      throw new FormDataParseError(
        "field-count",
        `more than ${resolved.maxFields} fields submitted`,
      );
    }

    const isEmptyArraySentinel = key.endsWith("[]");
    const segments = parsePath(isEmptyArraySentinel ? key.slice(0, -2) : key);
    assertSafePath(key, segments, resolved);

    if (isEmptyArraySentinel) {
      setNested(result, segments, [], key, resolved);
      continue;
    }

    const value =
      rawValue instanceof File && rawValue.size === 0 && rawValue.name === "" ? null : rawValue;

    if (segments.length === 1) {
      // Count by the normalized segment so `role` and `[role]` are recognized
      // as the same field rather than the second silently overwriting the first.
      const flatKey = segments[0]!;
      const count = seen.get(flatKey) ?? 0;
      const existing = ownValue(result, flatKey);
      if (count === 0) {
        if (isContainer(existing)) {
          throw conflictingPathError(key);
        }
        result[flatKey] = value;
      } else if (count === 1) {
        result[flatKey] = [existing, value];
      } else {
        (existing as unknown[]).push(value);
      }
      seen.set(flatKey, count + 1);
    } else {
      setNested(result, segments, value, key, resolved);
    }
  }

  return result;
}

/** Plain objects and arrays — the only values a JSON parser produces as containers. */
function isPlainContainer(value: unknown): value is Container {
  if (Array.isArray(value)) return true;
  if (typeof value !== "object" || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Applies the same key rules as `formDataToObject` to an already-parsed payload
 * (e.g. a JSON body), so every input format is held to one standard
 * (ASVS V1.5.3). Throws `FormDataParseError` for a `__proto__`, `constructor`,
 * or `prototype` own key at any depth, or nesting deeper than
 * `limits.maxDepth`.
 *
 * Only plain objects and arrays are descended into; `Date`, `File`, and class
 * instances are left alone. Iterative, so deep input can't overflow the stack.
 */
export function assertSafePayload(value: unknown, limits?: Partial<FormDataLimits>): void {
  const { maxDepth } = resolveLimits(limits);
  const stack: Array<[node: unknown, depth: number]> = [[value, 0]];
  const visited = new WeakSet<object>();

  while (stack.length > 0) {
    const [node, depth] = stack.pop()!;
    if (!isPlainContainer(node) || visited.has(node)) continue;
    visited.add(node);

    if (depth > maxDepth) {
      throw new FormDataParseError("depth", `payload is nested deeper than ${maxDepth} levels`);
    }
    for (const key of Object.keys(node)) {
      if (isUnsafeKey(key)) {
        throw new FormDataParseError("unsafe-key", `payload uses the reserved key "${key}"`);
      }
      stack.push([node[key], depth + 1]);
    }
  }
}

/**
 * Returns true when a request's `Content-Type` header denotes a JSON body
 * (`application/json`, or a `+json` structured syntax suffix such as
 * `application/vnd.api+json`).
 */
export function isJsonContentType(request: Request): boolean {
  const contentType = request.headers.get("content-type");
  if (!contentType) return false;
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase();
  return mediaType === "application/json" || !!mediaType?.endsWith("+json");
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

    // Dates serialize via their own `toString()` before the generic object
    // branch would otherwise recurse into them.
    if (value instanceof Date) {
      formData.append(prefix, value.toString());
      return;
    }

    if (typeof value === "object") {
      for (const [key, nested] of Object.entries(value)) {
        walk(nested, prefix ? `${prefix}.${key}` : key);
      }
      return;
    }

    // Remaining stringifiable primitives. (Symbols/functions can't appear in
    // form state and are intentionally dropped.)
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      typeof value === "bigint"
    ) {
      formData.append(prefix, String(value));
    }
  }

  for (const [key, value] of Object.entries(obj)) {
    walk(value, key);
  }

  return formData;
}
