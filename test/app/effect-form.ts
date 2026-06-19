/**
 * The Effect-Schema-backed `useAppForm` for the test app. Identical wiring to
 * the Zod variant (same components, same contexts) — only the import path and
 * the schema type differ, which is the whole point of the dual-variant design.
 */
import { createAppFormHook } from "../../src/effect/index.ts";

import {
  Checkbox,
  Errors,
  Field,
  FormErrors,
  Hidden,
  Input,
  Label,
  NumberInput,
  SubmitButton,
  Textarea,
} from "./components.tsx";
import { fieldContext, formContext } from "./contexts.ts";

export const { useAppForm: useAppEffectForm, withForm: withEffectForm } = createAppFormHook({
  fieldContext,
  formContext,
  fieldComponents: { Field, Label, Input, NumberInput, Textarea, Checkbox, Hidden, Errors },
  formComponents: { SubmitButton, FormErrors },
});

export { AppForm } from "../../src/index.ts";
