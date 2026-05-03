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

export function RegisterForm() {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    registerAction,
    null
  );

  const [clientErrors, setClientErrors] = useState<RegisterFieldErrors>({});

  // Client-side errors take precedence; server-side errors fill any gaps
  // (e.g. "Ya existe una cuenta con ese correo.").
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
    <form
      action={formAction}
      onSubmit={handleSubmit}
      className="space-y-5"
      noValidate
    >
      <div className="space-y-2">
        <Label htmlFor="full_name">Nombre completo</Label>
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
        <Label htmlFor="email">Correo electrónico</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="tu@empresa.com"
          aria-describedby={errors.email ? "email-error" : undefined}
          invalid={Boolean(errors.email)}
          onChange={() => clearError("email")}
        />
        <FieldError fieldId="email" message={errors.email} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Contraseña</Label>
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
          <p className="text-[11.5px] font-medium uppercase tracking-wider text-muted-foreground">
            Mínimo 8 caracteres · 1 letra · 1 número
          </p>
        ) : (
          <FieldError fieldId="password" message={errors.password} />
        )}
      </div>

      {state?.error && !state.fieldErrors ? (
        <Alert tone="error">{state.error}</Alert>
      ) : null}

      <Button type="submit" size="xl" loading={pending} className="w-full">
        {pending ? "Creando cuenta" : "Crear cuenta y continuar"}
      </Button>

      <p className="text-[11.5px] leading-5 text-muted-foreground">
        Al continuar aceptas los{" "}
        <a href="#" className="font-semibold text-safety-500 underline-offset-4 hover:underline">
          Términos
        </a>{" "}
        y la{" "}
        <a href="#" className="font-semibold text-safety-500 underline-offset-4 hover:underline">
          Política de privacidad
        </a>
        .
      </p>
    </form>
  );
}
