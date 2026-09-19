# Security

This package parses untrusted input from the network, so it has a high security surface. The security test suite is in `test/security`. Read `test/security/README.md` and `SECURITY.md` before you change parsing, coercion, serialization, or limits.

## Validate every change against the security suite

- Run `vp run test:security` after each change to code in `src`. Also run `vp test`.
- Make sure that every security test passes before you finish. Do not delete, skip, or weaken a security test to make a change pass.
- If a security test fails, treat the failure as a possible vulnerability. Fix the code, not the test.
- If a change must alter a required behavior, update the matching row in `SECURITY.md` and explain the reason in your summary.

## Add security tests for new features and API changes

- If you add a feature or change the public API, add security tests in the same change. This includes new exports, options, limits, content types, and error reasons.
- Cover the known attack vectors that apply. These include prototype pollution, duplicate keys and parameters, resource exhaustion, malformed input, and unsafe coercion.
- Follow the rules in `test/security/README.md`. Send each attack through the public entry points with `consumers`, and add a row to the required behavior tables in `SECURITY.md`.

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->
