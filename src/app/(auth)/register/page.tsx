import Link from "next/link";
import type { Metadata } from "next";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = {
  title: "Crear cuenta",
};

export default function RegisterPage() {
  return (
    <div className="space-y-5">
      {/* Placa de identificación de la pantalla */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block h-3 w-3 rounded-sm bg-safety-500 shadow-[0_0_6px_1px_rgba(255,193,7,0.6)]"
          />
          <span className="industrial-label !text-foreground">
            Alta de Operador
          </span>
        </div>
        <span className="industrial-label">ID-NEW</span>
      </div>

      {/* Chasis del formulario */}
      <div className="rounded-sm border border-steel-700 bg-card shadow-industrial">
        <header className="flex items-center justify-between border-b border-steel-700 bg-steel-800/60 px-5 py-3">
          <h1 className="text-[15px] font-extrabold uppercase tracking-wider">
            Registro al sistema
          </h1>
          <span className="industrial-label">Auth · v1</span>
        </header>

        <div className="px-5 py-6 sm:px-6 sm:py-7">
          <p className="mb-6 text-[13px] leading-5 text-muted-foreground">
            Configura tu taller, ferretería o negocio automotriz en SaturnLub.
          </p>
          <RegisterForm />
        </div>

        <footer className="flex items-center justify-between border-t border-steel-700 bg-steel-800/40 px-5 py-3">
          <span className="industrial-label">¿Ya operando?</span>
          <Link
            href="/login"
            className="text-[12px] font-bold uppercase tracking-wider text-safety-500 underline-offset-4 hover:underline"
          >
            Iniciar sesión →
          </Link>
        </footer>
      </div>

      <p className="industrial-label text-center !text-[10px]">
        Plataforma operativa para lubricentros · talleres · ferreterías
      </p>
    </div>
  );
}
