# Test suite

Two Vitest projects, configured in `vite.config.ts` under `test.projects`:

| Project   | Files                    | Environment                      | What it covers                                                                     |
| --------- | ------------------------ | -------------------------------- | ---------------------------------------------------------------------------------- |
| `unit`    | `src/**/*.test.{ts,tsx}` | Node                             | The framework-agnostic helpers: coercion, FormData round-trips, `parseSubmission`. |
| `browser` | `test/**/*.spec.tsx`     | Chromium (Playwright via Vitest) | The React + React Router behavior of `useAppForm` / `AppForm`, end-to-end.         |

## Running

```bash
vp test run               # both projects
vp test run --project unit
vp test run --project browser
vp test watch             # watch mode

# one-time local setup for the browser project:
vp exec playwright install chromium   # or: pnpm test:browser:install
```

## How the browser tests work

The browser specs use React Router's `createRoutesStub` (see `app/render-route.tsx`)
to mount a **real** React Router runtime — real `Form` / `useSubmit` / `useFetcher` /
`useNavigation` / `useActionData` plus a real `action` round-trip. This is
deliberately stronger than mocking `react-router`: the full
**submit → action → `parseSubmission` → `serverResult` → merged client state**
flow runs in a real browser, which is the behavior this library exists to provide.

`app/` holds the test "app", modeled on how a consumer (lazybooks) wires the library:

- `contexts.ts` — the shared field/form contexts (`createFormHookContexts`).
- `components.tsx` — minimal, dependency-free field/form components that read
  field context (`Input`, `Checkbox`, `Errors`, `SubmitButton`, …), mirroring a
  real consumer's component set.
- `zod-form.ts` / `effect-form.ts` — the `createAppFormHook` setup for each variant,
  bound to the components above.
- `render-route.tsx` — the `createRoutesStub` + `vitest-browser-react` harness.

Nothing under `test/` is published (the package `files` field ships only `dist`
and `src`).
