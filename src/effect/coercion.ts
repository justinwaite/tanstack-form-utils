import { type Schema, type SchemaAST } from "effect";

import { coerceLeaf } from "../coercion.ts";

/**
 * Walks an Effect schema's AST alongside a parsed FormData object and coerces
 * string leaves into the types the schema expects (`number`, `boolean`,
 * `bigint`), so the server validates the same shape the client did.
 *
 * The consumer's schema is only *read*, never rebuilt — validation still runs
 * against the original schema, preserving refinements and error messages.
 *
 * Scope (first cut): `number`, `boolean`, `bigint`, plus empty-string →
 * `undefined`, reached through `Objects`, `Arrays`, and optional/nullable
 * `Union` wrappers.
 *
 * Notably skipped:
 * - Any leaf that already carries an `encoding` (the consumer used a codec such
 *   as `Schema.NumberFromString` / `Schema.DateFromString` that decodes from a
 *   string itself — coercing again would be wrong).
 * - Dates: use `Schema.DateFromString` for form fields. `Schema.Date` expects a
 *   real `Date` and is an opaque `Declaration` we can't safely coerce a string
 *   into.
 * - Genuine multi-member unions, tuples with mixed element types, records,
 *   recursive (`Suspend`) schemas — passed through untouched.
 */
export function coerceFormValue(schema: Schema.Top, value: unknown): unknown {
  return walk(schema.ast, value);
}

/** Narrows an unknown form value to a plain (non-array) object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function walk(ast: SchemaAST.AST, value: unknown): unknown {
  // A leaf/codec that already decodes from its own input (e.g. NumberFromString,
  // DateFromString) handles the string itself — never double-coerce.
  if (ast.encoding) return value;

  switch (ast._tag) {
    case "Objects": {
      if (!isRecord(value)) return value;
      for (const ps of ast.propertySignatures) {
        // Form field names are always strings; skip symbol/number keys.
        if (typeof ps.name !== "string") continue;
        value[ps.name] = walk(ps.type, value[ps.name]);
      }
      return value;
    }

    case "Arrays": {
      if (!Array.isArray(value)) return value;
      return value.map((item, i) => {
        // Positional element for tuples, the variadic `rest` for plain arrays.
        const elementAst = ast.elements[i] ?? ast.rest[0];
        return elementAst ? walk(elementAst, item) : item;
      });
    }

    case "Union": {
      // Support optional/nullable (a single real member alongside
      // Undefined/Null/Void). Don't guess for genuine multi-type unions.
      const real = ast.types.filter(
        (t) => t._tag !== "Undefined" && t._tag !== "Null" && t._tag !== "Void",
      );
      const [only] = real;
      return real.length === 1 && only ? walk(only, value) : value;
    }

    case "Number":
      return coerceLeaf(value, "number");
    case "Boolean":
      return coerceLeaf(value, "boolean");
    case "BigInt":
      return coerceLeaf(value, "bigint");

    default:
      return value;
  }
}
