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
import { useScrollOnMessage } from "@/lib/hooks/use-scroll-on-error";

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    forgotPasswordAction,
    null
  );

  const [clientErrors, setClientErrors] = useState<ForgotPasswordFieldErrors>({});
  const messageForScroll = state?.notice ?? (!state?.fieldErrors ? state?.error : null);
  const alertRef = useScrollOnMessage<HTMLDivElement>(messageForScroll);

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
    <form action={formAction} onSubmit={handleSubmit} noValidate>
      <fieldset
        disabled={pending}
        className="m-0 min-w-0 space-y-6 border-0 p-0 disabled:opacity-95"
      >
        <div className="space-y-2">
          <Label htmlFor="email" required>
            Correo electrónico
          </Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            mono
            placeholder="tu@empresa.com"
            autoFocus
            aria-describedby={errors.email ? "email-error" : "email-hint"}
            invalid={Boolean(errors.email)}
            onChange={() => clearError("email")}
          />
          {errors.email ? (
            <FieldError fieldId="email" message={errors.email} />
          ) : (
            <p id="email-hint" className="field-hint">
              Te enviaremos un enlace seguro válido por 1 hora
            </p>
          )}
        </div>

        {state?.notice ? (
          <div ref={alertRef} tabIndex={-1} className="outline-none">
            <Alert tone="success">{state.notice}</Alert>
          </div>
        ) : state?.error && !state.fieldErrors ? (
          <div ref={alertRef} tabIndex={-1} className="outline-none">
            <Alert tone="error">{state.error}</Alert>
          </div>
        ) : null}

        <Button type="submit" size="xl" loading={pending} className="w-full">
          {pending ? "Enviando…" : "Restablecer acceso"}
        </Button>
      </fieldset>
    </form>
  );
}
