# Security test corpus

This directory holds test data from external sources. The data-driven tests in
`test/security/corpus.test.ts` run every row. Do not edit a file by hand. If
you update a source, change the commit in the table below.

| File                          | Source                                                                                                              | Commit                                     | Content                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `wpt-urlencoded-parser.json`  | [WPT `url/urlencoded-parser.any.js`](https://github.com/web-platform-tests/wpt/blob/master/url/urlencoded-parser.any.js) | `4de146b83e2423af3c92e0d46705ebb956e4071c` | The 35 rows of the test array, as JSON. The test functions of the file are not copied.            |
| `jsontestsuite/`              | [JSONTestSuite `test_parsing/`](https://github.com/nst/JSONTestSuite/tree/master/test_parsing)                     | `1ef36fa01286573e846ac449e8683f8833c5b26a` | All `i_` files and the two `y_object_duplicated_key*` files, byte for byte.                       |
| `bishopfox-json-interop.json` | [Bishop Fox JSON interoperability labs, README](https://github.com/BishopFox/json-interop-vuln-labs)                | `5b6f23a361b3e0f65dd46167c23af4a2c73cab7d` | The payloads under "Attack Techniques", with `qty` as the key. The `expect` field is our choice. |

The WPT rows were copied by hand from the array literal, because the source
file is JavaScript and not JSON. Each row keeps its `input` and `output`.

## Expected results

| Source                                | Rule                                                                                                |
| ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| WPT                                   | `readRequestBody` returns the `output` pairs. The parse accepts or rejects the row, with no crash.  |
| JSONTestSuite `y_object_duplicated_*` | Reject with `duplicate-key`. RFC 7493 §2.3 forbids duplicate names.                                 |
| JSONTestSuite `i_`                    | Accept or reject, with no crash. An accepted value has only well-formed strings and finite numbers. |
| Bishop Fox                            | The `expect` field of each row.                                                                     |
