---
"@justinwaite/tanstack-form-utils": minor
---

Adds dynamic content-type parsing support. Will detect whether the request is json or form data and use the appropriate request body parser to validate the body against the given schema.

Consolidates the FormDataError into an InvalidBodyError that is raised when an invalid request body is provided.
