---
"@justinwaite/tanstack-form-utils": minor
---

Fix: in both entry points, a field that fails several checks now reports the message of its first failed check. Before, the Zod `reply()` kept the last message. For example, an empty email field showed "Enter a valid email" instead of "Required".

The Effect `parseSubmission` now reports an error for every invalid field, as the client does. Before, it stopped at the first invalid field. Effect 4 ignores a `parseOptions` annotation on a schema, so an app had no way to turn this on.

Security: the Effect `parseSubmission` now decodes with options that have no prototype. Before, a polluted `Object.prototype.disableChecks` turned off every schema check, because the default options of Effect are a plain object.

A validation error can now be large. A 179 B body with sparse arrays can produce about 90000 field errors. `maxFields` and `maxArraySlots` set the upper bound. See SECURITY.md.
