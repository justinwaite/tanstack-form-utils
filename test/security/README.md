# Security test suite

This directory holds every security test of the library. It is a separate
Vitest project, `security`, so that security tests stay apart from the
functional unit tests in `src/`.

Run it with this command:

```bash
vp run test:security
```

## Black-box design

The attack surface is the code that an application calls in its `action`.
Thus each test sends the attack through the public entry points, the same way
an application does. `harness.ts` has one consumer for each entry point:

| Consumer | What it calls                                                 |
| -------- | ------------------------------------------------------------- |
| `zod`    | `parseSubmission(await readRequestBody(request), { schema })` |
| `effect` | `yield* parseSubmission(request, { schema })`                 |

A test states the required behavior once, and `describe.each(consumers)` runs
it against both. Both consumers reduce the result to one `Outcome`:
`accepted`, `invalid` (a schema error), or `rejected` with the
`FormDataParseError` reason.

A unit test is used only for code that an attacker reaches through other code:
`parsePath` in `path-parsing.test.ts`, and `mergeServerErrors` in
`client-merge.test.ts`.

## Files

| File                          | SECURITY.md section                                 |
| ----------------------------- | --------------------------------------------------- |
| `prototype-pollution.test.ts` | Prototype pollution                                 |
| `option-gadgets.test.ts`      | Option gadgets                                      |
| `resource-limits.test.ts`     | Resource exhaustion                                 |
| `path-parsing.test.ts`        | Path parsing                                        |
| `parameter-pollution.test.ts` | Mass assignment, parameter pollution, format parity |
| `coercion.test.ts`            | Type coercion                                       |
| `serialization.test.ts`       | Serialization                                       |
| `client-merge.test.ts`        | Client merge of server errors                       |
| `corpus.test.ts`              | The external test sets in `corpus/`                 |

Each file names the standards and the audit findings (F-n) that it covers. The
findings are in `audits/2026-09-18-form-parsing/REPORT.md`.

## Rules for new tests

1. Send the attack through `consumers` in `harness.ts`, not through an internal
   function.
2. Name the standard item (CWE, ASVS, WSTG, CAPEC, or RFC) in the `describe`
   or the file header.
3. Add a row to the Required behavior tables in SECURITY.md.
4. If a payload must fail fast, use `fastest` and assert `FAST_LIMIT_MS`
   (1 second). `fastest` builds the payload outside the clock. It reports the
   shortest of five runs, so a slow CI machine does not cause a false failure.
   The limit catches a complexity defect, not a small slowdown. Do not set a
   tighter limit.
5. Every file calls `installPrototypeGuard()`. It fails a test that changes
   `Object.prototype`, `Array.prototype`, or `Function.prototype`.
