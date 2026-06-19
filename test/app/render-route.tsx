/**
 * Renders a single-route React Router app in the browser via `createRoutesStub`
 * and `vitest-browser-react`. This gives the form utils a *real* React Router
 * runtime — real `Form` / `useSubmit` / `useFetcher` / `useNavigation` /
 * `useActionData` and a real action round-trip — instead of mocking it. That is
 * the whole point: the submit → action → `serverResult` → merged-errors flow is
 * exercised end-to-end the way it runs in production.
 */
import type { ComponentType } from "react";
import { createRoutesStub } from "react-router";
import { render } from "vitest-browser-react";

type ActionFn = (args: { request: Request }) => unknown;

/**
 * Mount `Component` as the element of the index route at `/`, wiring `action`
 * as that route's action so form submissions actually run it.
 */
export function renderRoute(Component: ComponentType, action?: ActionFn) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component,
      action: action as never,
    },
  ]);
  return render(<Stub />);
}
