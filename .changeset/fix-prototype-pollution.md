---
"@justinwaite/tanstack-form-utils": minor
---

Security: fix prototype pollution and denial of service in `formDataToObject` and `parseSubmission`.

A field such as `__proto__.polluted=yes` wrote to `Object.prototype` for the whole server process. A field such as `items.4294967294=1` made an array with 4 billion slots, and a schema array walk then crashed Node.js.

The parser now rejects the keys `__proto__`, `constructor`, and `prototype` in FormData, `URLSearchParams`, and JSON payloads. It also limits field count, path depth, and array length. A rejected submission throws `FormDataParseError` (Zod) or fails with `InvalidBodyError` (Effect). You can pass other limits with the new `limits` option. See SECURITY.md.
