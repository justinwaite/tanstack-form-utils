# Open-Source Supply-Chain Security Checklist

A maintainer checklist for `@justinwaite/tanstack-form-utils`. The goal is to
avoid the now-common ways a small, well-meaning npm package becomes an attack
vector — compromised publish tokens, malicious dependency updates, leaked files
in the tarball, and CI that runs untrusted code with secrets.

Items marked ✅ are already wired up in this repo; the rest are account- or
org-level actions only a human can take.

## Publishing & npm account

- [ ] **2FA on the npm account** (authenticator/passkey), with recovery codes
      stored offline. Account takeover is the #1 way packages get hijacked.
- [ ] ✅ **CI publishes via OIDC Trusted Publishing — no long-lived token.**
      `release.yml` has `id-token: write` and no `NPM_TOKEN`; npm verifies the
      GitHub OIDC claim instead. A leaked CI secret can't publish because there
      is no publish secret to leak. Provenance is attached automatically.
- [ ] **Configure the trusted publisher on npm** (one-time, _after_ the first
      publish — see "First publish" below): npm package → Settings → Trusted
      Publishing → add GitHub Actions, repo `justinwaite/tanstack-form-utils`,
      workflow `release.yml`. Restrict to the `main` branch if offered.
- [ ] ✅ **`access: public`** is set intentionally in both `package.json`
      (`publishConfig`) and `.changeset/config.json` — a scoped package defaults
      to private/restricted.

### First publish (bootstrapping trusted publishing)

A trusted publisher can only be configured on a package that already exists, so
the very first release can't use OIDC:

1. Publish `0.0.x` once **locally** (`pnpm publish`) from a trusted device with
   2FA — this creates the package on npm.
2. Add the trusted publisher (above) pointing at this repo + `release.yml`.
3. From then on, every release publishes token-free from CI. No `NPM_TOKEN`
   secret is ever stored in GitHub.

## What ships in the tarball

- [ ] ✅ **`files` allowlist** in `package.json` ships only `dist` + `src` and
      **excludes tests** (`!src/**/*.test.ts(x)`). An allowlist beats
      `.npmignore` because new files are excluded by default.
- [ ] **Verify the tarball before every release**: `pnpm pack --dry-run` (or
      `npm pack --dry-run`). Confirm no `.env`, `.npmrc`, keys, fixtures, or
      internal files are present. Don't ship secrets.
- [ ] **No build-time secrets baked into `dist`** — this is a pure library; keep
      it that way.

## Dependencies

- [ ] ✅ **Lockfile is committed** and CI installs with
      `pnpm install --frozen-lockfile` (a drifted/tampered lockfile fails the
      build instead of silently resolving new code).
- [ ] ✅ **Dependabot** watches both npm deps and the pinned GitHub Actions
      (`.github/dependabot.yml`). Review its PRs — don't auto-merge blindly.
- [ ] **Treat dependency bumps as code review.** Read the diff/changelog for any
      new or transitive dependency, especially ones that add `postinstall`
      scripts, network access, or obfuscated code. Watch for **typosquats** and
      **maintainer-handoff** of small packages.
- [ ] **Disable lifecycle scripts for untrusted installs.** pnpm blocks build
      scripts by default; only allow-list packages you trust
      (`pnpm.onlyBuiltDependencies`). Never `--unsafe-perm`.
- [ ] **Keep the dependency surface small.** Prefer `peerDependencies` (already
      done for react, react-router, tanstack, effect, zod) over bundling — fewer
      things you ship and have to vouch for.
- [ ] **Run `pnpm audit`** (and optionally OpenSSF Scorecard / Socket) on a
      schedule; triage real issues rather than chasing every advisory.

## CI / GitHub hygiene

- [ ] ✅ **GitHub Actions pinned to full commit SHAs**, not tags. A tag like
      `@v4` can be repointed at malicious code; a SHA can't.
- [ ] ✅ **Least-privilege `GITHUB_TOKEN`.** Workflows default to
      `permissions: {}` / `contents: read` and opt into the minimum
      (`release.yml` grants write only to the publish job).
- [ ] ✅ **No untrusted code runs with secrets.** Release triggers on
      `push` to `main` only — never `pull_request_target` — so a fork PR can't
      reach the release pipeline or its OIDC identity. CI on PRs runs with
      read-only permissions and `persist-credentials: false`.
- [ ] **Branch protection on `main`**: require the CI check to pass, require PR
      review, disallow force-pushes, and (ideally) require signed commits.
- [ ] **Restrict who can publish.** Limit repo admins and npm package
      maintainers to people who actually need it; add a `CODEOWNERS` file.
- [ ] **Pin/limit third-party actions to vetted publishers.** Every `uses:` is
      code running in your release pipeline with access to its OIDC identity.

## Vulnerability response

- [ ] **Add a `SECURITY.md`** with a private reporting channel (GitHub private
      vulnerability reporting, or an email). Don't make reporters use public
      issues.
- [ ] **Enable GitHub security features**: Dependabot alerts, secret scanning,
      and push protection on the repo.
- [ ] **Have a yank/patch plan**: know how to `npm deprecate` a bad version and
      ship a fixed patch fast. Avoid `npm unpublish` (breaks consumers) unless a
      version leaks secrets.

## Release flow (how this repo cuts a version)

1. Make changes on a branch, open a PR.
2. Run `pnpm changeset` and commit the generated `.changeset/*.md` file
   describing the bump (patch/minor/major).
3. Merge to `main`. The **Release** workflow opens a "Version Packages" PR that
   bumps the version and updates the changelog.
4. Merge that PR. The workflow then runs `changeset:release`
   (`vp run build && changeset publish`) and publishes to npm with provenance.
