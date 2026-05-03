"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Billing = "monthly" | "yearly";

type Plan = {
  code: string;
  name: string;
  tagline: string;
  /** Precio mensual base — el cobro anual aplica 20% off automáticamente. */
  priceMonthly: number;
  /** Si está fijado, ignora el cálculo (p. ej. plan gratis o "contactar"). */
  priceFixed?: string;
  unitMonthly: string;
  unitYearly: string;
  cta: string;
  ctaHref: string;
  ctaVariant: "primary" | "outline" | "rust";
  features: string[];
  highlighted?: boolean;
  badge?: string;
};

const YEARLY_DISCOUNT = 0.2; // 20%

const PLANS: Plan[] = [
  {
    code: "01",
    name: "Inicial",
    tagline: "Para empezar a operar el primer día.",
    priceMonthly: 0,
    priceFixed: "$ 0",
    unitMonthly: "/ por 14 días",
    unitYearly: "/ por 14 días",
    cta: "Comenzar gratis",
    ctaHref: "/register",
    ctaVariant: "outline",
    features: [
      "1 sucursal · 2 usuarios",
      "Órdenes de trabajo ilimitadas",
      "Ficha por vehículo y cliente",
      "Inventario básico (200 SKUs)",
      "Caja diaria y arqueo",
      "Soporte por correo",
    ],
  },
  {
    code: "02",
    name: "Estándar",
    tagline: "Para talleres operando todos los días.",
    priceMonthly: 39,
    unitMonthly: "USD / mes por sucursal",
    unitYearly: "USD / mes facturado anual",
    cta: "Activar Estándar",
    ctaHref: "/register?plan=estandar",
    ctaVariant: "primary",
    badge: "Recomendado",
    highlighted: true,
    features: [
      "1 sucursal · 8 usuarios",
      "Todo lo del plan Inicial",
      "Inventario sin límite de SKUs",
      "Roles avanzados (mecánico, cobrador, admin)",
      "Reportes operativos y de caja",
      "Facturación electrónica SRI ilimitada",
      "Soporte prioritario por WhatsApp",
    ],
  },
  {
    code: "03",
    name: "Multi-sucursal",
    tagline: "Para grupos con dos o más locales.",
    priceMonthly: 89,
    unitMonthly: "USD / mes total",
    unitYearly: "USD / mes facturado anual",
    cta: "Hablar con ventas",
    ctaHref: "#contacto",
    ctaVariant: "rust",
    features: [
      "Sucursales y usuarios sin límite",
      "Todo lo del plan Estándar",
      "Consolidado entre sucursales",
      "Permisos granulares por local",
      "Exportes contables programados",
      "Onboarding asistido por nuestro equipo",
    ],
  },
];

export function PricingSection() {
  const [billing, setBilling] = useState<Billing>("monthly");

  return (
    <section
      id="precios"
      className="relative w-full overflow-hidden bg-zinc-950 py-20 sm:py-24 lg:py-32"
    >
      {/* Backdrop */}
      <div aria-hidden className="absolute inset-0 tread-plate opacity-30" />
      <div
        aria-hidden
        className="absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-safety-500/10 blur-[160px]"
      />

      <div className="relative mx-auto w-full max-w-7xl px-6 lg:px-10">
        {/* Header */}
        <div className="mx-auto max-w-3xl text-center">
          <span className="text-[12px] font-bold uppercase tracking-[0.22em] text-safety-500">
            Planes y precios
          </span>
          <h2 className="mt-4 font-display text-[44px] leading-[0.95] tracking-[0.01em] text-white sm:text-[56px] lg:text-[64px]">
            Elige el plan que
            <br />
            <span className="text-safety-500">mueve tu taller.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-[15px] leading-7 text-zinc-400 sm:text-[16px] sm:leading-8">
            Sin contratos, sin permanencia y sin tarjeta para empezar. Activas,
            pruebas catorce días y sigues solo si SaturnLub te resuelve la
            operación.
          </p>
        </div>

        {/* Toggle Mensual / Anual */}
        <div className="mt-10 flex items-center justify-center">
          <BillingToggle value={billing} onChange={setBilling} />
        </div>

        {/* Cards */}
        <div className="mt-12 grid items-stretch gap-6 lg:grid-cols-3 lg:gap-8">
          {PLANS.map((plan) => (
            <PlanCard key={plan.code} plan={plan} billing={billing} />
          ))}
        </div>

        {/* Disclaimer */}
        <p className="mt-12 text-center text-[12px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
          Precios en dólares · IVA no incluido · Cancelas cuando quieras
        </p>
      </div>
    </section>
  );
}

/* -------------------------------- TOGGLE -------------------------------- */

function BillingToggle({
  value,
  onChange,
}: {
  value: Billing;
  onChange: (v: Billing) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Frecuencia de pago"
      className="inline-flex items-center gap-1 rounded-sm border border-zinc-800 bg-zinc-900 p-1 shadow-bevel-sm"
    >
      <ToggleButton
        active={value === "monthly"}
        onClick={() => onChange("monthly")}
      >
        Mensual
      </ToggleButton>
      <ToggleButton
        active={value === "yearly"}
        onClick={() => onChange("yearly")}
      >
        <span>Anual</span>
        <span
          className={cn(
            "ml-2 inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] transition-colors duration-200",
            value === "yearly"
              ? "border-zinc-950/30 bg-zinc-950/15 text-zinc-950"
              : "border-safety-500/40 bg-safety-500/10 text-safety-500"
          )}
        >
          <Sparkles className="h-3 w-3" />
          -20%
        </span>
      </ToggleButton>
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-10 items-center rounded-sm px-5 text-[13px] font-bold uppercase tracking-[0.14em] transition-all duration-200 ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900",
        active
          ? "bg-safety-500 text-zinc-950 shadow-bevel-sm"
          : "text-zinc-400 hover:text-zinc-100"
      )}
    >
      {children}
    </button>
  );
}

/* --------------------------------- CARD --------------------------------- */

function PlanCard({ plan, billing }: { plan: Plan; billing: Billing }) {
  const highlighted = plan.highlighted;

  // Cálculo de precio
  const displayPrice = plan.priceFixed
    ? plan.priceFixed
    : billing === "yearly"
      ? `$ ${Math.round(plan.priceMonthly * (1 - YEARLY_DISCOUNT))}`
      : `$ ${plan.priceMonthly}`;

  const displayUnit =
    billing === "yearly" ? plan.unitYearly : plan.unitMonthly;

  return (
    <div
      className={cn(
        "relative flex h-full flex-col overflow-hidden border-2 bg-zinc-900 transition-all duration-200",
        highlighted
          ? "border-safety-500 shadow-safety-glow lg:scale-[1.04]"
          : "border-zinc-800 hover:border-zinc-600"
      )}
    >
      {/* Top stripe amarilla solo en destacado */}
      {highlighted ? (
        <div aria-hidden className="h-1 w-full bg-safety-500" />
      ) : null}

      {/* Header del plan */}
      <header
        className={cn(
          "flex items-start justify-between gap-3 border-b border-zinc-800 px-6 py-5",
          highlighted ? "bg-zinc-900" : "bg-zinc-900/60"
        )}
      >
        <div>
          <h3 className="font-display text-[28px] leading-none tracking-[0.02em] text-white">
            {plan.name}
          </h3>
          <p className="mt-2 text-[12.5px] leading-5 text-zinc-400">
            {plan.tagline}
          </p>
        </div>
        {plan.badge ? (
          <span className="shrink-0 border border-safety-500 bg-safety-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-safety-500">
            {plan.badge}
          </span>
        ) : null}
      </header>

      {/* Precio */}
      <div className="px-6 pt-7">
        <div className="flex items-end gap-2">
          <span
            className={cn(
              "font-display text-[56px] leading-none tracking-[0.01em] tabular-nums",
              highlighted ? "text-safety-500" : "text-white"
            )}
          >
            {displayPrice}
          </span>
          <span className="pb-2 text-[11.5px] font-bold uppercase tracking-[0.16em] text-zinc-500">
            {displayUnit}
          </span>
        </div>
        {!plan.priceFixed && billing === "yearly" ? (
          <p className="mt-2 text-[11.5px] font-semibold uppercase tracking-[0.16em] text-safety-500">
            Ahorras un 20% facturando anual
          </p>
        ) : null}
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
      <div className="border-t border-zinc-800 px-6 py-5">
        <Link href={plan.ctaHref} className="block">
          <Button size="lg" variant={plan.ctaVariant} className="w-full">
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
          ? "bg-safety-500 text-zinc-950"
          : "bg-zinc-800 text-safety-500"
      )}
    >
      <Check className="h-3 w-3" strokeWidth={3.5} />
    </span>
  );
}
