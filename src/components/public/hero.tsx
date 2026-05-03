import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  PlayCircle,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export function HeroSection() {
  return (
    <section className="relative isolate -mt-20 flex w-full flex-col overflow-hidden bg-zinc-950 pt-32 pb-12 sm:pt-40 sm:pb-16 lg:min-h-[88vh] lg:pt-44 lg:pb-20">
      {/* === Capas de fondo simulando foto de taller === */}
      {/* Gradiente diagonal asfalto/carbón */}
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,193,7,0.08)_0%,transparent_55%),radial-gradient(ellipse_at_bottom_left,rgba(31,111,235,0.08)_0%,transparent_50%),linear-gradient(180deg,#0a0a0b_0%,#0f1115_60%,#080809_100%)]"
      />
      {/* Overlay zinc oscuro tipo foto */}
      <div aria-hidden className="absolute inset-0 bg-zinc-950/50" />
      {/* Carbon fiber muy sutil */}
      <div aria-hidden className="absolute inset-0 carbon-fiber opacity-25" />
      {/* Highlight superior tipo metal cepillado */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-zinc-600/50 to-transparent"
      />
      {/* Vignette inferior para fundir con la siguiente sección */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-b from-transparent to-zinc-950"
      />

      {/* === Contenido === */}
      <div className="relative mx-auto grid w-full max-w-7xl flex-1 grid-cols-1 items-center gap-12 px-6 lg:grid-cols-[1.35fr_1fr] lg:gap-14 lg:px-10">
        {/* Columna izquierda: copy enorme */}
        <div className="space-y-7">
          <span className="inline-flex items-center gap-2 border border-safety-500/30 bg-safety-500/10 px-3 py-1.5 text-[12px] font-semibold uppercase tracking-[0.18em] text-safety-500 backdrop-blur">
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full bg-safety-500 shadow-[0_0_8px_2px_rgba(255,193,7,0.7)]"
            />
            Software para talleres en Ecuador
          </span>

          <h1 className="font-display text-[60px] leading-[0.92] tracking-[0.005em] text-white sm:text-[84px] lg:text-[104px] xl:text-[120px]">
            Gestión total
            <br />
            <span className="text-safety-500">para tu taller.</span>
          </h1>

          <p className="max-w-xl text-[16px] leading-7 text-zinc-300 sm:text-[17px] sm:leading-8">
            SaturnLub digitaliza tu lubricadora, taller mecánico o ferretería
            automotriz: órdenes de trabajo, ficha por vehículo, control de
            inventario, caja diaria y facturación electrónica conectada al SRI.
            Todo desde el mostrador, sin papeles que perder.
          </p>

          {/* Trust strip */}
          <ul className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] font-medium text-zinc-400">
            <TrustItem icon={<CheckCircle2 className="h-4 w-4 text-safety-500" />}>
              Sin tarjeta para empezar
            </TrustItem>
            <TrustItem icon={<ShieldCheck className="h-4 w-4 text-safety-500" />}>
              Datos cifrados
            </TrustItem>
            <TrustItem icon={<Wrench className="h-4 w-4 text-safety-500" />}>
              Listo en 5 minutos
            </TrustItem>
          </ul>
        </div>

        {/* Columna derecha: CTA box destacado */}
        <CtaBox />
      </div>
    </section>
  );
}

function TrustItem({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-2">
      {icon}
      {children}
    </li>
  );
}

function CtaBox() {
  return (
    <aside className="relative">
      {/* Halo amarillo detrás de la card */}
      <div
        aria-hidden
        className="absolute -inset-4 -z-10 bg-safety-500/15 blur-3xl"
      />

      <div className="relative overflow-hidden border border-zinc-800 bg-zinc-900/80 shadow-bevel backdrop-blur">
        {/* Top stripe amarilla */}
        <div aria-hidden className="h-1 w-full bg-safety-500" />

        <div className="space-y-5 px-7 py-8 sm:px-8 sm:py-9">
          <div>
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-safety-500">
              Empieza hoy
            </p>
            <h2 className="mt-3 font-display text-[34px] leading-[0.95] tracking-[0.02em] text-white sm:text-[40px]">
              Tu taller operando
              <br />
              <span className="text-safety-500">en menos de 5 minutos.</span>
            </h2>
          </div>

          <p className="text-[14px] leading-6 text-zinc-400">
            Crea tu cuenta, configura tu negocio y empieza a registrar órdenes
            el mismo día. Sin contratos, sin permanencia.
          </p>

          {/* Features visuales */}
          <ul className="space-y-2.5 border-y border-zinc-800 py-4">
            <BulletPoint>14 días de prueba completa</BulletPoint>
            <BulletPoint>Soporte por WhatsApp incluido</BulletPoint>
            <BulletPoint>Migración asistida desde Excel</BulletPoint>
          </ul>

          <div className="space-y-3">
            <Link href="/register" className="block">
              <Button size="xl" className="group/cta w-full">
                Crear mi cuenta gratis
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover/cta:translate-x-1" />
              </Button>
            </Link>
            <Link href="#como-opera" className="block">
              <Button
                size="lg"
                variant="ghost"
                className="w-full !text-zinc-300 hover:!text-safety-500"
              >
                <PlayCircle className="h-4 w-4" />
                Ver cómo funciona
              </Button>
            </Link>
          </div>

          <p className="text-center text-[11.5px] text-zinc-500">
            Más de 120 talleres ya operan con SaturnLub
          </p>
        </div>
      </div>
    </aside>
  );
}

function BulletPoint({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-[13.5px] leading-5 text-zinc-200">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-safety-500" />
      <span>{children}</span>
    </li>
  );
}
