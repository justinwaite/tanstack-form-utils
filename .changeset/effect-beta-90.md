---
"@justinwaite/tanstack-form-utils": minor
---

Support Effect `4.0.0-beta.90` and raise the minimum `effect` peer dependency to `>=4.0.0-beta.90`. The `schema` accepted by the Effect `useAppForm` and `parseSubmission` is now typed as `Schema.Codec` (`Schema.Decoder` was removed upstream); any existing `Schema.Struct`-based schema continues to work unchanged.
