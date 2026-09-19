/**
 * Prototype pollution through submitted keys (CWE-1321, ASVS V15.3.6,
 * WSTG-INJT-22). SECURITY.md, "Prototype pollution". Findings F-1 and F-9 in
 * audits/2026-09-18-form-parsing/REPORT.md.
 *
 * Payload shapes come from the advisories that SECURITY.md lists (qs, lodash,
 * dot-prop, set-value, object-path, dset) and from the PortSwigger server-side
 * prototype pollution research.
 */
import { describe, expect, it } from "vite-plus/test";

import {
  consumers,
  fields,
  get,
  json,
  multipart,
  reasonOf,
  schemas,
  urlencoded,
} from "./harness.ts";
import { installPrototypeGuard } from "./prototype-guard.ts";

installPrototypeGuard();

const DANGEROUS_KEYS = [
  // qs CVE-2017-1000048 / CVE-2022-24999
  "__proto__[polluted]",
  "[__proto__][polluted]",
  "[__proto__].polluted",
  // dot-prop CVE-2020-8116, dset CVE-2020-28277
  "__proto__.polluted",
  "__proto__.__proto__.polluted",
  "a.__proto__.polluted",
  "a.b.__proto__.polluted",
  // Array elements (lodash zipObjectDeep CVE-2020-8203)
  "items.0.__proto__.polluted",
  "items[0][__proto__][polluted]",
  "items[0].__proto__.polluted",
  // constructor.prototype (lodash CVE-2019-10744, set-value CVE-2021-23440)
  "constructor.prototype.polluted",
  "constructor[prototype][polluted]",
  "a.constructor.prototype.polluted",
  "items.0.constructor.prototype.polluted",
  "a.constructor.constructor",
  "a.prototype",
  // Flat dangerous keys
  "__proto__",
  "constructor",
  "prototype",
  // Numeric child under a dangerous key (would create an array there)
  "__proto__.0",
  "__proto__[0]",
  // Bracket noise that normalizes to a dangerous key (object-path
  // CVE-2020-15256 class: the check must run on the normalized segment,
  // ASVS V1.1.1)
  "__pro]to__.polluted",
  "__proto__]].polluted",
  "]__proto__.polluted",
  "..__proto__..polluted",
  ".__proto__.polluted",
  "[[__proto__]].polluted",
  // Empty-array sentinel on a dangerous key
  "__proto__[]",
  "a.__proto__[]",
  "constructor.prototype[]",
];

const DANGEROUS_JSON = [
  '{"name":"a","__proto__":{"polluted":true}}',
  '{"name":"a","x":[{"__proto__":{"polluted":true}}]}',
  '{"name":"a","x":{"constructor":{"prototype":{"polluted":true}}}}',
  // PortSwigger detection shape: a second-level prototype hop
  '{"name":"a","__proto__":{"__proto__":{"polluted":true}}}',
];

describe.each(consumers)("$name consumer", (consumer) => {
  describe("dangerous FormData keys are rejected (F-1)", () => {
    for (const key of DANGEROUS_KEYS) {
      it(`rejects ${JSON.stringify(key)} in a urlencoded body`, async () => {
        const outcome = await consumer.submit(urlencoded(fields("name", key)), schemas.user);
        expect(reasonOf(outcome)).toBe("unsafe-key");
      });
    }

    it("rejects a dangerous key in a multipart body with a File value", async () => {
      const fd = new FormData();
      fd.append("name", "a");
      fd.append("__proto__.polluted", new File(["x"], "x.txt"));
      expect(reasonOf(await consumer.submit(multipart(fd), schemas.user))).toBe("unsafe-key");
    });

    it("rejects a dangerous key that follows valid keys", async () => {
      const body = "name=Jane&items.0=a&items.__proto__.polluted=1";
      expect(reasonOf(await consumer.submit(urlencoded(body), schemas.user))).toBe("unsafe-key");
    });

    it("rejects a repeated dangerous flat key", async () => {
      const body = "__proto__=a&__proto__=b";
      expect(reasonOf(await consumer.submit(urlencoded(body), schemas.user))).toBe("unsafe-key");
    });

    it("rejects a dangerous key in a GET query string", async () => {
      const outcome = await consumer.submit(get("__proto__.polluted=yes&name=a"), schemas.user);
      expect(reasonOf(outcome)).toBe("unsafe-key");
    });

    it("rejects a percent-encoded dangerous key after the one URL decode", async () => {
      for (const body of ["%5F%5Fproto%5F%5F.polluted=1", "__proto__%5Bpolluted%5D=1"]) {
        expect(reasonOf(await consumer.submit(urlencoded(body), schemas.user))).toBe("unsafe-key");
      }
    });

    it("rejects a dangerous key in a FormData object passed directly", async () => {
      const outcome = await consumer.submit(fields("__proto__.polluted"), schemas.user);
      expect(reasonOf(outcome)).toBe("unsafe-key");
    });
  });

  describe("look-alike keys stay literal (ASVS V1.1.1)", () => {
    it("does not decode a second time: a double-encoded key stays literal", async () => {
      const outcome = await consumer.submit(
        urlencoded("%255F%255Fproto%255F%255F.x=1"),
        schemas.passthrough,
      );
      expect(outcome).toEqual({ tag: "accepted", value: { "%5F%5Fproto%5F%5F": { x: "1" } } });
    });

    it.each([
      ["__PROTO__.x", "__PROTO__"],
      ["＿＿proto＿＿.x", "＿＿proto＿＿"],
      ["__proto__ .x", "__proto__ "],
      ["Constructor.x", "Constructor"],
      ["_proto_.x", "_proto_"],
    ])("treats %j as an ordinary key", async (key, literal) => {
      const outcome = await consumer.submit(urlencoded(fields(key)), schemas.passthrough);
      if (outcome.tag !== "accepted") throw new Error(`expected accepted, got ${outcome.tag}`);
      expect(Object.keys(outcome.value as object)).toEqual([literal]);
      expect(Object.getPrototypeOf(outcome.value)).toBe(Object.prototype);
    });
  });

  describe("JSON payloads get the same key rules (ASVS V1.5.3, F-9)", () => {
    for (const body of DANGEROUS_JSON) {
      it(`rejects ${body} in a JSON body`, async () => {
        expect(reasonOf(await consumer.submit(json(body), schemas.user))).toBe("unsafe-key");
      });

      it(`rejects ${body} as an already-parsed payload`, async () => {
        const outcome = await consumer.submit(JSON.parse(body), schemas.user);
        expect(reasonOf(outcome)).toBe("unsafe-key");
      });
    }

    it("rejects a dangerous key in a +json media type", async () => {
      const request = json(DANGEROUS_JSON[0]!, "application/vnd.api+json");
      expect(reasonOf(await consumer.submit(request, schemas.user))).toBe("unsafe-key");
    });

    it("does not descend into non-plain values (Date, File, class instances)", async () => {
      class Model {
        constructor() {
          Object.defineProperty(this, "constructor", { value: "own", enumerable: true });
        }
      }
      const payload = { name: "a", when: new Date(0), file: new File(["x"], "x"), m: new Model() };
      expect((await consumer.submit(payload, schemas.user)).tag).toBe("accepted");
    });

    it("accepts an ordinary JSON body", async () => {
      expect(await consumer.submit(json('{"name":"a"}'), schemas.user)).toEqual({
        tag: "accepted",
        value: { name: "a" },
      });
    });
  });
});
