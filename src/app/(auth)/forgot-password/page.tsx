import Link from "next/link";
import type { Metadata } from "next";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = {
  title: "Recuperar contraseña",
};

export default function ForgotPasswordPage() {
  return (
    <div className="space-y-5">
      {/* Placa de identificación */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-sm bg-rust-500 shadow-[0_0_6px_1px_rgba(232,93,26,0.6)]"
          />
          <span className="hud-readout">Recuperación · Acceso</span>
        </div>
        <span className="hud-readout !text-muted-foreground">ID·RST</span>
      </div>

      {/* Chasis del formulario */}
      <div className="panel panel-bolts relative overflow-hidden rounded-sm">
        <span aria-hidden className="bolt-bl" />
        <span aria-hidden className="bolt-br" />

        <header className="top-highlight flex items-center justify-between border-b border-steel-700 bg-steel-900/70 px-6 py-4">
          <h1 className="font-display text-[22px] leading-none tracking-[0.04em] text-foreground">
            RECUPERAR CONTRASEÑA
          </h1>
          <span className="hud-readout">Recuperación · v1</span>
        </header>

        <div className="px-6 py-7 sm:px-8 sm:py-8">
          <p className="mb-7 text-[13px] leading-6 text-muted-foreground">
            Ingresa el correo registrado de tu cuenta. Te enviaremos un enlace
            seguro para restablecer tu contraseña.
          </p>
          <ForgotPasswordForm />
        </div>

        <footer className="flex items-center justify-between border-t border-steel-700 bg-steel-900/40 px-6 py-3">
          <span className="industrial-label">¿La recuerdas?</span>
          <Link
            href="/login"
            className="font-mono text-[12px] font-bold uppercase tracking-[0.16em] text-safety-500 underline-offset-4 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            ← Volver al acceso
          </Link>
        </footer>
      </div>

      <p className="industrial-label text-center !text-[10px]">
        Este flujo solo aplica para usuarios con correo registrado
      </p>
    </div>
  );
}
