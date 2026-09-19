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
| `readRequestBody`                 | A `Request`: its headers, body bytes, and URL       |
| `formDataToObject`                | `FormData` and `URLSearchParams` keys and values    |
| `parsePath`                       | Field path strings                                  |
| `parseSubmission` (Zod)           | `FormData`, `URLSearchParams`, or parsed JSON       |
| `parseSubmission` (Effect)        | A `Request`, `FormData`, `URLSearchParams`, or JSON |
| `coerceFormValue` (Zod, Effect)   | The object that `formDataToObject` returns          |
| `mergeServerErrors` (client core) | The `fieldErrors` keys in a server response         |

The schema that the developer writes is trusted. Schema keys come from source
code, not from the request. The options that the developer passes, such as
`limits`, are trusted. But the library reads them only as own properties,
because other code in the process can pollute `Object.prototype`.

`objectToFormData` runs in the browser on form state. Its keys can come from a
user, for example in a `z.record` field.

## Standards

The library follows these standards. Each test in the security suite names the
standard item that it covers.

| ID                 | Source                                                                                                                           | Scope in this library                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| CWE-1321           | [Prototype pollution](https://cwe.mitre.org/data/definitions/1321.html)                                                          | Keys that write to `Object.prototype`, option gadgets    |
| CWE-915            | [Mass assignment](https://cwe.mitre.org/data/definitions/915.html)                                                               | Extra keys that reach application code                   |
| CWE-770            | [Allocation without limits](https://cwe.mitre.org/data/definitions/770.html)                                                     | Large arrays, deep nesting, many fields, body size       |
| CWE-405            | [Asymmetric resource consumption](https://cwe.mitre.org/data/definitions/405.html)                                               | Small fields that make large sparse arrays               |
| CWE-235            | [Extra parameters](https://cwe.mitre.org/data/definitions/235.html)                                                              | Duplicate keys and parameter pollution                   |
| CWE-1286           | [Syntactic validation](https://cwe.mitre.org/data/definitions/1286.html)                                                         | Strict number, bigint, and date coercion                 |
| CWE-176            | [Unicode encoding](https://cwe.mitre.org/data/definitions/176.html)                                                              | Lone surrogates in JSON                                  |
| CWE-140            | [Delimiters](https://cwe.mitre.org/data/definitions/140.html)                                                                    | Path delimiters in `objectToFormData` keys               |
| OWASP cheat sheet  | [Prototype Pollution Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Prototype_Pollution_Prevention_Cheat_Sheet.html) | Safe object construction                                 |
| OWASP cheat sheet  | [Mass Assignment](https://cheatsheetseries.owasp.org/cheatsheets/Mass_Assignment_Cheat_Sheet.html)                               | Allow-list fields through the schema                     |
| ASVS 5.0.0 V1.1.1  | Decode input to a canonical form once, before you process it                                                                     | Key rules apply to the final, normalized path segments   |
| ASVS 5.0.0 V1.5.3  | Parsers for the same data type parse in the same way                                                                             | FormData and JSON payloads get the same rules and limits |
| ASVS 5.0.0 V15.3.3 | Limit the allowed fields per action, against mass assignment                                                                     | Schema strips keys that it does not declare              |
| ASVS 5.0.0 V15.3.5 | Variables have the correct type                                                                                                  | Coercion follows the schema only, in strict forms        |
| ASVS 5.0.0 V15.3.6 | JavaScript code prevents prototype pollution                                                                                     | All object writes in the parser and the client merge     |
| ASVS 5.0.0 V15.3.7 | Defenses against HTTP parameter pollution                                                                                        | Duplicate keys, and body versus query string             |
| RFC 7493           | [I-JSON](https://www.rfc-editor.org/rfc/rfc7493) §2.1, §2.2, §2.3                                                                | Well-formed strings, finite numbers, no duplicate names  |
| RFC 3339           | [Date and time on the internet](https://www.rfc-editor.org/rfc/rfc3339)                                                          | The date strings that coercion accepts                   |

### Test procedures and attack patterns

The OWASP Web Security Testing Guide (WSTG) publishes test procedures with
stable IDs. The IDs below come from the WSTG checklist on the `master` branch at
commit `5e501b3582005ea3a3a87d90d648f76359d48155`. WSTG renamed the
`WSTG-INPV` prefix to `WSTG-INJT`.

| ID           | Test                       | Scope in this library                                  |
| ------------ | -------------------------- | ------------------------------------------------------ |
| WSTG-INJT-22 | Prototype Pollution        | Dangerous keys, and option gadgets                     |
| WSTG-INJT-04 | HTTP Parameter Pollution   | Duplicate FormData keys, and duplicate JSON keys       |
| WSTG-INJT-20 | Mass Assignment            | Extra fields such as `isAdmin`, and `user[isAdmin]`    |
| WSTG-BUSL-08 | Upload of Unexpected Types | `File` values pass through. See the guidance below     |
| WSTG-BUSL-09 | Upload of Malicious Files  | `File` values pass through. See the guidance below     |
| WSTG-SESS-05 | Cross Site Request Forgery | Form content types need no preflight. See the guidance |

MITRE CAPEC gives an ID to each attack path that WSTG does not name:

| ID        | Name                                            | Scope in this library                  |
| --------- | ----------------------------------------------- | -------------------------------------- |
| CAPEC-460 | HTTP Parameter Pollution                        | Duplicate keys                         |
| CAPEC-130 | Excessive Allocation                            | Sparse arrays, JSON arrays, files      |
| CAPEC-229 | Serialized Data Parameter Blowup                | Sparse arrays, JSON limits             |
| CAPEC-231 | Oversized Serialized Data Payloads              | Body size                              |
| CAPEC-43  | Exploiting Multiple Input Interpretation Layers | FormData and JSON give the same result |
| CAPEC-267 | Leverage Alternate Encoding                     | Hexadecimal numbers, loose dates       |
| CAPEC-71  | Using Unicode Encoding to Bypass Validation     | Lone surrogates                        |
| CAPEC-62  | Cross Site Request Forgery                      | See the guidance below                 |

### Payload sources

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

The suite also loads these external test sets as data. Each row is a test.
`test/security/corpus/README.md` names the commit of each source.

| Test set                                                                                                                 | Use in the suite                                                        |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| [WPT `url/urlencoded-parser.any.js`](https://github.com/web-platform-tests/wpt/blob/master/url/urlencoded-parser.any.js) | Every row: `readRequestBody` output, and parse or reject with no crash  |
| [JSONTestSuite](https://github.com/nst/JSONTestSuite)                                                                    | The `y_object_duplicated_key*` files and every `i_` file                |
| [Bishop Fox JSON interoperability labs](https://github.com/BishopFox/json-interop-vuln-labs)                             | Duplicate-key, truncation, comment, and large-number payloads           |
| [PortSwigger server-side prototype pollution](https://github.com/PortSwigger/server-side-prototype-pollution)            | The `__proto__.__proto__` detection shape and the option gadget pattern |

## Required behavior

Each row is one attack path. The security suite has at least one test for each
row. The suite is in `test/security/`. It is a black-box suite: each test sends
the attack through the public entry points, the way an application `action`
calls them. It runs each attack against both entry points:

- Zod: `parseSubmission(await readRequestBody(request), { schema })`.
- Effect: `parseSubmission(request, { schema })`.

"Reject" means that the Zod path throws `FormDataParseError`, and the Effect
path fails with `InvalidBodyError`. `formDataToObject` and `readRequestBody`
throw `FormDataParseError` for the same input. The `reason` field of the error
names the rule.

Run the suite with `vp run test:security`.

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
| JSON `{"__proto__": {"__proto__": {...}}}` (PortSwigger shape)     | Reject            |

After every test, the suite makes sure that `Object.prototype`,
`Array.prototype`, and `Function.prototype` did not change.

### Option gadgets

| Path                                                                       | Required behavior               |
| -------------------------------------------------------------------------- | ------------------------------- |
| A polluted `Object.prototype.limits` with a large `maxArrayLength`         | The default limits apply        |
| A polluted `Object.prototype.maxDepth`, `maxArraySlots`, or `maxBodyBytes` | The default limits apply        |
| A polluted `Object.prototype.init` with `status: 200` (Effect)             | A validation error keeps 400    |
| A limit that is negative, fractional, `NaN`, `Infinity`, or not a number   | `TypeError` (programming error) |

### Resource exhaustion

| Path                                                               | Required behavior                      |
| ------------------------------------------------------------------ | -------------------------------------- |
| `items.4294967294=1`                                               | Reject in less than 1 second           |
| An array index at or above `maxArrayLength`                        | Reject                                 |
| `items.length=...` or any non-index key on an array                | Reject                                 |
| 1000 fields `items.<i>.tags.9999=x` (a 21 KB body)                 | Reject in less than 1 second           |
| Arrays whose lengths add up to more than `maxArraySlots`           | Reject. Empty slots count              |
| A native form that skips an index, such as `items.0` and `items.2` | Accept, with an empty slot             |
| Path depth above `maxDepth`                                        | Reject                                 |
| More entries than `maxFields`                                      | Reject                                 |
| JSON nesting above `maxDepth`                                      | Reject, with no stack overflow         |
| A JSON array longer than `maxArrayLength`                          | Reject                                 |
| JSON object keys and array items above `maxFields`                 | Reject                                 |
| JSON arrays whose lengths add up to more than `maxArraySlots`      | Reject                                 |
| A `Content-Length` above `maxBodyBytes`                            | Reject before the body is read         |
| A chunked body, or a false `Content-Length`, above `maxBodyBytes`  | Reject, and stop the read at the limit |
| More non-empty files than `maxFiles`                               | Reject                                 |
| A file larger than `maxFileBytes`                                  | Reject                                 |
| Limits that the caller sets                                        | The parser uses the caller's limits    |

The default limits are:

| Limit            | Default | Reason                                                               |
| ---------------- | ------- | -------------------------------------------------------------------- |
| `maxFields`      | 10000   | Large forms fit. The `qs` default is 1000.                           |
| `maxDepth`       | 32      | Real form paths are short. The `qs` default is 5.                    |
| `maxArrayLength` | 10000   | A sparse array of this length costs little memory.                   |
| `maxArraySlots`  | 100000  | Forms with nested arrays fit. 100000 schema issues cost about 80 ms. |
| `maxBodyBytes`   | 10 MiB  | Form posts with small uploads fit. Raise it for large uploads.       |
| `maxFiles`       | 100     | Multi-file inputs fit.                                               |
| `maxFileBytes`   | 10 MiB  | The same as the body limit. Lower it to limit one file.              |

You pass other limits with the `limits` option of `readRequestBody`,
`formDataToObject`, and `parseSubmission`. The Zod `parseSubmission` does not
read the body, so `maxBodyBytes` applies only in `readRequestBody` and the
Effect `parseSubmission`.

`request.formData()` parses a multipart body in full before the library can
count the files. The body limit bounds this cost. A limit on parts while the
body streams needs a multipart parser, and the library does not include one.

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
| `user.role=user&user.role=admin`                      | One field with two values, not an overwrite  |
| `items.0=user&items[0]=admin`                         | One field with two values, not an overwrite  |
| A path under a field that was sent twice (`role.0=x`) | Reject                                       |
| `POST /?role=admin` with a body                       | The query string is not read                 |
| `GET /?name=a`                                        | Only the query string is read                |
| JSON sent as `text/plain`                             | Not read as JSON                             |

### Input format parity

A FormData body and a JSON body with the same data must not give different
results. `JSON.parse` keeps the last value of a duplicate key with no signal,
and it keeps a lone surrogate that FormData changes to U+FFFD.

| Path                                                       | Required behavior                    |
| ---------------------------------------------------------- | ------------------------------------ |
| JSON `{"role":"user","role":"admin"}` at any depth         | Reject (`duplicate-key`)             |
| JSON `{"role":"user","r\u006fle":"admin"}`                 | Reject. Keys compare after decoding  |
| The same key in two different objects                      | Accept                               |
| A JSON key or string with a lone surrogate (`\ud800`)      | Reject (`malformed-string`)          |
| A FormData key or value with the bytes of a lone surrogate | Decoded to U+FFFD, never a surrogate |
| A JSON number that overflows to `Infinity` (`1e400`)       | Reject (`non-finite-number`)         |

`readRequestBody` does the duplicate-key check, because it reads the JSON text.
A payload that the application parsed with `request.json()` has already lost
the duplicate.

### Type coercion

Coercion converts only strict forms. Any other string stays a string, and the
schema reports a type error.

| Path                                                             | Required behavior                         |
| ---------------------------------------------------------------- | ----------------------------------------- |
| Number `0x10`, `0b101`, `0o7`, `" 5"`, `Infinity`, `1e400`       | Kept as a string                          |
| Number `5`, `-0.5`, `.5`, `1e3`                                  | Coerced                                   |
| A 100000-character number string                                 | Checked in less than 1 second             |
| Bigint `0x10`, `1.5`, `1e3`, or more than 4300 digits            | Kept as a string                          |
| A 1000000-digit bigint string                                    | Checked in less than 1 second             |
| Date `1`, `0`, `Tue Mar 5`, `2024-02-30`, `2024-01-05T24:00:00Z` | Kept as a string                          |
| Date `2024-01-05T10:00` (`datetime-local`, no time zone)         | Kept as a string                          |
| Date `2024-02-29`, `2024-01-05T10:00:00+05:30`                   | Coerced to one instant in every time zone |

### Serialization

| Path                                                           | Required behavior                        |
| -------------------------------------------------------------- | ---------------------------------------- |
| `objectToFormData` with a key that contains `.`, `[`, or `]`   | `TypeError`                              |
| `objectToFormData` with an empty key                           | `TypeError`                              |
| Client state through `objectToFormData` and back to the server | The server value equals the client state |

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
3. Read the request with `readRequestBody`, or use the Effect
   `parseSubmission`. If you call `request.formData()` or `request.json()`
   yourself, the body has no size limit, and a duplicate JSON key is lost with
   no error. You can also set a body size limit in your server or adapter.
4. Do not use `File.name` as a file path (CWE-22, RFC 7578 §4.2). The client
   chooses the name, for example `../../etc/passwd`. Generate your own storage
   name. Check the type of a file from its content, not from `File.type` or the
   name (WSTG-BUSL-08, WSTG-BUSL-09).
5. Keep React Router at 8.3.0 or later, or 7.18.2 or later on version 7. Those
   versions fix CSRF in action processing (CVE-2026-22030). A cross-site page
   can post a form with no CORS preflight, because form content types are
   CORS-safelisted (WSTG-SESS-05). If you call the Effect `parseSubmission`
   outside React Router, add your own CSRF protection, for example an
   `Origin` header check or a CSRF token.
6. You can start Node.js with `--disable-proto=delete` as an extra layer.
