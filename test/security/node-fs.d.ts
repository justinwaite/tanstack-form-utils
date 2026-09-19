/**
 * The two `node:fs` functions that corpus.test.ts uses to load the test data.
 * The project has no Node.js type definitions, because the library itself must
 * not depend on Node.js.
 */
declare module "node:fs" {
  export function readFileSync(path: URL): Uint8Array<ArrayBuffer>;
  export function readFileSync(path: URL, encoding: "utf8"): string;
  export function readdirSync(path: URL): string[];
}
