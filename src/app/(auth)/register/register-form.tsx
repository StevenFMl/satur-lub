"use client";

import { useActionState, useState } from "react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { FieldError } from "@/components/ui/field-error";
import { PasswordInput } from "@/components/ui/password-input";
import { registerAction, type AuthState } from "@/actions/auth";
import {
  registerSchema,
  type RegisterFieldErrors,
} from "@/lib/validations/auth";
import { useScrollOnMessage } from "@/lib/hooks/use-scroll-on-error";

export function RegisterForm() {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    registerAction,
    null
  );

  const [clientErrors, setClientErrors] = useState<RegisterFieldErrors>({});
  const alertRef = useScrollOnMessage<HTMLDivElement>(
    !state?.fieldErrors ? state?.error : null
  );

  // Cliente prevalece; servidor llena huecos (p. ej. "Ya existe una cuenta…").
  const errors: RegisterFieldErrors = {
    ...(state?.fieldErrors as RegisterFieldErrors | undefined),
    ...clientErrors,
  };

  function clearError(field: keyof RegisterFieldErrors) {
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
    const result = registerSchema.safeParse({
      full_name: formData.get("full_name"),
      email: formData.get("email"),
      password: formData.get("password"),
    });

    if (!result.success) {
      event.preventDefault();
      const flat: RegisterFieldErrors = {};
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
          <Label htmlFor="full_name" required>
            Nombre completo
          </Label>
          <Input
            id="full_name"
            name="full_name"
            type="text"
            autoComplete="name"
            placeholder="Juan Pérez"
            autoFocus
            aria-describedby={errors.full_name ? "full_name-error" : undefined}
            invalid={Boolean(errors.full_name)}
            onChange={() => clearError("full_name")}
          />
          <FieldError fieldId="full_name" message={errors.full_name} />
        </div>

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
            aria-describedby={errors.email ? "email-error" : undefined}
            invalid={Boolean(errors.email)}
            onChange={() => clearError("email")}
          />
          <FieldError fieldId="email" message={errors.email} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password" required>
            Contraseña
          </Label>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="new-password"
            placeholder="Mínimo 8 caracteres"
            aria-describedby={errors.password ? "password-error" : undefined}
            invalid={Boolean(errors.password)}
            onChange={() => clearError("password")}
          />
          {!errors.password ? (
            <p className="field-hint">
              Mínimo 8 caracteres · al menos 1 letra y 1 número
            </p>
          ) : (
            <FieldError fieldId="password" message={errors.password} />
          )}
        </div>

        {state?.error && !state.fieldErrors ? (
          <div ref={alertRef} tabIndex={-1} className="outline-none">
            <Alert tone="error">{state.error}</Alert>
          </div>
        ) : null}

        <Button type="submit" size="xl" loading={pending} className="w-full">
          {pending ? "Creando cuenta…" : "Crear cuenta y continuar"}
        </Button>

        <p className="text-[11.5px] leading-5 text-muted-foreground">
          Al continuar aceptas los{" "}
          <a
            href="#"
            className="font-semibold text-safety-500 underline-offset-4 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Términos
          </a>{" "}
          y la{" "}
          <a
            href="#"
            className="font-semibold text-safety-500 underline-offset-4 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Política de privacidad
          </a>
          .
        </p>
      </fieldset>
    </form>
  );
}
