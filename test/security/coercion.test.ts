/**
 * Strict type coercion (CWE-1286, CAPEC-267, ASVS V15.3.5, RFC 3339,
 * RFC 7493 §2.2). SECURITY.md, "Type coercion". Findings F-17 and F-18 in
 * audits/2026-09-18-form-parsing/REPORT.md.
 *
 * A string that is not in the strict form stays a string, so the schema reports
 * a type error. Another component that reads the raw string then sees the same
 * value that the schema saw.
 */
import { afterEach, describe, expect, it } from "vite-plus/test";
import z from "zod";

import {
  consumers,
  env,
  json,
  reasonOf,
  schemas,
  timed,
  urlencoded,
  zodConsumer,
} from "./harness.ts";
import { installPrototypeGuard } from "./prototype-guard.ts";

installPrototypeGuard();

function form(key: string, value: string): Request {
  const params = new URLSearchParams();
  params.append(key, value);
  return urlencoded(params);
}

describe.each(consumers)("$name consumer", (consumer) => {
  describe("numbers (F-17)", () => {
    it.each([
      "0x10",
      "0b101",
      "0o7",
      " 5",
      "5 ",
      "\t5",
      "\n5",
      "Infinity",
      "-Infinity",
      "NaN",
      "1e400",
      "-1e400",
      "1_000",
      "5px",
      "--5",
      "1e",
      ".",
      "+",
    ])("does not coerce %j", async (value) => {
      expect((await consumer.submit(form("qty", value), schemas.qty)).tag).toBe("invalid");
    });

    it.each([
      ["5", 5],
      ["-5", -5],
      ["+5", 5],
      ["5.", 5],
      ["0.5", 0.5],
      [".5", 0.5],
      ["1e3", 1000],
      ["1E-3", 0.001],
      ["1.5e+2", 150],
    ])("coerces the decimal string %j", async (value, expected) => {
      expect(await consumer.submit(form("qty", value), schemas.qty)).toEqual({
        tag: "accepted",
        value: { qty: expected },
      });
    });

    it("checks a 100000-digit string in less than 50 ms (no regular expression backtracking)", async () => {
      const value = "1".repeat(50_000) + "." + "1".repeat(50_000) + "x";
      const [outcome, ms] = await timed(() => consumer.submit(form("qty", value), schemas.qty));
      expect(outcome.tag).toBe("invalid");
      expect(ms).toBeLessThan(50);
    });

    it.each(["1e400", "-1e400", "[1e400]"])(
      "rejects the JSON number %s, which overflows to Infinity",
      async (literal) => {
        const outcome = await consumer.submit(json(`{"qty":${literal}}`), schemas.any);
        expect(reasonOf(outcome)).toBe("non-finite-number");
      },
    );
  });

  describe("bigints (F-17)", () => {
    it.each(["0x10", "0b1", "0o7", " 5", "5 ", "1.5", "1e3", "-", "9".repeat(4301)])(
      "does not coerce %j",
      async (value) => {
        expect((await consumer.submit(form("n", value), schemas.bigint)).tag).toBe("invalid");
      },
    );

    it.each([
      ["123", 123n],
      ["-5", -5n],
      ["+5", 5n],
      ["9".repeat(4300), BigInt("9".repeat(4300))],
    ])("coerces the decimal string %j", async (value, expected) => {
      expect(await consumer.submit(form("n", value), schemas.bigint)).toEqual({
        tag: "accepted",
        value: { n: expected },
      });
    });

    it("rejects a 1000000-digit string in less than 50 ms", async () => {
      const [outcome, ms] = await timed(() =>
        consumer.submit(form("n", "9".repeat(1_000_000)), schemas.bigint),
      );
      expect(outcome.tag).toBe("invalid");
      expect(ms).toBeLessThan(50);
    });
  });
});

// The Effect entry point does not coerce dates: an Effect schema uses
// `Schema.DateFromString`, which parses the string itself.
describe("zod consumer: dates (F-18)", () => {
  const dateSchema = { zod: z.object({ d: z.date() }), effect: schemas.any.effect };
  const originalTz = env.TZ;

  afterEach(() => {
    if (originalTz === undefined) delete env.TZ;
    else env.TZ = originalTz;
  });

  it.each([
    "1",
    "0",
    "Tue Mar 5",
    "Tue Mar 05 2024 00:00:00 GMT-0600",
    "2024-02-30",
    "2023-02-29",
    "2024-13-01",
    "2024-00-10",
    "2024-01-00",
    "2024-1-5",
    "+002024-01-05",
    "2024-01-05T10:00",
    "2024-01-05T10:00:00",
    "2024-01-05T10:00:00.000",
    "2024-01-05T24:00:00Z",
    "2024-01-05T10:60:00Z",
    "2024-01-05T10:00:60Z",
    "2024-01-05T10:00:00+24:00",
    "2024-01-05 10:00:00Z",
    " 2024-01-05",
  ])("does not coerce %j", async (value) => {
    expect((await zodConsumer.submit(form("d", value), dateSchema)).tag).toBe("invalid");
  });

  it.each([
    ["2024-02-29", Date.UTC(2024, 1, 29)],
    ["2024-01-05T10:00:00Z", Date.UTC(2024, 0, 5, 10)],
    ["2024-01-05T10:00:00.123Z", Date.UTC(2024, 0, 5, 10, 0, 0, 123)],
    ["2024-01-05T10:00:00.123+05:30", Date.UTC(2024, 0, 5, 4, 30, 0, 123)],
    ["2024-01-05T10:00:00-08:00", Date.UTC(2024, 0, 5, 18)],
  ])("coerces %j to one instant", async (value, instant) => {
    const outcome = await zodConsumer.submit(form("d", value), dateSchema);
    if (outcome.tag !== "accepted") throw new Error(`expected accepted, got ${outcome.tag}`);
    expect((outcome.value as { d: Date }).d.getTime()).toBe(instant);
  });

  it("gives the same instant in every server time zone", async () => {
    const byZone: number[][] = [];
    for (const tz of ["UTC", "America/Chicago", "Pacific/Kiritimati"]) {
      env.TZ = tz;
      const instants: number[] = [];
      for (const value of ["2024-02-29", "2024-01-05T10:00:00+05:30"]) {
        const outcome = await zodConsumer.submit(form("d", value), dateSchema);
        if (outcome.tag !== "accepted") throw new Error(`expected accepted, got ${outcome.tag}`);
        instants.push((outcome.value as { d: Date }).d.getTime());
      }
      byZone.push(instants);
    }
    expect(byZone).toEqual([byZone[0], byZone[0], byZone[0]]);
    expect(byZone[0]).toEqual([Date.UTC(2024, 1, 29), Date.UTC(2024, 0, 5, 4, 30)]);
  });
});
