import { Effect, Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { parseSubmission } from "./server-validation.ts";

const SignupSchema = Schema.Struct({
  name: Schema.String,
  age: Schema.Number,
});

/** Runs the `parseSubmission` Effect and unwraps the success value. */
async function runSubmission(request: Request) {
  return Effect.runPromise(
    parseSubmission(request, { schema: SignupSchema }).pipe(Effect.map(({ value }) => value)),
  );
}

describe("parseSubmission content-type handling", () => {
  it("parses a multipart/form-data request", async () => {
    const fd = new FormData();
    fd.append("name", "Jane");
    fd.append("age", "30");
    const request = new Request("https://example.com", { method: "POST", body: fd });

    const value = await runSubmission(request);

    expect(value).toEqual({ name: "Jane", age: 30 });
  });

  it("parses an application/x-www-form-urlencoded request", async () => {
    const request = new Request("https://example.com", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "name=Jane&age=30",
    });

    const value = await runSubmission(request);

    expect(value).toEqual({ name: "Jane", age: 30 });
  });

  it("parses an application/json request without form-data coercion of typed values", async () => {
    const request = new Request("https://example.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Jane", age: 30 }),
    });

    const value = await runSubmission(request);

    expect(value).toEqual({ name: "Jane", age: 30 });
  });

  it("parses a +json structured-syntax content type as JSON", async () => {
    const request = new Request("https://example.com", {
      method: "POST",
      headers: { "content-type": "application/vnd.api+json; charset=utf-8" },
      body: JSON.stringify({ name: "Jane", age: 30 }),
    });

    const value = await runSubmission(request);

    expect(value).toEqual({ name: "Jane", age: 30 });
  });

  it("fails with InvalidBodyError when the JSON body is malformed", async () => {
    const request = new Request("https://example.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not valid json",
    });

    const result = await Effect.runPromise(
      parseSubmission(request, { schema: SignupSchema }).pipe(
        Effect.map(() => "success" as const),
        Effect.catchTag("InvalidBodyError", () => Effect.succeed("json-body-error" as const)),
      ),
    );

    expect(result).toBe("json-body-error");
  });
});
