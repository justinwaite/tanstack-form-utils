import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
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
