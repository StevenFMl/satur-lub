import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <div className="relative flex min-h-dvh flex-col">
      <div className="absolute inset-0 -z-10 gradient-mesh" />

      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <Logo />
        <div className="flex items-center gap-2">
          <Link href="/login">
            <Button variant="ghost" size="sm">
              Iniciar sesión
            </Button>
          </Link>
          <Link href="/register">
            <Button size="sm">Crear cuenta</Button>
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <span className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
          SaaS operativo · Fase 1
        </span>
        <h1 className="mt-6 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Opera tu lubricentro con orden, claridad y velocidad.
        </h1>
        <p className="mt-5 max-w-2xl text-base text-muted-foreground">
          SaturnLub es la plataforma para gestionar órdenes, vehículos,
          inventario y facturación de tu taller en un solo lugar.
        </p>
        <div className="mt-8 flex items-center gap-3">
          <Link href="/register">
            <Button size="lg">Comenzar gratis</Button>
          </Link>
          <Link href="/login">
            <Button size="lg" variant="outline">
              Ya tengo cuenta
            </Button>
          </Link>
        </div>
      </main>

      <footer className="mx-auto w-full max-w-6xl px-6 py-8 text-xs text-muted-foreground">
        © {new Date().getFullYear()} SaturnLub
      </footer>
    </div>
  );
}
