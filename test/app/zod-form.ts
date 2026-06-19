/**
 * The Zod-backed `useAppForm` for the test app — exactly the setup a consumer
 * writes: bind the library's `createAppFormHook` to your own field/form
 * components and the shared contexts.
 */
import { createAppFormHook } from "../../src/zod/index.ts";

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

export const { useAppForm, withForm } = createAppFormHook({
  fieldContext,
  formContext,
  fieldComponents: { Field, Label, Input, NumberInput, Textarea, Checkbox, Hidden, Errors },
  formComponents: { SubmitButton, FormErrors },
});

export { AppForm } from "../../src/index.ts";
