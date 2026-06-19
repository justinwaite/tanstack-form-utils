/**
 * The field/form contexts shared by the test app's components and form hooks.
 *
 * A consumer creates these once with `createFormHookContexts()` and uses the
 * matching `useFieldContext` / `useFormContext` inside their components so they
 * read the right context. Both the Zod and Effect form hooks in this test app
 * are bound to these same contexts, so one component set works with both.
 */
import { createFormHookContexts } from "@tanstack/react-form";

export const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts();
