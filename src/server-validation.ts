/**
 * Framework-agnostic server-validation primitives shared by the Zod and Effect
 * variants. The schema-specific entry points (`parseSubmission`, exported from
 * both the `/zod` and `/effect` folders) build on the FormData helpers and
 * `SubmissionResponse` shape defined here.
 */

import { type FormDataLimits, resolveLimits } from "./limits.ts";
import { describeKey, FormDataParseError } from "./parse-error.ts";

export { DEFAULT_FORM_DATA_LIMITS, type FormDataLimits } from "./limits.ts";
export { FormDataParseError, type FormDataParseErrorReason } from "./parse-error.ts";

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
 * Keys that reach a prototype when used as a property name. The same list
 * TanStack Form's `mergeForm` guards against.
 */
const UNSAFE_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

/** True for a key that could write through to a prototype (`__proto__`, `constructor`, `prototype`). */
export function isUnsafeKey(key: PropertyKey): boolean {
  return UNSAFE_KEYS.has(String(key));
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

/** Bookkeeping for one `formDataToObject` call. */
type ParseState = {
  limits: FormDataLimits;
  /** Total length of every array built so far, empty slots included. */
  arraySlots: number;
  /** Non-empty files read so far. */
  files: number;
  /** How many values each canonical leaf path (`items.0.name`) has received. */
  leafCounts: Map<string, number>;
  /** Arrays built from a repeated key. They hold values, so no path may descend into them. */
  repeatedValues: WeakSet<unknown[]>;
};

/**
 * Counts new array slots against `maxArraySlots`. One field can add at most
 * `maxArrayLength` slots, but many small fields can add up (ASVS V1.5.3).
 */
function addArraySlots(state: ParseState, count: number, key: string): void {
  state.arraySlots += count;
  if (state.arraySlots > state.limits.maxArraySlots) {
    throw new FormDataParseError(
      "array-index",
      `field ${describeKey(key)} brings the total array length above ${state.limits.maxArraySlots}`,
    );
  }
}

/**
 * Arrays accept only in-range numeric indices. A named key (e.g. `length`) or
 * a huge index would let one tiny field resize the array to billions of slots.
 * An index past the end counts the new slots, empty ones included.
 */
function assertWritable(
  container: Container,
  segment: string | number,
  key: string,
  state: ParseState,
): void {
  if (!Array.isArray(container)) return;
  if (typeof segment !== "number") {
    throw new FormDataParseError(
      "conflicting-path",
      `Conflicting form field paths: ${describeKey(key)} uses a named key on an array`,
    );
  }
  const { maxArrayLength } = state.limits;
  if (segment >= maxArrayLength) {
    throw new FormDataParseError(
      "array-index",
      `field ${describeKey(key)} has an array index of ${maxArrayLength} or more`,
    );
  }
  if (segment >= container.length) {
    addArraySlots(state, segment + 1 - container.length, key);
  }
}

/**
 * Walks to the container that holds the last segment of `segments`, creating
 * intermediate objects or arrays as needed based on whether the next segment is
 * a number (array) or string (object).
 *
 * Throws if a segment is already a leaf value (e.g. `"name"` was submitted as
 * a flat key before `"name.first"`), including a value collected from a
 * repeated key.
 */
function walkToParent(
  root: Container,
  segments: Array<string | number>,
  key: string,
  state: ParseState,
): Container {
  let current = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    assertWritable(current, seg, key, state);

    const existing = ownValue(current, seg);
    if (existing === undefined) {
      const created: Container =
        typeof segments[i + 1] === "number" ? ([] as unknown as Container) : {};
      current[seg] = created;
      current = created;
    } else if (
      isContainer(existing) &&
      !(Array.isArray(existing) && state.repeatedValues.has(existing))
    ) {
      current = existing;
    } else {
      throw conflictingPathError(segments.slice(0, i + 1).join("."));
    }
  }
  return current;
}

/**
 * Sets a leaf value at a parsed path. A path that receives a second value
 * becomes an array of all its values, at any depth, so the schema sees every
 * value and never only the last one (CWE-235, ASVS V15.3.7).
 *
 * Throws if the path is already a container (the reverse order of the conflict
 * in {@link walkToParent}).
 */
function setLeaf(
  root: Container,
  segments: Array<string | number>,
  value: unknown,
  key: string,
  state: ParseState,
): void {
  const parent = walkToParent(root, segments, key, state);
  const last = segments[segments.length - 1]!;
  assertWritable(parent, last, key, state);

  // Segments never contain `.`, `[`, or `]`, so this join is a canonical path:
  // `role` and `[role]`, or `items.0` and `items[0]`, give the same string.
  const path = segments.join(".");
  const count = state.leafCounts.get(path) ?? 0;
  const existing = ownValue(parent, last);
  if (count === 0) {
    if (existing !== undefined) throw conflictingPathError(path);
    parent[last] = value;
  } else if (count === 1) {
    const values = [existing, value];
    state.repeatedValues.add(values);
    addArraySlots(state, 2, key);
    parent[last] = values;
  } else {
    (existing as unknown[]).push(value);
    addArraySlots(state, 1, key);
  }
  state.leafCounts.set(path, count + 1);
}

/** Sets the empty array that a `path[]` sentinel stands for. */
function setEmptyArray(
  root: Container,
  segments: Array<string | number>,
  key: string,
  state: ParseState,
): void {
  const parent = walkToParent(root, segments, key, state);
  const last = segments[segments.length - 1]!;
  assertWritable(parent, last, key, state);
  if (ownValue(parent, last) !== undefined) throw conflictingPathError(segments.join("."));
  parent[last] = [];
}

/**
 * Normalizes one FormData value: an empty file input (no name, zero size)
 * becomes `null`. A real file counts against `maxFiles` and `maxFileBytes`.
 */
function readEntryValue(value: FormDataEntryValue, key: string, state: ParseState): unknown {
  if (!(value instanceof File)) return value;
  if (value.size === 0 && value.name === "") return null;
  if (++state.files > state.limits.maxFiles) {
    throw new FormDataParseError(
      "file-count",
      `more than ${state.limits.maxFiles} files submitted`,
    );
  }
  if (value.size > state.limits.maxFileBytes) {
    throw new FormDataParseError(
      "file-size",
      `file ${describeKey(key)} is larger than ${state.limits.maxFileBytes} bytes`,
    );
  }
  return value;
}

/**
 * Converts FormData/URLSearchParams entries into a nested object structure
 * using TanStack Form's path conventions (dot and bracket notation).
 *
 * - Keys ending with `[]` (e.g. `lineItems[]`) are treated as empty-array
 *   sentinels and produce an empty array at that path.
 * - Empty File entries (no name, zero size) are normalized to `null`.
 * - Non-empty File/Blob entries are preserved as-is.
 * - A path submitted more than once (same normalized path, at any depth)
 *   collects all its values into an array.
 * - Arrays may skip indices (a native form can), so they may have empty slots.
 *
 * Throws `FormDataParseError` (see SECURITY.md) if:
 * - the same base path is submitted as both a leaf value and a container
 *   (e.g. both `"name"` and `"name.first"`), regardless of order;
 * - a path segment is `__proto__`, `constructor`, or `prototype`;
 * - a path is empty, or exceeds `limits.maxDepth` segments;
 * - an array index is `limits.maxArrayLength` or more, the arrays together
 *   exceed `limits.maxArraySlots` slots, or a named key is set on an array;
 * - there are more than `limits.maxFields` entries, more than `limits.maxFiles`
 *   files, or a file larger than `limits.maxFileBytes`.
 *
 * Throws a `TypeError` if a limit is not a non-negative integer.
 */
export function formDataToObject(
  source: FormData | URLSearchParams,
  limits?: Partial<FormDataLimits>,
): Record<string, unknown> {
  const state: ParseState = {
    limits: resolveLimits(limits),
    arraySlots: 0,
    files: 0,
    leafCounts: new Map(),
    repeatedValues: new WeakSet(),
  };
  const result: Record<string, unknown> = {};
  let fieldCount = 0;

  for (const [key, rawValue] of source.entries()) {
    if (++fieldCount > state.limits.maxFields) {
      throw new FormDataParseError(
        "field-count",
        `more than ${state.limits.maxFields} fields submitted`,
      );
    }

    const isEmptyArraySentinel = key.endsWith("[]");
    const segments = parsePath(isEmptyArraySentinel ? key.slice(0, -2) : key);
    assertSafePath(key, segments, state.limits);

    if (isEmptyArraySentinel) {
      setEmptyArray(result, segments, key, state);
    } else {
      setLeaf(result, segments, readEntryValue(rawValue, key, state), key, state);
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
 * Rejects a leaf that JSON can carry but another component may read
 * differently (RFC 7493 I-JSON): a string with a lone surrogate, which
 * FormData would have changed to U+FFFD, or a number that overflowed to
 * `Infinity`.
 */
function assertInteroperableLeaf(value: unknown): void {
  if (typeof value === "string" && !value.isWellFormed()) {
    throw new FormDataParseError("malformed-string", "payload has a string with a lone surrogate");
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new FormDataParseError("non-finite-number", "payload has a number that is not finite");
  }
}

/**
 * Applies the same rules as `formDataToObject` to an already-parsed payload
 * (e.g. a JSON body), so every input format is held to one standard
 * (ASVS V1.5.3). Throws `FormDataParseError` for:
 *
 * - a `__proto__`, `constructor`, or `prototype` own key at any depth;
 * - nesting deeper than `limits.maxDepth`;
 * - more than `limits.maxFields` object keys and array items in total;
 * - an array longer than `limits.maxArrayLength`, or arrays whose lengths add
 *   up to more than `limits.maxArraySlots`;
 * - a key or string with a lone surrogate, or a number that is not finite.
 *
 * Only plain objects and arrays are descended into; `Date`, `File`, and class
 * instances are left alone. Iterative, so deep input can't overflow the stack.
 * Throws a `TypeError` if a limit is not a non-negative integer.
 */
export function assertSafePayload(value: unknown, limits?: Partial<FormDataLimits>): void {
  const { maxDepth, maxFields, maxArrayLength, maxArraySlots } = resolveLimits(limits);
  const stack: Array<[node: unknown, depth: number]> = [[value, 0]];
  const visited = new WeakSet<object>();
  let fieldCount = 0;
  let arraySlots = 0;

  while (stack.length > 0) {
    const [node, depth] = stack.pop()!;
    // Checked before the leaf filter, so a primitive leaf is held to `maxDepth` like a container.
    if (depth > maxDepth) {
      throw new FormDataParseError("depth", `payload is nested deeper than ${maxDepth} levels`);
    }
    assertInteroperableLeaf(node);
    if (!isPlainContainer(node) || visited.has(node)) continue;
    visited.add(node);

    if (Array.isArray(node)) {
      if (node.length > maxArrayLength) {
        throw new FormDataParseError(
          "array-index",
          `payload has an array longer than ${maxArrayLength} items`,
        );
      }
      arraySlots += node.length;
      if (arraySlots > maxArraySlots) {
        throw new FormDataParseError(
          "array-index",
          `payload arrays have more than ${maxArraySlots} items in total`,
        );
      }
    }
    const keys = Object.keys(node);
    fieldCount += keys.length;
    if (fieldCount > maxFields) {
      throw new FormDataParseError("field-count", `payload has more than ${maxFields} fields`);
    }
    for (const key of keys) {
      if (isUnsafeKey(key)) {
        throw new FormDataParseError("unsafe-key", `payload uses the reserved key "${key}"`);
      }
      assertInteroperableLeaf(key);
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
 * - Dates are serialized with `toISOString()`, which the server coerces back
 *   to the same instant.
 * - All other primitives are coerced to strings.
 *
 * Throws a `TypeError` for an object key that is empty or contains `.`, `[`,
 * or `]`. The server would read such a key as a different path, so the data
 * would change shape on the way (CWE-140).
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

    // Dates serialize before the generic object branch would otherwise recurse
    // into them. An invalid date has no ISO form, so it goes as "Invalid Date"
    // and the schema reports it.
    if (value instanceof Date) {
      formData.append(prefix, Number.isNaN(value.getTime()) ? String(value) : value.toISOString());
      return;
    }

    if (typeof value === "object") {
      for (const [key, nested] of Object.entries(value)) {
        assertSerializableKey(key);
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
    assertSerializableKey(key);
    walk(value, key);
  }

  return formData;
}

/** A character that `parsePath` reads as a path delimiter. */
const PATH_DELIMITER = /[.[\]]/;

/** Throws for an object key that `formDataToObject` would read as a different path. */
function assertSerializableKey(key: string): void {
  if (key === "" || PATH_DELIMITER.test(key)) {
    throw new TypeError(
      `objectToFormData: the key ${describeKey(key)} is empty or contains ".", "[", or "]"`,
    );
  }
}
