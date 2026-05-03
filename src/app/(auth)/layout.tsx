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

      {/* Header HMI */}
      <header className="relative z-10 border-b border-steel-700/80 bg-steel-900/50 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
          <Link
            href="/"
            aria-label="Inicio"
            className="inline-flex rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500"
          >
            <Logo />
          </Link>
          <div className="hidden items-center gap-3 sm:flex">
            <span
              aria-hidden
              className="h-2 w-2 rounded-full bg-signal-500 animate-press-blink shadow-[0_0_8px_2px_rgba(22,163,74,0.5)]"
            />
            <span className="hud-readout !text-signal-500/90">SISTEMA · ONLINE</span>
          </div>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 items-stretch justify-center">
        <div className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 lg:grid-cols-[1.05fr_minmax(420px,460px)]">
          {/* Lado izquierdo: visual de marca (oculto en móvil) */}
          <aside className="relative hidden overflow-hidden border-r border-steel-700/70 lg:block">
            <BrandVisual />
          </aside>

          {/* Lado derecho: formulario */}
          <section className="flex items-start justify-center px-5 py-10 sm:items-center sm:py-12">
            <div className="w-full max-w-[440px]">{children}</div>
          </section>
        </div>
      </main>

      <footer className="relative z-10 border-t border-steel-700/80 bg-steel-900/50">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-start justify-between gap-2 px-6 py-3 sm:flex-row sm:items-center">
          <p className="industrial-label !text-[10px]">
            © {new Date().getFullYear()} SATURNLUB · SISTEMA OPERATIVO INDUSTRIAL
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
 * Panel decorativo del lado izquierdo: identidad automotriz elegante.
 * Tipografía display + lecturas tipo HUD + gauge + pista de carbon fiber.
 */
function BrandVisual() {
  return (
    <div className="relative flex h-full flex-col justify-between p-10 xl:p-14">
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

      <div className="relative flex items-center gap-3">
        <span
          aria-hidden
          className="h-2 w-2 rounded-full bg-safety-500 shadow-[0_0_10px_2px_rgba(255,193,7,0.6)] animate-press-blink"
        />
        <span className="hud-readout">Modo · Acceso Seguro</span>
      </div>

      <div className="relative space-y-6">
        <h2 className="font-display text-[48px] leading-[0.95] tracking-[0.01em] text-foreground xl:text-[60px]">
          POTENCIA TU
          <br />
          <span className="text-safety-500">TALLER</span>
          <br />
          DESDE UN
          <br />
          SOLO PANEL.
        </h2>
        <p className="max-w-md text-[14px] leading-7 text-muted-foreground">
          Órdenes de servicio, control de vehículos, inventario de
          aceites y repuestos, caja y facturación. Toda la operación de
          tu lubricentro o taller mecánico bajo un mismo sistema.
        </p>
      </div>

      <div className="relative grid grid-cols-3 gap-3">
        <SpecTile label="Órdenes" value="24" />
        <SpecTile label="Vehículos" value="118" />
        <SpecTile label="Sucursales" value="02" />
      </div>
    </div>
  );
}

function SpecTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-steel-700 bg-steel-900/60 p-3 backdrop-blur-sm transition-colors duration-150 hover:border-steel-500">
      <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-display text-[28px] leading-none tracking-[0.02em] text-foreground tabular-nums">
        {value}
      </div>
    </div>
  );
}
