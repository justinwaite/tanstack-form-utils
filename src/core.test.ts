/**
 * Security suite for the client-side merge of server errors (audit finding F-5 in
 * audits/2026-09-18-form-parsing/REPORT.md).
 * `fieldErrors` keys come from a server response, so they must not be able to
 * write through to a built-in prototype.
 */
import type { AnyFormApi } from "@tanstack/react-form";
import { describe, expect, it } from "vite-plus/test";

import { installPrototypeGuard } from "../test/prototype-guard.ts";

import { mergeServerErrors } from "./core.ts";
import type { SubmissionResponse } from "./server-validation.ts";

installPrototypeGuard();

function fakeForm(): AnyFormApi {
  return { state: { errorMap: {}, fieldMetaBase: {} } } as unknown as AnyFormApi;
}

function response(fieldErrors: Record<string, string>): SubmissionResponse {
  return { success: false, errorMap: { onServer: undefined }, fieldErrors };
}

describe("mergeServerErrors (CWE-1321, ASVS V15.3.6, F-5)", () => {
  it.each(["__proto__", "constructor", "prototype"])("skips a %s field error key", (key) => {
    const form = fakeForm();
    mergeServerErrors(form, response(JSON.parse(`{${JSON.stringify(key)}:"boom"}`)));
    expect(Object.hasOwn(form.state.fieldMetaBase, key)).toBe(false);
    expect(Object.getPrototypeOf(form.state.fieldMetaBase)).toBe(Object.prototype);
  });

  it("creates new metadata for an inherited name instead of mutating the prototype", () => {
    const form = fakeForm();
    mergeServerErrors(form, response({ toString: "bad" }));
    expect(Object.hasOwn(form.state.fieldMetaBase, "toString")).toBe(true);
    const meta = Object.getOwnPropertyDescriptor(form.state.fieldMetaBase, "toString")?.value;
    expect(meta?.errorMap).toEqual({
      onServer: [{ message: "bad" }],
    });
  });

  it("still merges an ordinary field error", () => {
    const form = fakeForm();
    mergeServerErrors(form, response({ name: "Required" }));
    expect(form.state.fieldMetaBase.name?.isTouched).toBe(true);
    expect(form.state.fieldMetaBase.name?.errorMap).toEqual({
      onServer: [{ message: "Required" }],
    });
  });
});
