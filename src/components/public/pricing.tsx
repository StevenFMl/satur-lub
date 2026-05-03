import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Plan = {
  code: string;
  name: string;
  tagline: string;
  price: string;
  unit: string;
  cta: string;
  ctaHref: string;
  ctaVariant: "primary" | "outline" | "rust";
  features: string[];
  highlighted?: boolean;
  badge?: string;
};

const PLANS: Plan[] = [
  {
    code: "01",
    name: "Inicial",
    tagline: "Para empezar a operar el primer día",
    price: "$ 0",
    unit: "/ por 14 días",
    cta: "Comenzar gratis",
    ctaHref: "/register",
    ctaVariant: "outline",
    features: [
      "1 sucursal · 2 usuarios",
      "Órdenes de servicio ilimitadas",
      "Ficha por vehículo y cliente",
      "Inventario básico (200 SKUs)",
      "Caja diaria y arqueo",
      "Soporte por correo",
    ],
  },
  {
    code: "02",
    name: "Pro Taller",
    tagline: "Para talleres operando todos los días",
    price: "$ 39",
    unit: "/ mes por sucursal",
    cta: "Activar Pro Taller",
    ctaHref: "/register?plan=pro",
    ctaVariant: "primary",
    badge: "Recomendado",
    highlighted: true,
    features: [
      "1 sucursal · 8 usuarios",
      "Todo lo del plan Inicial",
      "Inventario sin límite de SKUs",
      "Roles avanzados (mecánico, cobrador, admin)",
      "Reportes operativos y de caja",
      "Comprobantes con tus datos fiscales",
      "Soporte prioritario por WhatsApp",
    ],
  },
  {
    code: "03",
    name: "Multi-Sucursal",
    tagline: "Para grupos con dos o más locales",
    price: "$ 89",
    unit: "/ mes total",
    cta: "Hablar con ventas",
    ctaHref: "#contacto",
    ctaVariant: "rust",
    features: [
      "Sucursales y usuarios sin límite",
      "Todo lo del plan Pro Taller",
      "Consolidado entre sucursales",
      "Permisos granulares por local",
      "Exportes contables programados",
      "Onboarding asistido por nuestro equipo",
    ],
  },
];

export function PricingSection() {
  return (
    <section
      id="precios"
      className="relative w-full overflow-hidden bg-steel-950 py-24 sm:py-28 lg:py-32"
    >
      {/* Backdrop */}
      <div aria-hidden className="absolute inset-0 tread-plate opacity-40" />
      <div
        aria-hidden
        className="absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-safety-500/10 blur-[160px]"
      />

      <div className="relative mx-auto w-full max-w-7xl px-6 lg:px-10">
        {/* Header */}
        <div className="mx-auto max-w-3xl text-center">
          <span className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-safety-500">
            Planes de precios
          </span>
          <h2 className="mt-4 font-display text-[44px] leading-[0.95] tracking-[0.01em] text-foreground sm:text-[56px] lg:text-[64px]">
            ELIGE EL PLAN
            <br />
            QUE <span className="text-safety-500">MUEVE TU TALLER</span>.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-[15px] leading-7 text-zinc-400 sm:text-[16px] sm:leading-8">
            Sin contratos, sin permanencia y sin tarjeta para empezar. Activas,
            pruebas catorce días y sigues solo si SaturnLub te resuelve la
            operación.
          </p>
        </div>

        {/* Cards */}
        <div className="mt-16 grid items-stretch gap-6 lg:grid-cols-3 lg:gap-8">
          {PLANS.map((plan) => (
            <PlanCard key={plan.code} plan={plan} />
          ))}
        </div>

        {/* Disclaimer */}
        <p className="mt-12 text-center font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Precios en dólares · IVA no incluido · Cancelas cuando quieras
        </p>
      </div>
    </section>
  );
}

function PlanCard({ plan }: { plan: Plan }) {
  const highlighted = plan.highlighted;

  return (
    <div
      className={cn(
        "relative flex h-full flex-col overflow-hidden border-2 bg-steel-900 transition-all duration-200",
        highlighted
          ? "border-safety-500 shadow-safety-glow lg:scale-[1.04]"
          : "border-steel-700 hover:border-steel-500"
      )}
    >
      {/* Badge superior solo en el plan destacado */}
      {plan.badge ? (
        <div
          aria-hidden
          className="hazard-stripe h-1 w-full"
        />
      ) : null}

      {/* Header del plan */}
      <header
        className={cn(
          "flex items-start justify-between border-b border-steel-700 px-6 py-5",
          highlighted ? "bg-steel-900" : "bg-steel-900/70"
        )}
      >
        <div>
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
            Plan · {plan.code}
          </span>
          <h3 className="mt-2 font-display text-[28px] leading-none tracking-[0.02em] text-foreground">
            {plan.name.toUpperCase()}
          </h3>
        </div>
        {plan.badge ? (
          <span className="border border-safety-500 bg-safety-500/10 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-safety-500">
            {plan.badge}
          </span>
        ) : null}
      </header>

      {/* Precio */}
      <div className="px-6 pt-6">
        <p className="text-[12.5px] leading-5 text-zinc-400">{plan.tagline}</p>
        <div className="mt-4 flex items-end gap-2">
          <span
            className={cn(
              "font-display text-[56px] leading-none tracking-[0.01em] tabular-nums",
              highlighted ? "text-safety-500" : "text-foreground"
            )}
          >
            {plan.price}
          </span>
          <span className="pb-2 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            {plan.unit}
          </span>
        </div>
      </div>

      {/* Features */}
      <ul className="flex-1 space-y-3 px-6 py-6">
        {plan.features.map((f) => (
          <li
            key={f}
            className="flex items-start gap-3 text-[14px] leading-6 text-zinc-300"
          >
            <CheckIcon highlighted={highlighted} />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      {/* CTA */}
      <div className="border-t border-steel-700 px-6 py-5">
        <Link href={plan.ctaHref} className="block">
          <Button
            size="lg"
            variant={plan.ctaVariant}
            className="w-full"
          >
            {plan.cta}
          </Button>
        </Link>
      </div>
    </div>
  );
}

function CheckIcon({ highlighted }: { highlighted?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-sm",
        highlighted
          ? "bg-safety-500 text-steel-950"
          : "bg-steel-800 text-safety-500"
      )}
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </span>
  );
}
