import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  test: {
    projects: [
      {
        // Fast Node unit tests for the framework-agnostic helpers
        // (coercion, FormData round-trips, parseSubmission).
        test: {
          name: "unit",
          include: ["src/**/*.test.{ts,tsx}"],
          environment: "node",
        },
      },
      {
        // Real-browser tests of the React + React Router behavior, run through
        // Playwright-driven Chromium. `*.spec.tsx` keeps them distinct from the
        // Node unit tests above.
        plugins: [react()],
        // Pre-bundle these up front so Vitest doesn't discover them mid-run and
        // force a reload (which logs a flakiness warning and re-runs tests).
        optimizeDeps: {
          include: [
            "react",
            "react-dom",
            "react-dom/client",
            "react/jsx-dev-runtime",
            "@tanstack/react-form",
            "react-router",
            "effect",
            "effect/unstable/http",
          ],
        },
        test: {
          name: "browser",
          include: ["test/**/*.spec.tsx"],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
  pack: {
    // One entry per public subpath. `exports: true` regenerates the
    // package.json `exports` map from these, so all three must be listed or the
    // `./effect` and `./zod` subpaths get dropped.
    entry: ["src/index.ts", "src/effect/index.ts", "src/zod/index.ts"],
    dts: {
      tsgo: true,
    },
    exports: true,
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
