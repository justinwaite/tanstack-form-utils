---
"@justinwaite/tanstack-form-utils": minor
---

Security: fix prototype pollution and denial of service in `formDataToObject` and `parseSubmission`.

A field such as `__proto__.polluted=yes` wrote to `Object.prototype` for the whole server process. A field such as `items.4294967294=1` made an array with 4 billion slots, and a schema array walk then crashed Node.js.

The parser now rejects the keys `__proto__`, `constructor`, and `prototype` in FormData, `URLSearchParams`, and JSON payloads. It also limits field count, path depth, and array length. A rejected submission throws `FormDataParseError` (Zod) or fails with `InvalidBodyError` (Effect). You can pass other limits with the new `limits` option. See SECURITY.md.

More limits and parity rules:

- A new limit, `maxArraySlots` (default 100000), bounds the total length of all arrays in one submission. Before, 1000 small fields such as `items.0.tags.9999=x` could stop Node.js. Arrays with empty slots are still allowed.
- The new `readRequestBody(request, limits)` reads a `Request` with a body limit, `maxBodyBytes` (default 10 MiB). It also stops a chunked body. The Effect `parseSubmission` uses it. With Zod, call `parseSubmission(await readRequestBody(request), { schema })`.
- A JSON body with a duplicate key, a lone surrogate, or a number that overflows to `Infinity` is rejected. JSON payloads now also get the `maxFields`, `maxArrayLength`, and `maxArraySlots` limits.
- New limits `maxFiles` (default 100) and `maxFileBytes` (default 10 MiB) apply to files.
- A nested field that is sent twice, such as `user.role=a&user.role=b`, now becomes an array, as a flat field does. Before, the last value silently won.
- Coercion accepts only strict forms. Numbers must be decimal and finite: `0x10`, `" 5"`, and `Infinity` stay strings. Bigints must be decimal, with at most 4300 digits. Dates must be `YYYY-MM-DD` or RFC 3339 with a time zone. A `datetime-local` value stays a string.
- `objectToFormData` writes dates with `toISOString()`. It throws a `TypeError` for a key that is empty or contains `.`, `[`, or `]`.
- Options and limits are read only as own properties, so a polluted `Object.prototype` cannot turn a limit off. A limit that is not a non-negative integer throws a `TypeError`.
