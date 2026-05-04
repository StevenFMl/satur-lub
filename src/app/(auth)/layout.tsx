import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="garage-backdrop relative flex min-h-dvh flex-col">
      {/* Acento hazard stripe arriba */}
      <div aria-hidden className="hazard-stripe h-1 w-full opacity-90" />

      {/* Header */}
      <header className="relative z-10 border-b border-steel-700/80 bg-steel-900/50 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-6 sm:px-8">
          <Link
            href="/"
            aria-label="Inicio"
            className="inline-flex rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500"
          >
            <Logo />
          </Link>
          <Link
            href="/"
            className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground underline-offset-4 transition-colors duration-150 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500"
          >
            ← Volver al sitio
          </Link>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 items-stretch justify-center">
        <div className="mx-auto grid w-full max-w-7xl flex-1 grid-cols-1 lg:grid-cols-[1fr_minmax(480px,540px)]">
          {/* Lado izquierdo: visual de marca (oculto en móvil) */}
          <aside className="relative hidden overflow-hidden border-r border-steel-700/70 lg:block">
            <BrandVisual />
          </aside>

          {/* Lado derecho: formulario — centrado vertical perfecto */}
          <section className="relative flex items-center justify-center px-6 py-12 sm:px-10 sm:py-16 lg:py-20">
            {/* Textura sutil para dar profundidad */}
            <div aria-hidden className="carbon-fiber absolute inset-0 opacity-15 pointer-events-none" />
            <div
              aria-hidden
              className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_center,rgba(255,193,7,0.03)_0%,transparent_70%)]"
            />
            <div className="relative w-full max-w-[480px]">{children}</div>
          </section>
        </div>
      </main>

      <footer className="relative z-10 border-t border-steel-700/80 bg-steel-900/50">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-start justify-between gap-2 px-6 py-4 sm:flex-row sm:items-center sm:px-8">
          <p className="industrial-label !text-[10px]">
            © {new Date().getFullYear()} SATURNLUB
          </p>
          <nav className="flex items-center gap-5 text-[11px] uppercase tracking-wider text-muted-foreground">
            <a
              href="#"
              className="transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Términos
            </a>
            <a
              href="#"
              className="transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Privacidad
            </a>
            <a
              href="#"
              className="transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Soporte
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

/**
 * Panel decorativo del lado izquierdo: propuesta de valor directa.
 * Sin datos falsos, sin decoración vacía — solo marca y copy real.
 */
function BrandVisual() {
  return (
    <div className="relative flex h-full flex-col justify-center p-10 xl:p-16">
      {/* Texturas de fondo */}
      <div aria-hidden className="carbon-fiber absolute inset-0 opacity-40" />
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-steel-950/80"
      />
      <div
        aria-hidden
        className="absolute -right-40 -top-32 h-[360px] w-[360px] rounded-full bg-safety-500/10 blur-3xl"
      />
      {/* Secondary glow for depth */}
      <div
        aria-hidden
        className="absolute -left-20 bottom-0 h-[280px] w-[280px] rounded-full bg-rust-500/5 blur-[100px]"
      />

      <div className="relative space-y-8">
        <h2 className="font-display text-[48px] leading-[0.92] tracking-[0.01em] text-foreground xl:text-[64px] 2xl:text-[72px]">
          GESTIÓN TOTAL
          <br />
          <span className="text-safety-500">PARA TU TALLER.</span>
        </h2>
        <p className="max-w-md text-[15px] leading-7 text-muted-foreground">
          Órdenes de servicio, control de vehículos, inventario de aceites y
          repuestos, caja y facturación. Toda la operación de tu lubricentro
          bajo un mismo sistema.
        </p>

        {/* Propuesta real en lugar de datos inventados */}
        <div className="space-y-3 border-t border-steel-700/70 pt-6">
          <TrustPoint>14 días de prueba sin tarjeta</TrustPoint>
          <TrustPoint>Soporte por WhatsApp incluido</TrustPoint>
          <TrustPoint>Operando en menos de 5 minutos</TrustPoint>
        </div>

        {/* Subtle brand reinforcement */}
        <div className="pt-4">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-600">
            +120 talleres operando en Ecuador
          </p>
        </div>
      </div>
    </div>
  );
}

function TrustPoint({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className="flex h-5 w-5 shrink-0 items-center justify-center border border-safety-500/40 bg-safety-500/10"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-safety-500"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
      <span className="text-[13.5px] text-zinc-300">{children}</span>
    </div>
  );
}
