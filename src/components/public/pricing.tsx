"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Check,
  Code2,
  GraduationCap,
  HeadphonesIcon,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  UserCog,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Billing = "monthly" | "yearly";
type View = "standard" | "enterprise";

type Plan = {
  code: string;
  name: string;
  tagline: string;
  /** Precio mensual base — el cobro anual aplica `YEARLY_DISCOUNT` automáticamente. */
  priceMonthly: number;
  /** Si está fijado, ignora el cálculo (p. ej. plan gratis). */
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

const STANDARD_PLANS: Plan[] = [
  {
    code: "01",
    name: "Prueba Gratis",
    tagline: "Para probar SaturnLub sin compromiso.",
    priceMonthly: 0,
    priceFixed: "$ 0",
    unitMonthly: "/ por 14 días",
    unitYearly: "/ por 14 días",
    cta: "Comenzar gratis",
    ctaHref: "/register",
    ctaVariant: "outline",
    features: [
      "1 sucursal · 2 usuarios",
      "14 días de prueba completa",
      "Sin tarjeta de crédito",
      "Órdenes de trabajo ilimitadas",
      "Ficha por vehículo y cliente",
      "Soporte por correo",
    ],
  },
  {
    code: "02",
    name: "Básico",
    tagline: "Para 1 taller que ya opera todos los días.",
    priceMonthly: 39,
    unitMonthly: "USD / mes",
    unitYearly: "USD / mes facturado anual",
    cta: "Activar Básico",
    ctaHref: "/register?plan=basico",
    ctaVariant: "outline",
    features: [
      "1 sucursal · hasta 3 usuarios",
      "Órdenes de trabajo ilimitadas",
      "Inventario hasta 500 SKUs",
      "Caja diaria y arqueo de turno",
      "Facturación electrónica SRI",
      "Reportes operativos básicos",
      "Soporte por correo",
    ],
  },
  {
    code: "03",
    name: "Estándar",
    tagline: "Para talleres en crecimiento con varias sucursales.",
    priceMonthly: 89,
    unitMonthly: "USD / mes",
    unitYearly: "USD / mes facturado anual",
    cta: "Activar Estándar",
    ctaHref: "/register?plan=estandar",
    ctaVariant: "primary",
    badge: "Más popular",
    highlighted: true,
    features: [
      "Hasta 3 sucursales · usuarios ilimitados",
      "Todo lo del plan Básico",
      "Inventario sin límite de SKUs",
      "Control avanzado: lotes, costos y márgenes",
      "Roles avanzados (mecánico, cobrador, admin)",
      "Reportes consolidados por sucursal",
      "Facturación SRI ilimitada con envío automático",
      "Soporte prioritario por WhatsApp",
    ],
  },
];

type EnterpriseBenefit = {
  icon: React.ReactNode;
  title: string;
  body: string;
};

const ENTERPRISE_BENEFITS: EnterpriseBenefit[] = [
  {
    icon: <ShieldCheck className="h-5 w-5" />,
    title: "SLA garantizado",
    body: "Disponibilidad 99,9% con compromiso contractual y reportes mensuales.",
  },
  {
    icon: <UserCog className="h-5 w-5" />,
    title: "Gerente de cuenta",
    body: "Una persona dedicada que conoce tu operación y responde por escalado directo.",
  },
  {
    icon: <HeadphonesIcon className="h-5 w-5" />,
    title: "Soporte dedicado 24/7",
    body: "Línea directa para tu equipo, sin pasar por colas. Respuesta en minutos.",
  },
  {
    icon: <Sparkles className="h-5 w-5" />,
    title: "Migración personalizada",
    body: "Importamos tu data desde Excel, sistemas legados o cuadernos. Sin cortes.",
  },
  {
    icon: <Code2 className="h-5 w-5" />,
    title: "API directa",
    body: "Integraciones a medida con tu ERP, contabilidad o sistemas de facturación.",
  },
  {
    icon: <GraduationCap className="h-5 w-5" />,
    title: "Capacitación presencial",
    body: "Tu equipo aprende de la mano de los nuestros, en tus locales.",
  },
];

/* ============================================================================ */
/*                                  SECTION                                     */
/* ============================================================================ */

export function PricingSection() {
  const [view, setView] = useState<View>("standard");
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

        {/* Tab principal: Estándar vs Empresas */}
        <div className="mt-10 flex items-center justify-center">
          <ViewTabs value={view} onChange={setView} />
        </div>

        {/* Toggle Mensual/Anual — solo en vista Estándar */}
        {view === "standard" ? (
          <div className="mt-6 flex items-center justify-center">
            <BillingToggle value={billing} onChange={setBilling} />
          </div>
        ) : null}

        {/* Renderizado condicional de la vista */}
        {view === "standard" ? (
          <StandardView billing={billing} />
        ) : (
          <EnterpriseView />
        )}

        {/* Disclaimer */}
        <p className="mt-12 text-center text-[12px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
          {view === "standard"
            ? "Precios en dólares · IVA no incluido · Cancelas cuando quieras"
            : "Cotización personalizada según el tamaño y operación de tu red"}
        </p>
      </div>
    </section>
  );
}

/* ============================================================================ */
/*                              VISTA: ESTÁNDAR                                 */
/* ============================================================================ */

function StandardView({ billing }: { billing: Billing }) {
  return (
    <div className="mt-10 grid items-stretch gap-6 lg:grid-cols-3 lg:gap-8">
      {STANDARD_PLANS.map((plan) => (
        <PlanCard key={plan.code} plan={plan} billing={billing} />
      ))}
    </div>
  );
}

/* ============================================================================ */
/*                              VISTA: EMPRESAS                                 */
/* ============================================================================ */

function EnterpriseView() {
  return (
    <div className="relative mx-auto mt-12 max-w-5xl">
      {/* Halo de acento detrás de la card */}
      <div
        aria-hidden
        className="absolute -inset-6 -z-10 bg-rust-500/10 blur-3xl"
      />

      <article className="relative overflow-hidden border-2 border-rust-500/60 bg-zinc-900 shadow-bevel transition-all duration-200 hover:border-rust-500">
        {/* Top stripe rust */}
        <div aria-hidden className="h-1.5 w-full bg-rust-500" />

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_1.5fr] lg:gap-0">
          {/* Lado izquierdo: copy + precio + CTA */}
          <div className="flex flex-col justify-between gap-10 border-b border-zinc-800 px-8 py-10 sm:px-10 sm:py-12 lg:border-b-0 lg:border-r lg:border-zinc-800 lg:px-10 lg:py-14">
            <div>
              <span className="inline-flex items-center gap-1.5 border border-rust-500/40 bg-rust-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-rust-400">
                <Sparkles className="h-3 w-3" />
                Empresas
              </span>

              <h3 className="mt-5 font-display text-[40px] leading-[0.95] tracking-[0.02em] text-white sm:text-[48px]">
                Para redes y
                <br />
                <span className="text-rust-500">franquicias.</span>
              </h3>

              <p className="mt-5 text-[15px] leading-7 text-zinc-400">
                Diseñado para grupos con 4 o más sucursales que necesitan
                control consolidado, integración con sus sistemas existentes y
                acompañamiento humano del primer al último día.
              </p>
            </div>

            <div>
              <span className="font-display text-[60px] leading-none tracking-[0.01em] text-rust-500">
                A medida
              </span>
              <p className="mt-3 text-[12px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                Cotización personalizada según tu operación
              </p>

              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="https://wa.me/593990000000"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="sm:flex-1"
                >
                  <Button size="xl" variant="rust" className="w-full">
                    <MessageCircle className="h-4 w-4" />
                    Hablar con un asesor
                  </Button>
                </Link>
                <Link href="#contacto" className="sm:min-w-[160px]">
                  <Button size="xl" variant="outline" className="w-full">
                    Ver contacto
                  </Button>
                </Link>
              </div>
            </div>
          </div>

          {/* Lado derecho: beneficios — padding generoso + grid interna 1/2 col */}
          <div className="flex flex-col bg-zinc-950/40 p-8 sm:p-10 lg:p-10">
            <h4 className="text-[12px] font-bold uppercase tracking-[0.22em] text-rust-400">
              Incluye todo lo del plan Estándar más
            </h4>

            <ul className="mt-7 grid flex-1 grid-cols-1 gap-6 sm:grid-cols-2">
              {ENTERPRISE_BENEFITS.map((b) => (
                <EnterpriseBenefitItem key={b.title} {...b} />
              ))}
            </ul>
          </div>
        </div>
      </article>
    </div>
  );
}

function EnterpriseBenefitItem({ icon, title, body }: EnterpriseBenefit) {
  return (
    <li className="group/eb flex items-start gap-3">
      <div className="grid h-10 w-10 shrink-0 place-items-center border border-rust-500/30 bg-rust-500/10 text-rust-400 transition-colors duration-200 group-hover/eb:border-rust-500 group-hover/eb:bg-rust-500 group-hover/eb:text-white">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <h5 className="text-[14px] font-bold leading-tight text-white">
          {title}
        </h5>
        <p className="mt-1.5 text-[12.5px] leading-[1.55] text-zinc-400">
          {body}
        </p>
      </div>
    </li>
  );
}

/* ============================================================================ */
/*                              CONTROLES (TABS / TOGGLE)                        */
/* ============================================================================ */

function ViewTabs({
  value,
  onChange,
}: {
  value: View;
  onChange: (v: View) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Tipo de cliente"
      className="inline-flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900 p-1 shadow-bevel-sm"
    >
      <PillTab
        active={value === "standard"}
        onClick={() => onChange("standard")}
      >
        Estándar
      </PillTab>
      <PillTab
        active={value === "enterprise"}
        onClick={() => onChange("enterprise")}
      >
        Empresas
      </PillTab>
    </div>
  );
}

function PillTab({
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
        "inline-flex h-11 items-center rounded-full px-7 text-[13px] font-bold uppercase tracking-[0.14em] transition-all duration-200 ease-out",
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

/* ============================================================================ */
/*                                 PLAN CARD                                    */
/* ============================================================================ */

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
          ? "border-safety-500 shadow-safety-glow lg:scale-[1.05]"
          : "border-zinc-800 hover:border-zinc-600"
      )}
    >
      {/* Top stripe amarilla solo en destacado */}
      {highlighted ? (
        <div aria-hidden className="h-1.5 w-full bg-safety-500" />
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
          <span className="inline-flex shrink-0 items-center gap-1 border border-safety-500 bg-safety-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-safety-500">
            <Sparkles className="h-3 w-3" />
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
