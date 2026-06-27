# @justinwaite/tanstack-form-utils

## 0.3.0

### Minor Changes

- [#12](https://github.com/justinwaite/tanstack-form-utils/pull/12) [`a3e8c0a`](https://github.com/justinwaite/tanstack-form-utils/commit/a3e8c0aeb998797ff33181a8f3ade1537664a950) Thanks [@justinwaite](https://github.com/justinwaite)! - Support Effect `4.0.0-beta.90` and raise the minimum `effect` peer dependency to `>=4.0.0-beta.90`. The `schema` accepted by the Effect `useAppForm` and `parseSubmission` is now typed as `Schema.Codec` (`Schema.Decoder` was removed upstream); any existing `Schema.Struct`-based schema continues to work unchanged.

## 0.2.0

### Minor Changes

- [#7](https://github.com/justinwaite/tanstack-form-utils/pull/7) [`60e01da`](https://github.com/justinwaite/tanstack-form-utils/commit/60e01dab37f20ca9d33fc3c7194f67bdc0ae2f60) Thanks [@justinwaite](https://github.com/justinwaite)! - Breaking: update the properties of FormValidationError. Removes the type generic and sets reply to SubmissionResponse

## 0.1.1

### Patch Changes

- [#4](https://github.com/justinwaite/tanstack-form-utils/pull/4) [`c86c92c`](https://github.com/justinwaite/tanstack-form-utils/commit/c86c92cbd67f4941721be665917856cd2217f657) Thanks [@justinwaite](https://github.com/justinwaite)! - Add missing exports from `createAppFormHook`, such as `withFieldGroup`
