import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="brushed-steel relative flex min-h-dvh flex-col">
      {/* Barra superior tipo HMI */}
      <header className="border-b border-steel-700 bg-steel-900/70 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-5">
          <Link
            href="/"
            aria-label="Inicio"
            className="inline-flex rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500"
          >
            <Logo />
          </Link>
          <div className="hidden items-center gap-2 sm:flex">
            <span
              aria-hidden
              className="h-2 w-2 rounded-full bg-signal-500 animate-press-blink shadow-[0_0_8px_2px_rgba(22,163,74,0.5)]"
            />
            <span className="industrial-label !text-[10px]">SISTEMA · ONLINE</span>
          </div>
        </div>
      </header>

      {/* Acento hazard stripe muy delgado, sólo como remate visual */}
      <div aria-hidden className="hazard-stripe h-1 w-full opacity-90" />

      <main className="flex flex-1 items-start justify-center px-5 py-10 sm:items-center sm:py-14">
        <div className="w-full max-w-[440px]">{children}</div>
      </main>

      <footer className="border-t border-steel-700 bg-steel-900/60">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-start justify-between gap-2 px-5 py-3 sm:flex-row sm:items-center">
          <p className="industrial-label !text-[10px]">
            © {new Date().getFullYear()} SATURNLUB · HEAVY-DUTY OS
          </p>
          <nav className="flex items-center gap-5 text-[11px] uppercase tracking-wider text-muted-foreground">
            <a href="#" className="hover:text-foreground">
              Términos
            </a>
            <a href="#" className="hover:text-foreground">
              Privacidad
            </a>
            <a href="#" className="hover:text-foreground">
              Soporte
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
