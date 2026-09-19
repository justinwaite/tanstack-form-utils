# Audit Report: Form Payload Parsing

| Item      | Value                                                                           |
| --------- | ------------------------------------------------------------------------------- |
| Date      | 2026-09-18                                                                      |
| Audited   | `@justinwaite/tanstack-form-utils` 0.4.3                                        |
| Fixed in  | `@justinwaite/tanstack-form-utils` 0.5.0                                        |
| Runtime   | Node.js v24.21.0                                                                |
| Standards | The standards and the required behavior are in [SECURITY.md](../../SECURITY.md) |

The audit found 23 issues, and one remediation fixes or documents all of them.
F-1 to F-11 are prototype pollution, array allocation, and parameter pollution
in the FormData path. F-12 to F-23 are limits across fields, JSON parity,
coercion, the request body, and option gadgets. All security tests are in one
black-box suite.

## Scope

The audit covered all code that turns untrusted request data into objects:

1. `parsePath` and `formDataToObject` in `src/server-validation.ts`.
2. `parseSubmission` in `src/zod/server-validation.ts` and `src/effect/server-validation.ts`.
3. The coercion walkers in `src/zod/coercion.ts` and `src/effect/coercion.ts`, and
   the leaf coercion in `src/coercion.ts`.
4. `mergeServerErrors` in `src/core.ts`, which reads server `fieldErrors` in the browser.
5. The request body read in the Effect `parseSubmission`, now `readRequestBody`
   in `src/request-body.ts`.
6. `objectToFormData` in `src/server-validation.ts`, which runs in the browser.

Streaming multipart parsing is out of scope. The maintainers decided not to add
a multipart parser dependency.

## Method

1. A proof-of-concept script sent attack payloads to release 0.4.3.
2. A security test suite encoded the required behavior from SECURITY.md.
3. The suite ran against release 0.4.3.
4. The same suite ran against release 0.5.0.

The payload shapes come from published advisories for `qs`, `lodash`,
`dot-prop`, `set-value`, `object-path`, and `dset`. SECURITY.md lists the
advisory numbers.

All security tests are in `test/security/`, a separate Vitest project:

1. The suite is black-box. Each test sends the attack through the public entry
   points, the way an application `action` calls them. Each attack runs against
   the Zod path (`readRequestBody` and then `parseSubmission`) and the Effect
   path (`parseSubmission` with the `Request`). Only `parsePath` and
   `mergeServerErrors` have unit tests, because an attacker reaches them only
   through other code.
2. The suite loads external test sets as data: the WPT urlencoded parser rows,
   JSONTestSuite files, and the Bishop Fox JSON interoperability payloads.
   `test/security/corpus/README.md` names the source commits.
3. The suite cites WSTG and CAPEC IDs, which SECURITY.md lists.

## Summary

| ID   | Severity | Standard                                    | Failure                                                                        | Status     |
| ---- | -------- | ------------------------------------------- | ------------------------------------------------------------------------------ | ---------- |
| F-1  | Critical | CWE-1321, ASVS V15.3.6                      | `__proto__` keys write to `Object.prototype` on the server                     | Fixed      |
| F-2  | Critical | CWE-770                                     | One small field allocates a 4-billion-slot array and crashes Node.js           | Fixed      |
| F-12 | Critical | CWE-770, CWE-405, CAPEC-130                 | Many small sparse-array fields stop Node.js: a 21 KB body runs out of memory   | Fixed      |
| F-3  | High     | CWE-770                                     | An `items.length` field resizes an array, with the same crash                  | Fixed      |
| F-4  | Medium   | CWE-1321                                    | Inherited names such as `valueOf.x` fail as field names                        | Fixed      |
| F-5  | Medium   | CWE-1321, ASVS V15.3.6                      | A `__proto__` key in `fieldErrors` writes to `Object.prototype` in the browser | Fixed      |
| F-6  | Medium   | CWE-770                                     | No limit on path depth or field count                                          | Fixed      |
| F-13 | Medium   | CWE-1321, WSTG-INJT-22                      | A polluted `Object.prototype.limits` turns off every limit                     | Fixed      |
| F-14 | Medium   | CWE-235, WSTG-INJT-04, ASVS V1.5.3, V15.3.7 | JSON `{"role":"user","role":"admin"}` passes as `admin`                        | Fixed      |
| F-15 | Medium   | CWE-235, WSTG-INJT-04, ASVS V15.3.7         | A nested duplicate key such as `user.role` keeps only the last value           | Fixed      |
| F-16 | Medium   | CWE-770, ASVS V1.5.3                        | JSON payloads skip `maxFields` and `maxArrayLength`                            | Fixed      |
| F-17 | Medium   | CWE-1286, CAPEC-267, ASVS V15.3.5           | Number coercion accepts `0x10` and `Infinity`. JSON accepts `1e400`            | Fixed      |
| F-18 | Medium   | CWE-1286, RFC 3339                          | Date coercion accepts `1` and `2024-02-30`, in the server time zone            | Fixed      |
| F-19 | Medium   | CWE-770, CAPEC-231                          | The library reads the full body before any limit, and has no file limit        | Fixed      |
| F-7  | Low      | CWE-1321                                    | `-1` becomes an array index                                                    | Fixed      |
| F-8  | Low      | CWE-20                                      | An empty field name writes a key named `undefined`                             | Fixed      |
| F-9  | Low      | ASVS V1.5.3                                 | JSON payloads do not get the FormData key rules                                | Fixed      |
| F-10 | Low      | CWE-117                                     | Error messages repeat the full attacker key                                    | Fixed      |
| F-11 | Low      | CWE-235, ASVS V15.3.7                       | `role` and `[role]` overwrite each other with no error                         | Fixed      |
| F-20 | Low      | CWE-140                                     | `objectToFormData` writes the key `a.b`, and the server reads `{ a: { b } }`   | Fixed      |
| F-21 | Low      | CWE-176, RFC 7493 §2.1, ASVS V1.5.3         | FormData changes a lone surrogate to U+FFFD. JSON keeps it                     | Fixed      |
| F-22 | Guidance | CWE-22, WSTG-BUSL-08, RFC 7578 §4.2         | A multipart `filename="../../etc/p0"` reaches the application as-is            | Documented |
| F-23 | Guidance | CWE-352, WSTG-SESS-05                       | CSRF protection comes from React Router, not from this library                 | Documented |

## Test results

| Release | Passed | Failed | Skipped | Evidence                                   |
| ------- | ------ | ------ | ------- | ------------------------------------------ |
| 0.4.3   | 506    | 348    | 8       | [evidence/before.txt](evidence/before.txt) |
| 0.5.0   | 862    | 0      | 0       | [evidence/after.txt](evidence/after.txt)   |

Four tests were skipped for both the Zod and the Effect paths, 8 in total. On
0.4.3, each one stops the test worker with
`FATAL ERROR: invalid table size Allocation failed - JavaScript heap out of memory`.
The skipped tests are:

1. "rejects a 4-billion index" (F-2)
2. "rejects `length` on an array" (F-3)
3. "rejects 1000 sparse arrays" (F-12)
4. "ignores a polluted `Object.prototype.limits`" (F-13)

Some 0.4.3 failures come from the new API. For example, 0.4.3 has no `limits`
option, so the tests for a bad limit value fail. The
per-finding sections below name the tests that show the vulnerable behavior
itself.

On 0.5.0, `vp check` reported no format, lint, or type errors. All three
Vitest projects passed: security 862 of 862, unit 88 of 88, and browser 11 of 11. The unit project holds no security tests.

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

Test evidence. `test/security/prototype-pollution.test.ts`, describe
"dangerous FormData keys are rejected (F-1)": 72 failed before, 72 passed
after.

### F-2: Memory exhaustion through a large array index

Failure. The 18-byte body `items.4294967294=1` made a sparse array with a
length of 4294967295. With a `z.array` schema, the coercion walker called
`value.map`. Node.js then stopped with
`FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory`
after about 120 seconds. One request stops the whole server process.

Remediation. `assertWritable` in `src/server-validation.ts` rejects an array
index at or above `maxArrayLength` (default 10000), with
`reason: "array-index"`.

Test evidence. On 0.4.3, the test "rejects a 4-billion index in less than
50 ms" stopped the test worker, so the run skipped it. On 0.5.0, it passes for
both paths. `test/security/resource-limits.test.ts`, describe "array indices
(F-2, F-3)": 10 failed and 4 skipped before, 16 passed after.

### F-3: Memory exhaustion through an array length key

Failure. The body `items.0=a&items.length=4294967295` set the array length
directly, with the same crash as F-2.

Remediation. `assertWritable` accepts only numeric indices on an array. Any
named key, `length` included, fails with `reason: "conflicting-path"`.

Test evidence. On 0.4.3, the test "rejects `length` on an array" stopped the
test worker, so the run skipped it. The test "rejects any non-index key on an
existing array" failed. On 0.5.0, both pass for both paths.

### F-4: Inherited property names break field parsing

Failure. The body `valueOf.x=1` threw
`Conflicting form field paths: "valueOf" is used as both a value and a container`,
because the parser read the inherited `Object.prototype.valueOf` function as an
existing value. The same failure came from `hasOwnProperty`, `toString`, and
`isPrototypeOf`.

Remediation. `ownValue` in `src/server-validation.ts` uses `Object.hasOwn`.
The Zod and Effect coercion walkers also skip keys that the payload does not
own. Thus they do not copy an inherited function into the payload.

Test evidence. `test/security/path-parsing.test.ts`, describe "inherited
property names are ordinary fields (F-4)": 12 failed before, 16 passed after.

### F-5: Prototype pollution in the browser through server field errors

Failure. `mergeServerErrors` read `fieldMetaBase[field]` for each key in
`serverResult.fieldErrors`. For the key `__proto__`, this returned
`Object.prototype`, and the function wrote `errorMap` and `isTouched` into it.
The 0.4.3 test run reported:

```
AssertionError: a built-in prototype was polluted: expected [ 'errorMap', 'isTouched' ] to deeply equal []
```

Remediation. `mergeServerErrors` in `src/core.ts` skips `__proto__`,
`constructor`, and `prototype`, and uses `Object.hasOwn` to find existing
metadata. The Effect `schemaFailureToResponse` now builds `fieldErrors` with
`Object.fromEntries`, which defines own properties.

Test evidence. `test/security/client-merge.test.ts`: 3 failed before, 5
passed after.

### F-6: No limit on depth or field count

Failure. The parser accepted any path depth and any number of fields.

Remediation. `formDataToObject` rejects more than `maxFields` entries (default 10000) with `reason: "field-count"`. `assertSafePath` rejects more than
`maxDepth` segments (default 32) with `reason: "depth"`. Callers can change both
limits with the `limits` option.

Test evidence. `test/security/resource-limits.test.ts`, describes "path depth
(F-6)" and "field count (F-6)": 12 failed before, 16 passed after.

### F-7: Negative numbers become array indices

Failure. `parsePath("a.-1")` returned `["a", -1]`, so the parser made an array
with a `-1` property.

Remediation. `parsePath` accepts only canonical non-negative integers
(`/^(?:0|[1-9]\d*)$/`) as indices.

Test evidence. `test/security/path-parsing.test.ts`, describe "only canonical
non-negative integers are indices (F-7)": 2 failed before, 2 passed after. The
`parsePath` unit test "keeps "-1" as a string segment (F-7)" failed before and
passes after.

### F-8: Empty field names

Failure. The keys `""`, `.`, and `[]` produced an empty path. The parser then
wrote to a key named `undefined`.

Remediation. `assertSafePath` rejects an empty path with
`reason: "empty-path"`.

Test evidence. `test/security/path-parsing.test.ts`, describe "empty paths are
rejected (F-8)": 14 failed before, 14 passed after.

### F-9: JSON payloads skip the key rules

Failure. A JSON body with `__proto__` or `constructor.prototype` keys passed
through `parseSubmission` without an error. The schema removes these keys for
`z.object` and `Schema.Struct`, but not for every schema type.

Remediation. `assertSafePayload` in `src/server-validation.ts` applies the same
key rules and the `maxDepth` limit to parsed payloads. It walks the payload
without recursion, so deep input cannot overflow the stack. Both
`parseSubmission` functions call it for payloads that are not FormData.

Test evidence. `test/security/prototype-pollution.test.ts`, describe "JSON
payloads get the same key rules (ASVS V1.5.3, F-9)": 18 failed before, 22
passed after.

### F-10: Error messages repeat the full key

Failure. A 5000-character key appeared in full in the error message.

Remediation. `describeKey` shortens a key to 100 characters. No message
contains a submitted value.

Test evidence. `test/security/path-parsing.test.ts`, describe "error messages
(F-10, CWE-117)": 5 failed before, 6 passed after.

### F-11: Two spellings of one field overwrite each other

Failure. The body `role=user&[role]=admin` returned `{ role: "admin" }`. The
parser counted duplicates by the raw key, so it did not see that both keys name
the same field. The first value was lost with no error.

Remediation. `formDataToObject` counts duplicates by the normalized path
segment. The result is `{ role: ["user", "admin"] }`, and a string schema
rejects it.

Test evidence. `test/security/parameter-pollution.test.ts`, test "treats
`role` and `[role]` as one field with two values (F-11)": failed before for
both paths, passes after.

### F-12: Memory exhaustion through many sparse arrays

Failure. Each field `items.<i>.tags.9999=x` made an array of 10000 slots with
9999 empty slots. Every field passed the F-2 limit, because each index was
below `maxArrayLength`. Zod then reported one issue for each empty slot. The
F-2 limit bounded one array, not the total of all arrays.

| Fields | Body size | Zod issues | Time       | Result                                               |
| ------ | --------- | ---------- | ---------- | ---------------------------------------------------- |
| 1      | 19 bytes  | 9999       | 15 ms      | Error reply                                          |
| 100    | 2 KB      | 999900     | 814 ms     | Error reply with 999900 entries in `fieldErrors`     |
| 1000   | 21 KB     | none       | about 35 s | Node.js stopped with `JavaScript heap out of memory` |

The Effect variant stopped at the first issue and returned in 23 ms. It got
the same arrays. If a schema uses `errors: "all"`, the Effect variant has the
same exposure.

Remediation.

1. The new limit `maxArraySlots` (default 100000) bounds the total length of
   all arrays in one submission, empty slots included.
2. If an index is past the end of an array, `assertWritable` in
   `src/server-validation.ts` counts the new slots. An array that duplicate keys make also
   counts. Above the limit, the parser rejects with `reason: "array-index"`.
3. Sparse arrays stay allowed, because a native HTML form can skip an index
   (maintainer decision 1).

Test evidence. `test/security/resource-limits.test.ts`, describe "total array
slots across fields (F-12)": 6 failed and 2 skipped before, 10 passed after.
On 0.4.3, the 1000-field test stopped the test worker, so the run skipped it.
On 0.5.0, the 100-field and 1000-field bodies are rejected in 3 ms or less.

### F-13: Option gadget through a polluted prototype

Failure. `parseSubmission` read `options.limits` and `options.init` from an
object literal. If other code in the process polluted `Object.prototype`, these
reads returned the polluted value. A polluted `Object.prototype.limits` with a
large `maxArrayLength` let `items.4294967294=1` through to the schema walk.
A polluted `Object.prototype.init` changed the Effect failure status from 400
to 200. WSTG-INJT-22 tells testers to look for such gadgets.

Remediation.

1. If an option is not an own property, `ownOption` in `src/limits.ts` ignores
   it. Both `parseSubmission` functions read `schema`, `limits`, and
   `init` with it.
2. `resolveLimits` copies only own properties, and throws a `TypeError` for a
   limit that is not a non-negative safe integer. The Effect `parseSubmission`
   then dies, because a bad limit is a programming error and not bad input.

Test evidence. `test/security/option-gadgets.test.ts`: 25 failed and 2 skipped
before, 27 passed after. On 0.4.3, the test "ignores a polluted
`Object.prototype.limits`" stopped the test worker, so the run skipped it.

### F-14: JSON duplicate keys

Failure. `JSON.parse` keeps the last value of a duplicate key and gives no
signal. The JSON body `{"role":"user","role":"admin"}` passed as `admin`. The
same data as FormData became an array, and the schema rejected it. The two
input formats disagreed (WSTG-INJT-04, CAPEC-43).

Remediation.

1. `readRequestBody` in `src/request-body.ts` reads the body as text. After
   `JSON.parse` succeeds, `findDuplicateKey` scans the text in one pass. It
   compares keys after the JSON escapes are decoded, so `"r\u006fle"` equals
   `"role"`. A duplicate key rejects with the new reason `"duplicate-key"`.
2. The Effect `parseSubmission` reads a `Request` with `readRequestBody`.
3. The Zod `parseSubmission` receives a payload that the caller read.
   `readRequestBody` is now exported, and the README uses it in the Zod
   example.

Test evidence. `test/security/parameter-pollution.test.ts`, describe "JSON
duplicate keys (F-14)": 10 failed before, 14 passed after. The JSONTestSuite
`y_object_duplicated_key*` files and the Bishop Fox "Duplicate key precedence"
row failed before and pass after.

### F-15: Nested duplicate keys keep only the last value

The audit found this issue during the tests for F-14. A duplicate FormData key
became an array only at the top level.

Failure. The body `user.role=user&user.role=admin` returned
`{ user: { role: "admin" } }`. The parser collected a repeated flat key into an
array, but it overwrote a repeated nested key with no error. The first value
was lost. The same happened for `items.0=user&items[0]=admin`.

Remediation. `setLeaf` in `src/server-validation.ts` counts the values of each
canonical path, at any depth. A path that gets a second value becomes an array
of all its values, as a flat key does. The parser marks this array as a value,
so a later path such as `user.role.0=x` cannot write into it. It rejects that
path with `reason: "conflicting-path"`.

This changes the result for a form that sends a nested key twice. The functional
test "overwrites duplicate nested keys (last write wins)" now expects an array.

Test evidence. `test/security/parameter-pollution.test.ts`, describe "FormData
duplicate keys": 10 failed before, 12 passed after. Two of the failures are
the F-11 test.

### F-16: JSON payloads skip the count limits

Failure. `assertSafePayload` applied only `maxDepth` and the key rules. A JSON
array of 1000000 items passed with `maxArrayLength: 10`. A JSON object with
200000 keys passed with `maxFields: 10`.

Remediation. `assertSafePayload` now applies `maxFields`, `maxArrayLength`, and
`maxArraySlots`. A JSON object key or array item counts as one field. It checks
the length of an array before it reads the items.

Test evidence. `test/security/resource-limits.test.ts`, describe "JSON payloads
get the same limits (F-16)": 16 failed before, 16 passed after. A pre-parsed
array of 1000000 items is rejected in less than 50 ms.

### F-17: Loose number and bigint coercion

Failure. `coerceLeaf` called `Number(value)` and `BigInt(value)`. These accept
hexadecimal, binary, and octal forms, and they trim white space. `Number` also
accepts `Infinity`, and `1e400` becomes `Infinity`. `z.number()` rejects an
infinite value, but `Schema.Number` accepts it. Another component that reads
the raw string sees a different value than the schema sees. A JSON body can
also carry `1e400`, which `JSON.parse` turns into `Infinity`.

Remediation.

1. `coerceLeaf` in `src/coercion.ts` converts a number only from a decimal
   string. The pattern `^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$` has no
   nested quantifiers, so it runs in linear time. A pattern such as
   `\d+\.?\d*` can backtrack in quadratic time on a long digit string.
2. The result must be finite. Otherwise the string stays.
3. A bigint converts only from `^[+-]?\d+$`, with at most 4300 digits. Python
   uses the same limit against the quadratic cost of `BigInt`
   (CVE-2020-10735).
4. `assertSafePayload` rejects a JSON number that is not finite, with the new
   reason `"non-finite-number"`.

Test evidence. `test/security/coercion.test.ts`, describes "numbers (F-17)" and
"bigints (F-17)": 38 failed before, 90 passed after. A 1000000-digit bigint
string is kept in 18 ms. Before, `BigInt` took 514 ms to convert a
5000000-digit string.

### F-18: Loose date coercion

Failure. `coerceLeaf` called `new Date(value)`. For a string that is not ISO
8601, the result depends on the JavaScript engine and on the server time zone.
The probe got these results:

| Input        | Result                     |
| ------------ | -------------------------- |
| `1`          | `2001-01-01T06:00:00.000Z` |
| `0`          | `2000-01-01T06:00:00.000Z` |
| `Tue Mar 5`  | Accepted                   |
| `2024-02-30` | Accepted                   |

Remediation.

1. A date converts only from `YYYY-MM-DD` (the value of `<input type="date">`,
   read as midnight UTC), or from RFC 3339 with seconds and a time zone.
2. `parseStrictDate` builds the instant from its parts with UTC functions. The
   result does not depend on the engine or the server time zone.
3. It rejects a calendar date that does not exist, such as February 30, and
   an hour, minute, or second out of range.
4. A `datetime-local` value has no time zone, so it stays a string for the
   schema (maintainer decision 3).
5. `objectToFormData` now writes a `Date` with `toISOString()`. It used
   `toString()`, which the strict rule rejects and which drops the
   milliseconds.

Test evidence. `test/security/coercion.test.ts`, describe "dates (F-18)": 14
failed before, 26 passed after. The two round-trip tests in
`test/security/serialization.test.ts` failed before, because the milliseconds
were lost.

### F-19: No limit on the body size or on files

Failure. `request.formData()` parsed a 9.9 MB body with 1000000 fields in
145 ms before `maxFields` rejected it. A 4.3 MB multipart body with 50000 file
parts parsed in 200 ms. The library had no limit on the body size, the number
of files, or the size of a file.

Remediation.

1. `readRequestBody` in `src/request-body.ts` rejects a `Content-Length` above
   `maxBodyBytes` (default 10 MiB) before it reads the body.
2. It reads the body stream and counts the bytes, because a chunked body has
   no `Content-Length`, and a client can send a false one. It cancels the
   stream at the limit. A 14 MiB chunked body stops after 10.55 MB in about
   2 ms.
3. `formDataToObject` applies `maxFiles` (default 100) and `maxFileBytes`
   (default 10 MiB). An empty file input does not count.
4. The Effect `parseSubmission` uses `readRequestBody`. Zod users call it
   before `parseSubmission`.

`request.formData()` still parses a full multipart body before the file count
is known. The 50000-file test takes about 1.5 s and then rejects. The body
limit bounds this cost (maintainer decision 4).

Test evidence. `test/security/resource-limits.test.ts`, describes "body size
(F-19)" and "files (F-19)": 18 failed before, 24 passed after.

### F-20: Path delimiters in `objectToFormData` keys

Failure. `objectToFormData({ prefs: { "a.b": 1, "x[0]": 2 } })` sent keys that
the server parsed as `{"prefs":{"a":{"b":"1"},"x":["2"]}}`. The round trip
changed the shape of the data. A `z.record` field with keys that a user chose
can hit this.

Remediation. `objectToFormData` throws a `TypeError` for an object key that is
empty or contains `.`, `[`, or `]`.

Test evidence. `test/security/serialization.test.ts`: 10 failed before, 11
passed after.

### F-21: Lone surrogates

Failure. The FormData parser changes a lone surrogate such as U+D800 to
U+FFFD. The JSON parser keeps it. One key had two spellings, depending on the
input format.

Remediation. `assertSafePayload` rejects a key or a string value that is not
well formed (`String.prototype.isWellFormed()`), with the new reason
`"malformed-string"`. The TypeScript `lib` setting moved to `es2024` for this
method.

Test evidence. `test/security/parameter-pollution.test.ts`, describe "lone
surrogates (F-21)": 10 failed before, 14 passed after. The JSONTestSuite `i_`
surrogate files and the Bishop Fox "lone surrogate" row failed before and pass
after.

### F-22: File names from the client

The parser keeps `File.name` as the client sent it. The library does not write
files, so this is not a defect in the library. A test records the behavior.
SECURITY.md now tells applications not to use `File.name` as a path, and to
check the type of a file from its content.

### F-23: CSRF

A cross-site page can send a form POST with no CORS preflight, because the form
content types are CORS-safelisted. React Router fixed CSRF in action
processing in CVE-2026-22030, in versions 7.18.2 and 8.3.0. The peer dependency
`react-router >= 8.3.1` includes the fix. An application that calls the Effect
`parseSubmission` outside React Router does not get this protection.
SECURITY.md now says so. A test makes sure that a JSON body sent as
`text/plain` is not read as JSON.

## Areas that passed

These areas had no failure. The suite keeps tests for them, so that a later
change cannot break them:

1. `z.object` and `Schema.Struct` remove keys that the schema does not declare.
2. The Effect `parseSubmission` reads only the body of a `POST` request, and
   only the query string of a `GET` request.
3. A field that is sent twice becomes an array, and a string schema rejects it.
4. Coercion changes only the types that the schema asks for.
5. `objectToFormData` reads only own enumerable keys.

The audit also reviewed these areas and found no failure:

| Area                                  | Reason                                                                            |
| ------------------------------------- | --------------------------------------------------------------------------------- |
| Regular expression DoS (CAPEC-492)    | The regular expressions in `parsePath` and `isJsonContentType` run in linear time |
| Hash flooding (CWE-407)               | V8 uses a random hash seed                                                        |
| `_charset_` and UTF-7 body tricks     | Bodies decode as UTF-8 only. All 35 WPT rows pass with three charset parameters   |
| A byte order mark in a key            | The key stays literal, and the schema strips it                                   |
| JSON sent as `text/plain` (JSON CSRF) | The Effect path reads JSON only for a JSON media type. A test keeps this true     |

## Remediation design

The parser rejects a submission with a dangerous key. It does not drop the key
silently, as `qs` does. A real form never sends these keys, so a rejection
tells you about an attack or a bug.

The parser still returns plain objects, so the output of `formDataToObject` does
not change for valid input. The OWASP cheat sheet calls a key denylist "defense
in depth". The own-property reads and the strict array rules close the paths
that a denylist alone does not close. TanStack Form uses the same denylist in
`mergeForm`.

The JSON rules follow the same design. A duplicate JSON key, a lone surrogate,
and a number that is not finite fail the submission. They do not disappear
silently. Coercion is the exception. A string that is not in a strict form
stays a string, so the schema reports a normal type error to the user.

The maintainers made four decisions:

1. Sparse arrays stay allowed, because native HTML forms can skip an index.
   The total-slot limit bounds them.
2. The default `maxArraySlots` is 100000.
3. A `datetime-local` value stays a string for the schema.
4. Streaming multipart parsing is out of scope. The body limit bounds the cost
   of a multipart body.

## Changed files

| File                                                  | Change                                                                                                    |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `src/limits.ts`                                       | New. The limits, `resolveLimits` with own-property reads, and `ownOption`                                 |
| `src/parse-error.ts`                                  | New. `FormDataParseError` and its reasons                                                                 |
| `src/request-body.ts`                                 | New. `readRequestBody` with the byte limit and the duplicate-key scan                                     |
| `src/server-validation.ts`                            | Key rules, count and slot limits, nested duplicates, file limits, `assertSafePayload`, `objectToFormData` |
| `src/coercion.ts`                                     | Strict number, bigint, and date coercion                                                                  |
| `src/zod/server-validation.ts`                        | `limits` option, JSON key rules, own-property option reads, new re-exports                                |
| `src/effect/server-validation.ts`                     | `limits` option, JSON key rules, own-property option reads and `fieldErrors`, `readRequestBody`           |
| `src/zod/coercion.ts`, `src/effect/coercion.ts`       | Skip keys that the payload does not own                                                                   |
| `src/core.ts`                                         | `mergeServerErrors` exported and protected                                                                |
| `src/effect/parse-form-data.ts`, `parse-json-body.ts` | Deleted. `readRequestBody` replaces them                                                                  |
| `src/index.ts`                                        | Exports `readRequestBody`                                                                                 |
| `test/security/`                                      | New. The black-box security suite, its helpers, the prototype guard, and the corpus                       |
| `src/server-validation.test.ts`                       | Two functional tests updated for F-15 and F-18                                                            |
| `vite.config.ts`, `package.json`                      | The `security` Vitest project and the `test:security` script                                              |
| `tsconfig.json`                                       | `lib` moved to `es2024` for `isWellFormed`                                                                |
| `README.md`, `SECURITY.md`                            | `readRequestBody`, the limits, strict coercion, and the required behavior                                 |

## Risks that remain

1. `readRequestBody` and the Effect `parseSubmission` limit the body size. An
   application that calls `request.formData()` or `request.json()` itself gets
   no limit and no duplicate-key check. `request.formData()` also parses a full
   multipart body before the file limits run.
2. Schemas that keep unknown keys (`z.looseObject`, `z.record`, an Effect index
   signature) pass attacker-chosen keys to the application. SECURITY.md tells
   applications how to handle this.
3. The Zod `parseSubmission` cannot find a duplicate key in a payload that the
   caller already parsed. Only `readRequestBody` can, because it reads the text.
4. A JSON integer above 2^53 - 1 loses precision in `JSON.parse`, and the
   library accepts the rounded number (RFC 7493 §2.2). Send such values as
   strings, and use a bigint schema.
5. A submission with `__proto__`, `constructor`, or `prototype` in a field name
   now fails. The remediation also changes accepted input: strict coercion, nested
   duplicate keys, the new limits, and `objectToFormData` keys. These are
   changes in behavior, so the changeset is a minor version.
