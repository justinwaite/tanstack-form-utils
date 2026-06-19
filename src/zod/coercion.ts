import type { $ZodType, $ZodTypes } from "zod/v4/core";

import { coerceLeaf } from "../coercion.ts";

/**
 * Walks a Zod (v4) schema alongside a parsed FormData object and coerces string
 * leaves into the types the schema expects (`number`, `boolean`, `bigint`,
 * `Date`), so the server validates the same shape the client did.
 *
 * The consumer's schema is only *read*, never rebuilt — validation still runs
 * against the original schema, preserving all refinements and error messages.
 * Introspection uses Zod v4's `_zod.def` surface: the schema is narrowed to the
 * `$ZodTypes` union so each `case` below sees a fully-typed def (`.shape` /
 * `.element` / `.innerType` / `.in` / `.getter`), checked by the compiler.
 *
 * Scope (first cut): primitive leaves plus the wrappers needed to reach them
 * (object, array, optional, nullable, default, prefault, catch, readonly,
 * nonoptional, pipe, lazy). Unions, tuples, records, and literals are passed
 * through untouched for now.
 */
export function coerceFormValue(schema: $ZodType, value: unknown): unknown {
  return walk(schema, value, new Set());
}

/**
 * Narrows the abstract `$ZodType` to the concrete `$ZodTypes` union so its
 * `_zod.def` becomes the discriminated union of all schema defs. Every runtime
 * schema is one of these variants; the `type` discriminant is always present.
 */
function isKnownSchema(schema: $ZodType): schema is $ZodTypes {
  return typeof schema._zod.def.type === "string";
}

/** Narrows an unknown form value to a plain (non-array) object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function walk(schema: $ZodType, value: unknown, seen: Set<$ZodType>): unknown {
  if (!isKnownSchema(schema)) return value;
  const def = schema._zod.def;

  switch (def.type) {
    case "object": {
      if (!isRecord(value)) return value;
      for (const key of Object.keys(def.shape)) {
        value[key] = walk(def.shape[key], value[key], seen);
      }
      return value;
    }

    case "array": {
      if (!Array.isArray(value)) return value;
      return value.map((item) => walk(def.element, item, seen));
    }

    // Wrappers — unwrap to the inner type and recurse. Empty-string stripping
    // happens at the leaf, so `z.number().optional()` with `""` resolves to
    // `undefined` and passes.
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "catch":
    case "readonly":
    case "nonoptional":
      return walk(def.innerType, value, seen);

    case "pipe":
      // Coerce toward the input side of a transform/codec (e.g. preprocess).
      return walk(def.in, value, seen);

    case "lazy": {
      // Guard against recursive schemas resolving forever.
      if (seen.has(schema)) return value;
      seen.add(schema);
      return walk(def.getter(), value, seen);
    }

    case "number":
      return coerceLeaf(value, "number");
    case "boolean":
      return coerceLeaf(value, "boolean");
    case "bigint":
      return coerceLeaf(value, "bigint");
    case "date":
      return coerceLeaf(value, "date");

    default:
      // string, enum, literal, union, tuple, record, etc. — leave untouched.
      return value;
  }
}
