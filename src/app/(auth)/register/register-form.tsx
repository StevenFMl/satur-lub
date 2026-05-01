"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { PasswordInput } from "@/components/ui/password-input";
import { registerAction, type AuthState } from "../actions";

export function RegisterForm() {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    registerAction,
    null
  );

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="full_name">Nombre completo</Label>
        <Input
          id="full_name"
          name="full_name"
          type="text"
          autoComplete="name"
          required
          placeholder="Juan Pérez"
          autoFocus
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="email">Correo electrónico</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="tu@empresa.com"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Contraseña</Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={8}
          placeholder="Mínimo 8 caracteres"
        />
        <p className="text-[12px] text-muted-foreground">
          Usa al menos 8 caracteres. Te recomendamos combinar letras y números.
        </p>
      </div>

      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}

      <Button type="submit" size="lg" loading={pending} className="w-full">
        {pending ? "Creando cuenta" : "Crear cuenta"}
      </Button>

      <p className="text-[12px] leading-5 text-muted-foreground">
        Al continuar aceptas los{" "}
        <a href="#" className="underline-offset-4 hover:underline">
          Términos
        </a>{" "}
        y la{" "}
        <a href="#" className="underline-offset-4 hover:underline">
          Política de privacidad
        </a>
        .
      </p>
    </form>
  );
}
