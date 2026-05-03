"use client";

import { useActionState, useState } from "react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { FieldError } from "@/components/ui/field-error";
import { forgotPasswordAction, type AuthState } from "@/actions/auth";
import {
  forgotPasswordSchema,
  type ForgotPasswordFieldErrors,
} from "@/lib/validations/auth";

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    forgotPasswordAction,
    null
  );

  const [clientErrors, setClientErrors] = useState<ForgotPasswordFieldErrors>({});

  const serverFieldErrors =
    (state?.fieldErrors as ForgotPasswordFieldErrors | undefined) ?? {};
  const errors: ForgotPasswordFieldErrors = {
    ...serverFieldErrors,
    ...clientErrors,
  };

  function clearError(field: keyof ForgotPasswordFieldErrors) {
    if (clientErrors[field]) {
      setClientErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const formData = new FormData(event.currentTarget);
    const result = forgotPasswordSchema.safeParse({
      email: formData.get("email"),
    });

    if (!result.success) {
      event.preventDefault();
      const flat: ForgotPasswordFieldErrors = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0];
        if (typeof key === "string" && !(key in flat)) {
          (flat as Record<string, string>)[key] = issue.message;
        }
      }
      setClientErrors(flat);
      return;
    }

    setClientErrors({});
  }

  return (
    <form
      action={formAction}
      onSubmit={handleSubmit}
      className="space-y-5"
      noValidate
    >
      <div className="space-y-2">
        <Label htmlFor="email">Correo electrónico</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="tu@empresa.com"
          autoFocus
          aria-describedby={errors.email ? "email-error" : undefined}
          invalid={Boolean(errors.email)}
          onChange={() => clearError("email")}
        />
        <FieldError fieldId="email" message={errors.email} />
      </div>

      {state?.notice ? (
        <Alert tone="success">{state.notice}</Alert>
      ) : null}

      {state?.error && !state.fieldErrors ? (
        <Alert tone="error">{state.error}</Alert>
      ) : null}

      <Button type="submit" size="xl" loading={pending} className="w-full">
        {pending ? "Enviando" : "Enviar enlace de recuperación"}
      </Button>
    </form>
  );
}
