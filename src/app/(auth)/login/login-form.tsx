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
import { loginAction, type AuthState } from "@/actions/auth";
import { loginSchema, type LoginFieldErrors } from "@/lib/validations/auth";
import { useScrollOnMessage } from "@/lib/hooks/use-scroll-on-error";

export function LoginForm({ redirectTo }: { redirectTo?: string }) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    loginAction,
    null
  );

  const [clientErrors, setClientErrors] = useState<LoginFieldErrors>({});
  const alertRef = useScrollOnMessage<HTMLDivElement>(
    !state?.fieldErrors ? state?.error : null
  );

  // Server fieldErrors es una unión que incluye Login/Register/Forgot.
  // Nos quedamos con las claves que aplican al login.
  const serverFieldErrors = (state?.fieldErrors as LoginFieldErrors | undefined) ?? {};
  const errors: LoginFieldErrors = { ...serverFieldErrors, ...clientErrors };

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
      identifier: formData.get("identifier"),
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
    <form action={formAction} onSubmit={handleSubmit} noValidate>
      <fieldset
        disabled={pending}
        className="m-0 min-w-0 space-y-6 border-0 p-0 disabled:opacity-95"
      >
        <input type="hidden" name="redirectTo" value={redirectTo ?? ""} />

        <div className="space-y-2">
          <Label htmlFor="identifier" required>
            Cédula o correo
          </Label>
          <Input
            id="identifier"
            name="identifier"
            type="text"
            inputMode="text"
            autoComplete="username"
            mono
            placeholder="1234567890  ·  operador@empresa.com"
            autoFocus
            aria-describedby={
              errors.identifier ? "identifier-error" : "identifier-hint"
            }
            invalid={Boolean(errors.identifier)}
            onChange={() => clearError("identifier")}
          />
          {errors.identifier ? (
            <FieldError fieldId="identifier" message={errors.identifier} />
          ) : (
            <p id="identifier-hint" className="field-hint">
              Cédula ecuatoriana de 10 dígitos · o tu correo registrado
            </p>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <Label htmlFor="password" required>
              Contraseña
            </Label>
            <Link
              href="/forgot-password"
              tabIndex={-1}
              className="-my-1 inline-flex min-h-[32px] items-center font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-rust-400 underline-offset-4 transition-colors duration-150 hover:text-rust-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
          <div ref={alertRef} tabIndex={-1} className="outline-none">
            <Alert tone="error">{state.error}</Alert>
          </div>
        ) : null}

        <Button type="submit" size="xl" loading={pending} className="w-full">
          {pending ? "Conectando…" : "Acceder al sistema"}
        </Button>
      </fieldset>
    </form>
  );
}
