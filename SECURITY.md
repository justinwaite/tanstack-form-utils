# Security Policy

This document covers `@justinwaite/tanstack-form-utils`. It tells you how to
report a vulnerability. It also lists the security standards that the library
follows, and the attack paths that the test suite covers.

## Reporting a vulnerability

Do not open a public issue for a security problem. Use GitHub private
vulnerability reporting on this repository: open the Security tab and select
"Report a vulnerability". The maintainers reply there.

## Supported versions

Only the latest published minor version gets security fixes.

## Threat model

The server functions in this library read data that an attacker controls. The
attacker controls every key and every value in a request body or query string.
The attacker does not need a browser, so client-side rules give no protection.

These functions receive untrusted input:

| Function                          | Untrusted input                                     |
| --------------------------------- | --------------------------------------------------- |
| `formDataToObject`                | `FormData` and `URLSearchParams` keys and values    |
| `parsePath`                       | Field path strings                                  |
| `parseSubmission` (Zod)           | `FormData`, `URLSearchParams`, or parsed JSON       |
| `parseSubmission` (Effect)        | A `Request`, `FormData`, `URLSearchParams`, or JSON |
| `coerceFormValue` (Zod, Effect)   | The object that `formDataToObject` returns          |
| `mergeServerErrors` (client core) | The `fieldErrors` keys in a server response         |

The schema that the developer writes is trusted. Schema keys come from source
code, not from the request.

## Standards

The library follows these standards. Each test in the security suite names the
standard item that it covers.

| ID                 | Source                                                                                                                           | Scope in this library                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| CWE-1321           | [Prototype pollution](https://cwe.mitre.org/data/definitions/1321.html)                                                          | Keys that write to `Object.prototype`                  |
| CWE-915            | [Mass assignment](https://cwe.mitre.org/data/definitions/915.html)                                                               | Extra keys that reach application code                 |
| CWE-770            | [Allocation without limits](https://cwe.mitre.org/data/definitions/770.html)                                                     | Large arrays, deep nesting, many fields                |
| CWE-235            | [Extra parameters](https://cwe.mitre.org/data/definitions/235.html)                                                              | Duplicate keys and parameter pollution                 |
| OWASP cheat sheet  | [Prototype Pollution Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Prototype_Pollution_Prevention_Cheat_Sheet.html) | Safe object construction                               |
| OWASP cheat sheet  | [Mass Assignment](https://cheatsheetseries.owasp.org/cheatsheets/Mass_Assignment_Cheat_Sheet.html)                               | Allow-list fields through the schema                   |
| ASVS 5.0.0 V1.1.1  | Decode input to a canonical form once, before you process it                                                                     | Key rules apply to the final, normalized path segments |
| ASVS 5.0.0 V1.5.3  | Parsers for the same data type parse in the same way                                                                             | FormData and JSON payloads get the same key rules      |
| ASVS 5.0.0 V15.3.3 | Limit the allowed fields per action, against mass assignment                                                                     | Schema strips keys that it does not declare            |
| ASVS 5.0.0 V15.3.5 | Variables have the correct type                                                                                                  | Coercion follows the schema only                       |
| ASVS 5.0.0 V15.3.6 | JavaScript code prevents prototype pollution                                                                                     | All object writes in the parser and the client merge   |
| ASVS 5.0.0 V15.3.7 | Defenses against HTTP parameter pollution                                                                                        | Duplicate keys, and body versus query string           |

OWASP does not publish a test suite for prototype pollution. The security suite
in this repository uses the payload shapes from these published advisories
instead:

| Advisory                         | Package       | Payload shape                                 |
| -------------------------------- | ------------- | --------------------------------------------- |
| CVE-2017-1000048, CVE-2022-24999 | `qs`          | `__proto__[x]=y` in a query string            |
| CVE-2019-10744                   | `lodash`      | `constructor.prototype` in a deep merge       |
| CVE-2020-8203                    | `lodash`      | `zipObjectDeep` with a `__proto__` path       |
| CVE-2020-8116                    | `dot-prop`    | `__proto__.x` as a dot path                   |
| CVE-2019-10747, CVE-2021-23440   | `set-value`   | Path bypass through type confusion            |
| CVE-2020-15256, CVE-2021-23434   | `object-path` | `__proto__` that a raw-path test did not find |
| CVE-2020-28277                   | `dset`        | `__proto__` in a nested set                   |

## Required behavior

Each row is one attack path. The security suite has at least one test for each
row. The suite is in `src/security.test.ts`, `src/zod/security.test.ts`,
`src/effect/security.test.ts`, and `src/core.test.ts`. "Reject" means that `formDataToObject` throws `FormDataParseError`. The Zod
`parseSubmission` throws the same error. The Effect `parseSubmission` fails with
`InvalidBodyError`.

### Prototype pollution

| Path                                                               | Required behavior |
| ------------------------------------------------------------------ | ----------------- |
| `__proto__.x`, `__proto__[x]`, `[__proto__][x]`                    | Reject            |
| `a.__proto__.x`, `items.0.__proto__.x`, `items[0][__proto__][x]`   | Reject            |
| `constructor.prototype.x`, `constructor[prototype][x]`             | Reject            |
| `a.constructor.prototype.x`, `a.constructor.constructor`           | Reject            |
| `__proto__`, `constructor`, `prototype` as a flat key              | Reject            |
| `__proto__[]`, `a.__proto__[]`, `__proto__.0`                      | Reject            |
| A dangerous key after valid keys, or repeated                      | Reject            |
| A dangerous key with a `File` value                                | Reject            |
| `%5F%5Fproto%5F%5F.x` in a query string (decoded once)             | Reject            |
| Bracket noise that normalizes to `__proto__`, such as `__pro]to__` | Reject            |
| `%255F%255Fproto%255F%255F.x` (double encoded)                     | Literal key       |
| `__PROTO__.x`, full-width `_` characters, trailing space           | Literal key       |
| JSON `{"__proto__": {...}}` at any depth                           | Reject            |
| JSON `{"constructor": {"prototype": {...}}}` at any depth          | Reject            |

After every test, the suite makes sure that `Object.prototype`,
`Array.prototype`, and `Function.prototype` did not change.

### Resource exhaustion

| Path                                                | Required behavior                   |
| --------------------------------------------------- | ----------------------------------- |
| `items.4294967294=1`                                | Reject in less than 50 ms           |
| An array index at or above `maxArrayLength`         | Reject                              |
| `items.length=...` or any non-index key on an array | Reject                              |
| Path depth above `maxDepth`                         | Reject                              |
| More entries than `maxFields`                       | Reject                              |
| JSON nesting above `maxDepth`                       | Reject, with no stack overflow      |
| Limits that the caller sets                         | The parser uses the caller's limits |

The default limits are:

| Limit            | Default | Reason                                             |
| ---------------- | ------- | -------------------------------------------------- |
| `maxFields`      | 10000   | Large forms fit. The `qs` default is 1000.         |
| `maxDepth`       | 32      | Real form paths are short. The `qs` default is 5.  |
| `maxArrayLength` | 10000   | A sparse array of this length costs little memory. |

You pass other limits with the `limits` option of `formDataToObject` and
`parseSubmission`.

### Path parsing

| Path                                                 | Required behavior                    |
| ---------------------------------------------------- | ------------------------------------ |
| `valueOf.x`, `hasOwnProperty.x`, `toString.x`        | Parse as ordinary nested fields      |
| `items.-1`, `items.01`, `items.1e3`, `items.0x1`     | Object keys, not array indices       |
| An empty path: `""`, `.`, `[]`, `[]` sentinel alone  | Reject                               |
| A key longer than 100 characters in an error message | Error message shortens the key       |
| Any error message                                    | Error message never contains a value |

### Mass assignment and parameter pollution

| Path                                                  | Required behavior                            |
| ----------------------------------------------------- | -------------------------------------------- |
| `isAdmin=true` with a schema that does not declare it | The schema output does not contain `isAdmin` |
| `name=a&name=b` with a string schema                  | Schema error, not a silent pick              |
| `role=user&[role]=admin`                              | One field with two values, not an overwrite  |
| `POST /?role=admin` with a body                       | The query string is not read                 |
| `GET /?name=a`                                        | Only the query string is read                |

### Client merge of server errors

| Path                                                       | Required behavior            |
| ---------------------------------------------------------- | ---------------------------- |
| `fieldErrors` keys `__proto__`, `constructor`, `prototype` | Skipped, no prototype change |
| `fieldErrors` key that is inherited, such as `toString`    | Creates new field metadata   |

## Audit reports

Audit reports are in the `audits/` directory. Each report lists the failures,
the remediations, and the test results before and after the fix.

## Guidance for applications

1. Use `z.object` or `Schema.Struct` for form schemas. If you use
   `z.looseObject`, `.passthrough()`, `z.record`, or an Effect index signature,
   your schema output contains keys that the attacker chose.
2. Do not deep-merge the schema output into another object with a merge
   function that does not block `__proto__`.
3. Set a request body size limit in your server or adapter. `request.formData()`
   reads the full body into memory before this library sees it.
4. You can start Node.js with `--disable-proto=delete` as an extra layer.
