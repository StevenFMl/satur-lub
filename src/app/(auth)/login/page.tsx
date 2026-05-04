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
    <div className="panel panel-bolts relative overflow-hidden rounded-sm">
      <span aria-hidden className="bolt-bl" />
      <span aria-hidden className="bolt-br" />

      <header className="top-highlight flex items-center justify-between border-b border-steel-700 bg-steel-900/70 px-6 py-4 sm:px-8">
        <h1 className="font-display text-[24px] leading-none tracking-[0.04em] text-foreground sm:text-[28px]">
          INICIAR SESIÓN
        </h1>
      </header>

      <div className="space-y-7 px-6 py-8 sm:px-8 sm:py-10">
        <p className="text-[13.5px] leading-6 text-muted-foreground">
          Ingresa con tu{" "}
          <strong className="text-foreground">cédula</strong> o tu correo
          registrado para acceder al panel de operaciones.
        </p>
        <LoginForm redirectTo={redirectTo} />
      </div>

      <footer className="flex items-center justify-between border-t border-steel-700 bg-steel-900/40 px-6 py-3.5 sm:px-8">
        <span className="industrial-label">¿Sin cuenta?</span>
        <Link
          href="/register"
          className="font-mono text-[12px] font-bold uppercase tracking-[0.16em] text-safety-500 underline-offset-4 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Crear cuenta →
        </Link>
      </footer>
    </div>
  );
}
