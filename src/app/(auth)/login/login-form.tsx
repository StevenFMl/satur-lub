"use client";

import { useActionState, useState } from "react";
import type * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { FieldError } from "@/components/ui/field-error";
import { PasswordInput } from "@/components/ui/password-input";
import { loginAction, type AuthState } from "../actions";
import { loginSchema, type LoginFieldErrors } from "@/lib/validations/auth";

export function LoginForm({ redirectTo }: { redirectTo?: string }) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    loginAction,
    null
  );

  const [clientErrors, setClientErrors] = useState<LoginFieldErrors>({});

  const errors: LoginFieldErrors = {
    ...(state?.fieldErrors as LoginFieldErrors | undefined),
    ...clientErrors,
  };

  function clearError(field: keyof LoginFieldErrors) {
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
    const result = loginSchema.safeParse({
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: formData.get("redirectTo") ?? undefined,
    });

    if (!result.success) {
      event.preventDefault();
      const flat: LoginFieldErrors = {};
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
      <input type="hidden" name="redirectTo" value={redirectTo ?? ""} />

      <div className="space-y-2">
        <Label htmlFor="email">Correo / usuario</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="operador@empresa.com"
          autoFocus
          aria-describedby={errors.email ? "email-error" : undefined}
          invalid={Boolean(errors.email)}
          onChange={() => clearError("email")}
        />
        <FieldError fieldId="email" message={errors.email} />
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <Label htmlFor="password">Contraseña</Label>
          <Link
            href="/login"
            tabIndex={-1}
            className="text-[11px] font-semibold uppercase tracking-wider text-rust-400 underline-offset-4 transition-colors hover:text-rust-500 hover:underline"
          >
            Recuperar
          </Link>
        </div>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          placeholder="••••••••"
          aria-describedby={errors.password ? "password-error" : undefined}
          invalid={Boolean(errors.password)}
          onChange={() => clearError("password")}
        />
        <FieldError fieldId="password" message={errors.password} />
      </div>

      {state?.error && !state.fieldErrors ? (
        <Alert tone="error">{state.error}</Alert>
      ) : null}

      <Button type="submit" size="xl" loading={pending} className="w-full">
        {pending ? "Conectando" : "Acceder al sistema"}
      </Button>
    </form>
  );
}
