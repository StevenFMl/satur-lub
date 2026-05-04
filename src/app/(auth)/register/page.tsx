import Link from "next/link";
import type { Metadata } from "next";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = {
  title: "Crear cuenta",
};

export default function RegisterPage() {
  return (
    <div className="panel panel-bolts relative overflow-hidden rounded-sm shadow-[0_0_0_1px_rgba(0,0,0,0.3),0_16px_40px_-12px_rgba(0,0,0,0.5)]">
      <span aria-hidden className="bolt-bl" />
      <span aria-hidden className="bolt-br" />

      <header className="top-highlight flex items-center justify-between border-b border-steel-700 bg-steel-900/70 px-6 py-5 sm:px-8">
        <h1 className="font-display text-[24px] leading-none tracking-[0.04em] text-foreground sm:text-[28px]">
          CREAR CUENTA
        </h1>
      </header>

      <div className="space-y-7 px-6 py-9 sm:px-8 sm:py-10">
        <p className="text-[13.5px] leading-6 text-muted-foreground">
          Configura tu taller, lubricentro o ferretería en SaturnLub.
          Acceso inmediato, sin verificación por correo.
        </p>
        <RegisterForm />
      </div>

      <footer className="flex items-center justify-between border-t border-steel-700 bg-steel-900/40 px-6 py-4 sm:px-8">
        <span className="industrial-label">¿Ya tienes cuenta?</span>
        <Link
          href="/login"
          className="font-mono text-[12px] font-bold uppercase tracking-[0.16em] text-safety-500 underline-offset-4 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Iniciar sesión →
        </Link>
      </footer>
    </div>
  );
}
