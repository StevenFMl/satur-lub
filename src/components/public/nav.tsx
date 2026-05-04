"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { href: "#servicios", label: "Servicios" },
  { href: "#como-opera", label: "Cómo funciona" },
  { href: "#precios", label: "Precios" },
  { href: "#contacto", label: "Contacto" },
];

export function PublicNav() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 w-full transition-all duration-300 ease-out",
        scrolled
          ? "border-b border-zinc-800/80 bg-zinc-950/85 backdrop-blur-md supports-[backdrop-filter]:bg-zinc-950/70"
          : "border-b border-transparent bg-transparent"
      )}
    >
      <div className="mx-auto flex h-20 w-full max-w-7xl items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          aria-label="SaturnLub · Inicio"
          className="inline-flex rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
        >
          <Logo />
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {SECTIONS.map((s) => (
            <a
              key={s.href}
              href={s.href}
              className="rounded-sm px-4 py-2 text-[13px] font-semibold text-zinc-300 transition-colors duration-150 hover:text-safety-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
            >
              {s.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <Link href="/login">
            <Button variant="ghost" size="sm">
              Ingresar
            </Button>
          </Link>
          <Link href="/register">
            <Button variant="primary" size="sm">
              Probar gratis
            </Button>
          </Link>
        </div>

        {/* Mobile trigger */}
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label={mobileOpen ? "Cerrar menú" : "Abrir menú"}
          aria-expanded={mobileOpen}
          className="grid h-11 w-11 place-items-center rounded-sm border border-zinc-700 bg-zinc-900/80 text-foreground transition-colors duration-150 hover:border-safety-500 hover:text-safety-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 lg:hidden"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="border-t border-zinc-800 bg-zinc-950/95 backdrop-blur lg:hidden">
          <nav className="mx-auto flex w-full max-w-7xl flex-col gap-1 px-4 sm:px-6 lg:px-8 py-4">
            {SECTIONS.map((s) => (
              <a
                key={s.href}
                href={s.href}
                onClick={() => setMobileOpen(false)}
                className="rounded-sm px-3 py-3 text-[14px] font-semibold text-zinc-300 transition-colors duration-150 hover:bg-zinc-900 hover:text-safety-500"
              >
                {s.label}
              </a>
            ))}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Link href="/login" onClick={() => setMobileOpen(false)}>
                <Button variant="outline" size="md" className="w-full">
                  Ingresar
                </Button>
              </Link>
              <Link href="/register" onClick={() => setMobileOpen(false)}>
                <Button variant="primary" size="md" className="w-full">
                  Probar gratis
                </Button>
              </Link>
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
