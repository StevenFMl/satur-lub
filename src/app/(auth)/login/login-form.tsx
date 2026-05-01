"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { PasswordInput } from "@/components/ui/password-input";
import { loginAction, type AuthState } from "../actions";

export function LoginForm({ redirectTo }: { redirectTo?: string }) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    loginAction,
    null
  );

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <input type="hidden" name="redirectTo" value={redirectTo ?? ""} />

      <Field>
        <Label htmlFor="email">Correo / usuario</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="operador@empresa.com"
          autoFocus
        />
      </Field>

      <Field>
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
          required
          minLength={8}
          placeholder="••••••••"
        />
      </Field>

      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}

      <Button
        type="submit"
        size="xl"
        loading={pending}
        className="w-full"
      >
        {pending ? "Conectando" : "Acceder al sistema"}
      </Button>
    </form>
  );
}

function Field({ children }: { children: React.ReactNode }) {
  return <div className="space-y-2">{children}</div>;
}
