# @justinwaite/tanstack-form-utils

## 0.5.0

### Minor Changes

- [#46](https://github.com/justinwaite/tanstack-form-utils/pull/46) [`c452969`](https://github.com/justinwaite/tanstack-form-utils/commit/c45296949e1b2721d2c24b3f982753dc7f92b06a) Thanks [@Mando75](https://github.com/Mando75)! - Security: fix prototype pollution and denial of service in `formDataToObject` and `parseSubmission`.
  
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

## 0.4.3

### Patch Changes

- [#41](https://github.com/justinwaite/tanstack-form-utils/pull/41) [`3d34640`](https://github.com/justinwaite/tanstack-form-utils/commit/3d3464079f8795b730be0400e296bc1a5eea5a77) Thanks [@Mando75](https://github.com/Mando75)! - add more dynamic parsing behavior for urlsearchparams and generic json input

## 0.4.2

### Patch Changes

- [#39](https://github.com/justinwaite/tanstack-form-utils/pull/39) [`2ec6be6`](https://github.com/justinwaite/tanstack-form-utils/commit/2ec6be6473dc0db82dc3858f6893e415aa9cf488) Thanks [@Mando75](https://github.com/Mando75)! - bump dependencies

## 0.4.1

### Patch Changes

- [#35](https://github.com/justinwaite/tanstack-form-utils/pull/35) [`9f1cc37`](https://github.com/justinwaite/tanstack-form-utils/commit/9f1cc376c7d722378cd1ce81312eccb4b0d30deb) Thanks [@Mando75](https://github.com/Mando75)! - bump peers to react router 8 and effect 4.101

## 0.4.0

### Minor Changes

- [#15](https://github.com/justinwaite/tanstack-form-utils/pull/15) [`0a0cf5a`](https://github.com/justinwaite/tanstack-form-utils/commit/0a0cf5abf9126209423887ffe1a8afc04fab90ca) Thanks [@Mando75](https://github.com/Mando75)! - Adds dynamic content-type parsing support. Will detect whether the request is json or form data and use the appropriate request body parser to validate the body against the given schema.

  Consolidates the FormDataError into an InvalidBodyError that is raised when an invalid request body is provided.

## 0.3.0

### Minor Changes

- [#12](https://github.com/justinwaite/tanstack-form-utils/pull/12) [`a3e8c0a`](https://github.com/justinwaite/tanstack-form-utils/commit/a3e8c0aeb998797ff33181a8f3ade1537664a950) Thanks [@justinwaite](https://github.com/justinwaite)! - Support Effect `4.0.0-beta.90` and raise the minimum `effect` peer dependency to `>=4.0.0-beta.90`. The `schema` accepted by the Effect `useAppForm` and `parseSubmission` is now typed as `Schema.Codec` (`Schema.Decoder` was removed upstream); any existing `Schema.Struct`-based schema continues to work unchanged.

## 0.2.0

### Minor Changes

- [#7](https://github.com/justinwaite/tanstack-form-utils/pull/7) [`60e01da`](https://github.com/justinwaite/tanstack-form-utils/commit/60e01dab37f20ca9d33fc3c7194f67bdc0ae2f60) Thanks [@justinwaite](https://github.com/justinwaite)! - Breaking: update the properties of FormValidationError. Removes the type generic and sets reply to SubmissionResponse

## 0.1.1

### Patch Changes

- [#4](https://github.com/justinwaite/tanstack-form-utils/pull/4) [`c86c92c`](https://github.com/justinwaite/tanstack-form-utils/commit/c86c92cbd67f4941721be665917856cd2217f657) Thanks [@justinwaite](https://github.com/justinwaite)! - Add missing exports from `createAppFormHook`, such as `withFieldGroup`
