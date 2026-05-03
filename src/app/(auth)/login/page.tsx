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
      {/* Placa de identificación */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-sm bg-safety-500 shadow-[0_0_6px_1px_rgba(255,193,7,0.6)]"
          />
          <span className="hud-readout">Acceso · Operador</span>
        </div>
        <span className="hud-readout !text-muted-foreground">ID-001</span>
      </div>

      {/* Chasis del formulario: panel con tornillos */}
      <div className="panel panel-bolts relative overflow-hidden rounded-sm">
        <span aria-hidden className="bolt-bl" />
        <span aria-hidden className="bolt-br" />

        <header className="top-highlight flex items-center justify-between border-b border-steel-700 bg-steel-900/70 px-6 py-4">
          <h1 className="font-display text-[22px] leading-none tracking-[0.04em] text-foreground">
            INICIAR SESIÓN
          </h1>
          <span className="hud-readout">Auth · v1</span>
        </header>

        <div className="px-6 py-7 sm:px-7 sm:py-8">
          <p className="mb-7 text-[13px] leading-6 text-muted-foreground">
            Ingresa tus credenciales para operar tu negocio en SaturnLub.
          </p>
          <LoginForm redirectTo={redirectTo} />
        </div>

        <footer className="flex items-center justify-between border-t border-steel-700 bg-steel-900/40 px-6 py-3">
          <span className="industrial-label">¿Sin cuenta?</span>
          <Link
            href="/register"
            className="font-mono text-[12px] font-bold uppercase tracking-[0.16em] text-safety-500 underline-offset-4 hover:underline"
          >
            Solicitar registro →
          </Link>
        </footer>
      </div>

      <p className="industrial-label text-center !text-[10px]">
        Plataforma operativa · Lubricentros · Talleres · Ferreterías
      </p>
    </div>
  );
}
