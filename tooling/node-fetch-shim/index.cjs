"use strict";

// node-fetch@2 stand-in that delegates to Node's native (undici) fetch.
//
// Why this exists:
//   @changesets/get-github-info (used by @changesets/changelog-github to build
//   changelog entries with PR/author links) is hardwired to node-fetch@2.
//   Node's CVE-2026-48931 fix (shipped in Node 24.17 / 22.23) changed keep-alive
//   socket handling, which makes node-fetch@2 throw ERR_STREAM_PREMATURE_CLOSE
//   ("Invalid response body ... Premature close") when reading GitHub's GraphQL
//   response. That breaks `changeset version` in CI. Node's global fetch (undici)
//   is unaffected. See https://github.com/nodejs/node/issues/63989
//
// This is wired in via a scoped pnpm override in pnpm-workspace.yaml:
//   "@changesets/get-github-info>node-fetch": "file:./tooling/node-fetch-shim"
// so it only replaces node-fetch for changesets, nothing else.
//
// get-github-info only uses the default callable export plus response.json(),
// both of which native fetch supports. The extra named exports below mirror
// node-fetch@2's shape so any other accidental consumer doesn't crash.

if (typeof globalThis.fetch !== "function") {
  throw new Error(
    "node-fetch shim requires a global fetch (Node >= 18). Current runtime has none.",
  );
}

function fetch(...args) {
  return globalThis.fetch(...args);
}

fetch.default = fetch;
fetch.Headers = globalThis.Headers;
fetch.Request = globalThis.Request;
fetch.Response = globalThis.Response;
fetch.isRedirect = (code) => [301, 302, 303, 307, 308].includes(code);

// node-fetch@2 exposes these error classes; provide minimal equivalents.
class FetchError extends Error {
  constructor(message, type) {
    super(message);
    this.name = "FetchError";
    this.type = type;
  }
}
class AbortError extends Error {
  constructor(message) {
    super(message);
    this.name = "AbortError";
    this.type = "aborted";
  }
}
fetch.FetchError = FetchError;
fetch.AbortError = AbortError;

Object.defineProperty(fetch, "__esModule", { value: true });

module.exports = fetch;
