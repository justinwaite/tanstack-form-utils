# Audit Report: Form Payload Parsing

| Item        | Value                                                                           |
| ----------- | ------------------------------------------------------------------------------- |
| Date        | 2026-09-18                                                                      |
| Version     | `@justinwaite/tanstack-form-utils` 0.4.3                                        |
| Base commit | `dc6d5d8`                                                                       |
| Branch      | `fix-prototype-pollution`                                                       |
| Runtime     | Node.js v24.21.0                                                                |
| Standards   | The standards and the required behavior are in [SECURITY.md](../../SECURITY.md) |

## Scope

The audit covered all code that turns untrusted request data into objects:

1. `parsePath` and `formDataToObject` in `src/server-validation.ts`.
2. `parseSubmission` in `src/zod/server-validation.ts` and `src/effect/server-validation.ts`.
3. The coercion walkers in `src/zod/coercion.ts` and `src/effect/coercion.ts`.
4. `mergeServerErrors` in `src/core.ts`, which reads server `fieldErrors` in the browser.

## Method

1. A proof-of-concept script sent attack payloads to the base commit.
2. A security test suite encoded the required behavior from SECURITY.md.
3. The suite ran against the base commit, before any code change.
4. The code changes went in, and the same suite ran again.

The payload shapes come from published advisories for `qs`, `lodash`,
`dot-prop`, `set-value`, `object-path`, and `dset`. SECURITY.md lists the
advisory numbers.

## Summary

| ID   | Severity | Standard               | Failure                                                                        | Status |
| ---- | -------- | ---------------------- | ------------------------------------------------------------------------------ | ------ |
| F-1  | Critical | CWE-1321, ASVS V15.3.6 | `__proto__` keys write to `Object.prototype` on the server                     | Fixed  |
| F-2  | Critical | CWE-770                | One small field allocates a 4-billion-slot array and crashes Node.js           | Fixed  |
| F-3  | High     | CWE-770                | An `items.length` field resizes an array, with the same crash                  | Fixed  |
| F-4  | Medium   | CWE-1321               | Inherited names such as `valueOf.x` fail as field names                        | Fixed  |
| F-5  | Medium   | CWE-1321, ASVS V15.3.6 | A `__proto__` key in `fieldErrors` writes to `Object.prototype` in the browser | Fixed  |
| F-6  | Medium   | CWE-770                | No limit on path depth or field count                                          | Fixed  |
| F-7  | Low      | CWE-1321               | `-1` becomes an array index                                                    | Fixed  |
| F-8  | Low      | CWE-20                 | An empty field name writes a key named `undefined`                             | Fixed  |
| F-9  | Low      | ASVS V1.5.3            | JSON payloads do not get the FormData key rules                                | Fixed  |
| F-10 | Low      | CWE-117                | Error messages repeat the full attacker key                                    | Fixed  |
| F-11 | Low      | CWE-235, ASVS V15.3.7  | `role` and `[role]` overwrite each other with no error                         | Fixed  |

## Test results

| Run                   | Passed | Failed | Skipped | Evidence                                   |
| --------------------- | ------ | ------ | ------- | ------------------------------------------ |
| Base commit `dc6d5d8` | 34     | 88     | 4       | [evidence/before.txt](evidence/before.txt) |
| Fixed working tree    | 126    | 0      | 0       | [evidence/after.txt](evidence/after.txt)   |

The base run needed two shims, so that it can finish:

1. `mergeServerErrors` in `src/core.ts` got an `export`, so that the test can import it.
2. Four tests were skipped. On the base code, each one crashed its test worker
   with `FATAL ERROR: invalid table size Allocation failed - JavaScript heap out of memory`.

Some base failures come from the new API. For example, `FormDataParseError`
and the `limits` option do not exist on the base commit. The per-finding
sections below name the tests that show the vulnerable behavior itself.

After the fix, `vp check` reported no lint or type errors. The unit project
passed 214 of 214 tests. The browser project passed earlier on the fixed code.
A later run did not start, because the Playwright Chromium binary was not
installed on the audit machine. To run it again, use `vp run test:browser:install`
and then `vp run test:browser`.

## Findings

### F-1: Prototype pollution through FormData keys

Failure. The request body `__proto__.polluted=yes` added `polluted` to
`Object.prototype` for the whole server process. The same result came from
`__proto__[polluted]`, `[__proto__].polluted`, `a.__proto__.polluted`, and
`items.0.__proto__.polluted`. The proof-of-concept output was:

```
__proto__.polluted => ({}).polluted: yes [].polluted: yes
a.__proto__.polluted => ({}).polluted: yes [].polluted: yes
items.0.__proto__.polluted => ({}).polluted: yes [].polluted: yes
```

Cause. `setNested` read `container["__proto__"]`, which returns
`Object.prototype`. It then wrote the attacker value into that object.

Remediation.

1. `assertSafePath` in `src/server-validation.ts` rejects `__proto__`,
   `constructor`, and `prototype` in any path segment. It runs after
   `parsePath` normalizes the path, so `__pro]to__` also fails.
2. `ownValue` reads existing values with `Object.hasOwn`, so an inherited
   object is never used as a container.
3. The parser throws `FormDataParseError` with `reason: "unsafe-key"`. The Zod
   `parseSubmission` throws it. The Effect `parseSubmission` fails with
   `InvalidBodyError`.

Test evidence. `src/security.test.ts`, describe "prototype pollution: dangerous
path segments are rejected": 32 failed before, 40 passed after. The
`installPrototypeGuard` hook in `test/prototype-guard.ts` reported
`a built-in prototype was polluted` on the base code. The Zod and Effect suites
have the same tests through `parseSubmission`, with 7 failed before.

### F-2: Memory exhaustion through a large array index

Failure. The 18-byte body `items.4294967294=1` made a sparse array with a
length of 4294967295. With a `z.array` schema, the coercion walker called
`value.map`. Node.js then stopped with
`FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory`
after about 120 seconds. One request stops the whole server process.

Remediation. `assertWritable` in `src/server-validation.ts` rejects an array
index at or above `maxArrayLength` (default 10000), with
`reason: "array-index"`.

Test evidence. On the base code, the Zod and Effect tests "huge sparse index"
crashed the test worker. After the fix, they pass and finish in less than 50 ms.
`src/security.test.ts`, describe "resource exhaustion: array indices": 8 failed
before, 8 passed after.

### F-3: Memory exhaustion through an array length key

Failure. The body `items.0=a&items.length=4294967295` set the array length
directly, with the same crash as F-2.

Remediation. `assertWritable` accepts only numeric indices on an array. Any
named key, `length` included, fails with `reason: "conflicting-path"`.

Test evidence. The Zod and Effect tests "array length override" crashed the
test worker on the base code. After the fix, they pass. `src/security.test.ts`
tests "rejects `length` on an array" and "rejects any non-index key on an
existing array" pass.

### F-4: Inherited property names break field parsing

Failure. The body `valueOf.x=1` threw
`Conflicting form field paths: "valueOf" is used as both a value and a container`,
because the parser read the inherited `Object.prototype.valueOf` function as an
existing value. The same failure came from `hasOwnProperty`, `toString`, and
`isPrototypeOf`.

Remediation. `ownValue` in `src/server-validation.ts` uses `Object.hasOwn`.
The Zod and Effect coercion walkers also skip keys that the payload does not
own. Thus they do not copy an inherited function into the payload.

Test evidence. `src/security.test.ts`, describe "path parsing: inherited
property names are ordinary fields": 6 failed before, 8 passed after.

### F-5: Prototype pollution in the browser through server field errors

Failure. `mergeServerErrors` read `fieldMetaBase[field]` for each key in
`serverResult.fieldErrors`. For the key `__proto__`, this returned
`Object.prototype`, and the function wrote `errorMap` and `isTouched` into it.
The base test run reported:

```
AssertionError: a built-in prototype was polluted: expected [ 'errorMap', 'isTouched' ] to deeply equal []
```

Remediation. `mergeServerErrors` in `src/core.ts` skips `__proto__`,
`constructor`, and `prototype`, and uses `Object.hasOwn` to find existing
metadata. The Effect `schemaFailureToResponse` now builds `fieldErrors` with
`Object.fromEntries`, which defines own properties.

Test evidence. `src/core.test.ts`: 3 failed before, 5 passed after.

### F-6: No limit on depth or field count

Failure. The parser accepted any path depth and any number of fields.

Remediation. `formDataToObject` rejects more than `maxFields` entries (default 10000) with `reason: "field-count"`. `assertSafePath` rejects more than
`maxDepth` segments (default 32) with `reason: "depth"`. Callers can change both
limits with the `limits` option.

Test evidence. `src/security.test.ts`, describes "resource exhaustion: depth"
and "resource exhaustion: field count": 8 failed before, 8 passed after.

### F-7: Negative numbers become array indices

Failure. `parsePath("a.-1")` returned `["a", -1]`, so the parser made an array
with a `-1` property.

Remediation. `parsePath` accepts only canonical non-negative integers
(`/^(?:0|[1-9]\d*)$/`) as indices.

Test evidence. `src/security.test.ts`, describe "path parsing: only canonical
non-negative integers are indices": 2 failed before, 10 passed after.

### F-8: Empty field names

Failure. The keys `""`, `.`, and `[]` produced an empty path. The parser then
wrote to a key named `undefined`.

Remediation. `assertSafePath` rejects an empty path with
`reason: "empty-path"`.

Test evidence. `src/security.test.ts`, describe "path parsing: empty paths are
rejected": 8 failed before, 8 passed after.

### F-9: JSON payloads skip the key rules

Failure. A JSON body with `__proto__` or `constructor.prototype` keys passed
through `parseSubmission` without an error. The schema removes these keys for
`z.object` and `Schema.Struct`, but not for every schema type.

Remediation. `assertSafePayload` in `src/server-validation.ts` applies the same
key rules and the `maxDepth` limit to parsed payloads. It walks the payload
without recursion, so deep input cannot overflow the stack. Both
`parseSubmission` functions call it for payloads that are not FormData.

Test evidence. The Zod and Effect describes "JSON payloads get the same key
rules": 8 failed before, 11 passed after.

### F-10: Error messages repeat the full key

Failure. A 5000-character key appeared in full in the error message.

Remediation. `describeKey` shortens a key to 100 characters. No message
contains a submitted value.

Test evidence. `src/security.test.ts`, describe "error messages": 2 failed
before, 3 passed after.

### F-11: Two spellings of one field overwrite each other

Failure. The body `role=user&[role]=admin` returned `{ role: "admin" }`. The
parser counted duplicates by the raw key, so it did not see that both keys name
the same field. The first value was lost with no error.

Remediation. `formDataToObject` counts duplicates by the normalized path
segment. The result is `{ role: ["user", "admin"] }`, and a string schema
rejects it.

Test evidence. `src/security.test.ts`, test "treats `role` and `[role]` as the
same field": failed before, passed after.

## Areas that passed

These areas had no failure. The suite keeps tests for them, so that a later
change cannot break them:

1. `z.object` and `Schema.Struct` remove keys that the schema does not declare.
2. The Effect `parseSubmission` reads only the body of a `POST` request, and
   only the query string of a `GET` request.
3. A field that is sent twice becomes an array, and a string schema rejects it.
4. Coercion changes only the types that the schema asks for.
5. `objectToFormData` reads only own enumerable keys.

## Remediation design

The parser rejects a submission with a dangerous key. It does not drop the key
silently, as `qs` does. A real form never sends these keys, so a rejection
tells you about an attack or a bug.

The parser still returns plain objects, so the output of `formDataToObject` does
not change for valid input. The OWASP cheat sheet calls a key denylist "defense
in depth". The own-property reads and the strict array rules close the paths
that a denylist alone does not close. TanStack Form uses the same denylist in
`mergeForm`.

## Changed files

| File                                          | Change                                                       |
| --------------------------------------------- | ------------------------------------------------------------ |
| `src/server-validation.ts`                    | Limits, `FormDataParseError`, key rules, `assertSafePayload` |
| `src/zod/server-validation.ts`                | `limits` option, JSON key rules, new re-exports              |
| `src/effect/server-validation.ts`             | `limits` option, JSON key rules, own-property `fieldErrors`  |
| `src/zod/coercion.ts`                         | Skips keys that the payload does not own                     |
| `src/effect/coercion.ts`                      | Skips keys that the payload does not own                     |
| `src/core.ts`                                 | `mergeServerErrors` exported and protected                   |
| `test/prototype-guard.ts`                     | Fails a test that changes a built-in prototype               |
| `src/**/security.test.ts`, `src/core.test.ts` | The security suite                                           |

## Risks that remain

1. `request.formData()` reads the full body into memory before this library
   runs. The application server must set a body size limit.
2. Schemas that keep unknown keys (`z.looseObject`, `z.record`, an Effect index
   signature) pass attacker-chosen keys to the application. SECURITY.md tells
   applications how to handle this.
3. `BigInt` coercion of a one-megabyte digit string takes about 60 ms. The body
   size limit also bounds this cost.
4. A submission with `__proto__`, `constructor`, or `prototype` in a field name
   now fails. This is a change in behavior, so the changeset is a minor version.
