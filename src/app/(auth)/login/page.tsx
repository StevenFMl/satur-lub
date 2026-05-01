import Link from "next/link";
import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Acceso al sistema",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string }>;
}) {
  const { redirectTo } = await searchParams;

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
            Acceso · Operador
          </span>
        </div>
        <span className="industrial-label">ID-001</span>
      </div>

      {/* Chasis del formulario */}
      <div className="rounded-sm border border-steel-700 bg-card shadow-industrial">
        <header className="flex items-center justify-between border-b border-steel-700 bg-steel-800/60 px-5 py-3">
          <h1 className="text-[15px] font-extrabold uppercase tracking-wider">
            Iniciar sesión
          </h1>
          <span className="industrial-label">Auth · v1</span>
        </header>

        <div className="px-5 py-6 sm:px-6 sm:py-7">
          <p className="mb-6 text-[13px] leading-5 text-muted-foreground">
            Ingresa tus credenciales para operar tu negocio en SaturnLub.
          </p>
          <LoginForm redirectTo={redirectTo} />
        </div>

        <footer className="flex items-center justify-between border-t border-steel-700 bg-steel-800/40 px-5 py-3">
          <span className="industrial-label">¿Sin cuenta?</span>
          <Link
            href="/register"
            className="text-[12px] font-bold uppercase tracking-wider text-safety-500 underline-offset-4 hover:underline"
          >
            Solicitar registro →
          </Link>
        </footer>
      </div>

      <p className="industrial-label text-center !text-[10px]">
        Plataforma operativa para lubricentros · talleres · ferreterías
      </p>
    </div>
  );
}
