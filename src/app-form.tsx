import type { ComponentPropsWithoutRef } from "react";

import {
  Form,
  type FetcherWithComponents,
  type FormEncType,
  type HTMLFormMethod,
} from "react-router";

export type FormSubmitMeta = {
  event?: React.FormEvent<HTMLFormElement>;
  target: HTMLFormElement | null;
  action?: string;
  method?: HTMLFormMethod;
  encType?: FormEncType;
};

type AppFormProps = Omit<ComponentPropsWithoutRef<typeof Form>, "onSubmit"> & {
  form: {
    AppForm: React.ComponentType<React.PropsWithChildren>;
    handleSubmit: (meta: FormSubmitMeta) => void;
    fetcher?: FetcherWithComponents<unknown>;
    id?: string;
    setFieldValue(fieldName: unknown, value: unknown): void;
  };
  ref?: React.Ref<HTMLFormElement>;
};

export function AppForm({ form, children, ...props }: AppFormProps) {
  const FormComponent = form.fetcher ? form.fetcher.Form : Form;
  return (
    <FormComponent
      {...props}
      onSubmit={(e) => {
        e.preventDefault();
        // capture intent from submitter button and set it in form state so it can be included in the validation step.
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        if (submitter?.name === "intent" && submitter?.value) {
          form.setFieldValue("intent", submitter.value);
        }
        form.handleSubmit({ event: e, target: e.currentTarget });
      }}
      id={form.id}
    >
      <form.AppForm>{children}</form.AppForm>
    </FormComponent>
  );
}
