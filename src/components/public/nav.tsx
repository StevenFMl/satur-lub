import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

const SECTIONS = [
  { href: "#servicios", label: "Servicios" },
  { href: "#como-opera", label: "Cómo opera" },
  { href: "#precios", label: "Precios" },
  { href: "#contacto", label: "Contacto" },
];

export function PublicNav() {
  return (
    <header className="absolute inset-x-0 top-0 z-30">
      {/* Hazard stripe top */}
      <div aria-hidden className="hazard-stripe h-1 w-full opacity-90" />

      <div className="mx-auto flex h-20 w-full max-w-7xl items-center justify-between gap-6 px-6 lg:px-10">
        <Link
          href="/"
          aria-label="SaturnLub · Inicio"
          className="inline-flex rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Logo />
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {SECTIONS.map((s) => (
            <a
              key={s.href}
              href={s.href}
              className="rounded-sm px-3 py-2 font-mono text-[12px] font-bold uppercase tracking-[0.18em] text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {s.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link href="/login" className="hidden sm:block">
            <Button variant="ghost" size="sm">
              Ingresar
            </Button>
          </Link>
          <Link href="/register">
            <Button variant="primary" size="sm">
              Comenzar
            </Button>
          </Link>
        </div>
      </div>
    </header>
  );
}
