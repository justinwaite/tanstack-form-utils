import { Effect, Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { FormValidationError, parseSubmission } from "./server-validation.ts";

const SignupSchema = Schema.Struct({
  name: Schema.String,
  age: Schema.Number,
});

/** Runs the `parseSubmission` Effect and unwraps the success value. */
async function runSubmission(payload: Request | FormData | URLSearchParams | Schema.Json) {
  return Effect.runPromise(
    parseSubmission(payload, { schema: SignupSchema }).pipe(Effect.map(({ value }) => value)),
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

  it("parses a GET request's query string as URLSearchParams", async () => {
    const request = new Request("https://example.com/search?name=Jane&age=30", {
      method: "GET",
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

describe("parseSubmission with a non-Request payload", () => {
  it("parses a FormData instance directly", async () => {
    const fd = new FormData();
    fd.append("name", "Jane");
    fd.append("age", "30");

    const value = await runSubmission(fd);

    expect(value).toEqual({ name: "Jane", age: 30 });
  });

  it("parses a URLSearchParams instance directly", async () => {
    const params = new URLSearchParams({ name: "Jane", age: "30" });

    const value = await runSubmission(params);

    expect(value).toEqual({ name: "Jane", age: 30 });
  });

  it("parses an already-parsed JSON payload without form-data coercion", async () => {
    const value = await runSubmission({ name: "Jane", age: 30 });

    expect(value).toEqual({ name: "Jane", age: 30 });
  });

  it("fails schema validation for an already-parsed payload that doesn't match the schema", async () => {
    await expect(runSubmission({ foo: "foo", bar: 30 })).rejects.toThrow(FormValidationError);
  });

  it("accepts a non-object JSON payload (array/string/number/boolean/null), failing schema validation at runtime", async () => {
    await expect(runSubmission(["Jane", 30])).rejects.toThrow(FormValidationError);
    await expect(runSubmission("Jane")).rejects.toThrow(FormValidationError);
    await expect(runSubmission(30)).rejects.toThrow(FormValidationError);
    await expect(runSubmission(true)).rejects.toThrow(FormValidationError);
    await expect(runSubmission(null)).rejects.toThrow(FormValidationError);
  });

  it("surfaces a colliding FormData key path as InvalidBodyError instead of throwing", async () => {
    const fd = new FormData();
    fd.append("name", "Jane");
    fd.append("name.first", "Jo");

    const result = await Effect.runPromise(
      parseSubmission(fd, { schema: SignupSchema }).pipe(
        Effect.map(() => "success" as const),
        Effect.catchTag("InvalidBodyError", () => Effect.succeed("invalid-body-error" as const)),
      ),
    );

    expect(result).toBe("invalid-body-error");
  });
});
