/**
 * Data-driven tests from external test sets. See corpus/README.md for the
 * sources, the commits, and the expected results.
 *
 * - WPT `url/urlencoded-parser.any.js`: the WHATWG urlencoded parser rows.
 * - JSONTestSuite: the duplicate-key files and every `i_` (parser's choice) file.
 * - Bishop Fox JSON interoperability labs: key collision and number payloads.
 */
import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { readRequestBody } from "../../src/index.ts";
import { consumers, json, reasonOf, schemas, type Outcome } from "./harness.ts";
import { installPrototypeGuard } from "./prototype-guard.ts";

installPrototypeGuard();

const corpus = new URL("./corpus/", import.meta.url);

type WptRow = { input: string; output: Array<[string, string]> };
const wptRows: WptRow[] = JSON.parse(
  readFileSync(new URL("wpt-urlencoded-parser.json", corpus), "utf8"),
);

type BishopFoxRow = { technique: string; body: string; expect: "accepted" | "rejected" };
const bishopFoxRows: BishopFoxRow[] = JSON.parse(
  readFileSync(new URL("bishopfox-json-interop.json", corpus), "utf8"),
);

const jsonSuiteDir = new URL("jsontestsuite/", corpus);
const jsonSuiteFiles = readdirSync(jsonSuiteDir)
  .filter((name) => name.endsWith(".json"))
  .sort();

/** The WPT content types: the charset parameter must not change the UTF-8 decode. */
const WPT_CONTENT_TYPES = [
  "application/x-www-form-urlencoded",
  "application/x-www-form-urlencoded;charset=windows-1252",
  "application/x-www-form-urlencoded;charset=shift_jis",
];

function wptRequest(input: string, contentType: string): Request {
  return new Request("https://app.example/", {
    method: "POST",
    body: input,
    headers: { "content-type": contentType },
  });
}

/** True when every string in `value` is well formed and every number is finite. */
function isInteroperable(value: unknown): boolean {
  const stack = [value];
  while (stack.length > 0) {
    const node = stack.pop();
    if (typeof node === "string" && !node.isWellFormed()) return false;
    if (typeof node === "number" && !Number.isFinite(node)) return false;
    if (typeof node === "object" && node !== null) {
      for (const [key, child] of Object.entries(node)) {
        if (!key.isWellFormed()) return false;
        stack.push(child);
      }
    }
  }
  return true;
}

function expectAcceptedOrParserRejection(outcome: Outcome): void {
  if (outcome.tag === "rejected") {
    // Any parser reason is fine. The row must not reach the schema as a crash.
    expect(outcome.reason).toBeTypeOf("string");
  } else {
    expect(outcome.tag).toBe("accepted");
  }
}

describe("WPT urlencoded parser rows", () => {
  describe.each(WPT_CONTENT_TYPES)("%s", (contentType) => {
    it.each(wptRows)("readRequestBody returns the WPT pairs for $input", async (row) => {
      const body = await readRequestBody(wptRequest(row.input, contentType));
      expect([...(body as FormData).entries()]).toEqual(row.output);
    });

    describe.each(consumers)("$name consumer", (consumer) => {
      it.each(wptRows)("accepts or rejects $input with no crash", async (row) => {
        const outcome = await consumer.submit(
          wptRequest(row.input, contentType),
          schemas.passthrough,
        );
        expectAcceptedOrParserRejection(outcome);
        if (outcome.tag === "rejected") expect(outcome.reason).not.toBe("unreadable");
      });
    });
  });
});

describe.each(consumers)("$name consumer: JSONTestSuite", (consumer) => {
  it.each(jsonSuiteFiles.filter((name) => name.startsWith("y_object_duplicated_key")))(
    "rejects %s with duplicate-key",
    async (name) => {
      const bytes = readFileSync(new URL(name, jsonSuiteDir));
      expect(reasonOf(await consumer.submit(json(bytes), schemas.any))).toBe("duplicate-key");
    },
  );

  it.each(jsonSuiteFiles.filter((name) => name.startsWith("i_")))(
    "accepts or rejects %s, and an accepted value is interoperable",
    async (name) => {
      const bytes = readFileSync(new URL(name, jsonSuiteDir));
      const outcome = await consumer.submit(json(bytes), schemas.any);
      expectAcceptedOrParserRejection(outcome);
      if (outcome.tag === "accepted") expect(isInteroperable(outcome.value)).toBe(true);
    },
  );
});

describe.each(consumers)("$name consumer: Bishop Fox JSON interoperability", (consumer) => {
  it.each(bishopFoxRows)("$technique: $expect", async (row) => {
    const outcome = await consumer.submit(json(row.body), schemas.qty);
    if (row.expect === "rejected") {
      expect(outcome.tag).toBe("rejected");
    } else {
      expect(outcome.tag).toBe("accepted");
      expect(isInteroperable(outcome.tag === "accepted" && outcome.value)).toBe(true);
    }
  });
});
