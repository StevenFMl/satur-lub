import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { getActiveMembership } from "@/lib/supabase/membership";
import { logoutAction } from "@/actions/auth";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Actualiza tu plan",
};

export default async function UpgradePage() {
  const { user, membership, trial } = await getActiveMembership();
  if (!user) redirect("/login");
  if (!membership) redirect("/onboarding");
  if (trial.kind === "active" || trial.kind === "trialing") {
    redirect("/dashboard");
  }

  const tenant = membership.tenants;
  const businessName = tenant?.business_name ?? "tu negocio";

  const headline =
    trial.kind === "delinquent"
      ? "TU SUSCRIPCIÓN ESTÁ INACTIVA."
      : "TU PRUEBA EXPIRÓ.";

  const sub =
    trial.kind === "delinquent"
      ? `El plan de ${businessName} quedó como "${trial.reason}". Renueva para reactivar la operación.`
      : trial.kind === "expired" && trial.endsAt.getTime() > 0
        ? `Los 14 días de prueba terminaron el ${formatDate(trial.endsAt.toISOString())}. Activa un plan para retomar la operación.`
        : "Activa un plan para retomar la operación de tu negocio.";

  return (
    <div className="garage-backdrop relative flex min-h-dvh flex-col">
      <div aria-hidden className="hazard-stripe h-1 w-full opacity-90" />

      <header className="relative z-10 border-b border-steel-700/80 bg-steel-900/50 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-6 xl:px-8">
          <Link
            href="/"
            aria-label="Inicio"
            className="inline-flex rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Logo />
          </Link>
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-sm font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground transition-colors duration-150 hover:text-rust-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Cerrar sesión
            </button>
          </form>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-10 sm:py-14 lg:py-16 xl:px-8">
        {/* Hero — estado del trial */}
        <section className="space-y-4">
          <span className="hud-readout">
            {trial.kind === "delinquent" ? "Suscripción · inactiva" : "Periodo de prueba · vencido"}
          </span>
          <h1 className="font-display text-[40px] leading-[0.95] tracking-[0.02em] text-foreground sm:text-[52px] lg:text-[60px]">
            {headline.split(" ").slice(0, -1).join(" ")}{" "}
            <span className="text-safety-500">
              {headline.split(" ").slice(-1)[0]}
            </span>
          </h1>
          <p className="max-w-2xl text-[14.5px] leading-7 text-muted-foreground">
            {sub}
          </p>
        </section>

        {/* Banner de estado */}
        <section className="mt-8">
          <div className="panel rounded-sm border-l-4 border-l-rust-500">
            <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="space-y-1">
                <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-rust-400">
                  ACCESO BLOQUEADO
                </p>
                <p className="text-[13.5px] leading-5 text-foreground">
                  El panel operativo de{" "}
                  <span className="font-semibold">{businessName}</span> está
                  pausado. Tus datos están intactos.
                </p>
              </div>
              <span className="hud-readout shrink-0 self-start sm:self-center">
                Estado · {membership.tenants?.subscription_status?.toUpperCase() ?? "TRIAL"}
              </span>
            </div>
          </div>
        </section>

        {/* Planes disponibles */}
        <section className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2">
          <PlanCard
            badge="01"
            name="Básico"
            tagline="Para 1 taller que ya opera todos los días."
            price="$ 39"
            unit="USD / mes"
            features={[
              "1 sucursal · hasta 3 usuarios",
              "Órdenes de trabajo ilimitadas",
              "Inventario hasta 500 SKUs",
              "Caja diaria y arqueo de turno",
              "Facturación electrónica SRI",
              "Soporte por correo",
            ]}
            ctaLabel="Activar Básico"
            ctaHref={`mailto:soporte@saturnlub.app?subject=Activar%20plan%20B%C3%A1sico%20-%20${encodeURIComponent(businessName)}`}
            variant="outline"
          />
          <PlanCard
            highlighted
            badge="02"
            name="Estándar"
            tagline="Para talleres en crecimiento con varias sucursales."
            price="$ 89"
            unit="USD / mes"
            features={[
              "Hasta 3 sucursales · usuarios ilimitados",
              "Todo lo del plan Básico",
              "Inventario sin límite de SKUs",
              "Control de lotes, costos y márgenes",
              "Roles avanzados (mecánico, cobrador, admin)",
              "Facturación SRI ilimitada con envío automático",
              "Soporte prioritario por WhatsApp",
            ]}
            ctaLabel="Activar Estándar"
            ctaHref={`mailto:soporte@saturnlub.app?subject=Activar%20plan%20Est%C3%A1ndar%20-%20${encodeURIComponent(businessName)}`}
            variant="primary"
          />
        </section>

        {/* Footer block */}
        <section className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="panel rounded-sm px-5 py-4">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              ¿Necesitas un plan a medida?
            </p>
            <p className="mt-2 text-[13px] leading-5 text-foreground">
              Si tu operación supera 3 sucursales o requieres integración
              custom, hablemos del plan Enterprise.
            </p>
            <Link
              href="/#pricing"
              className="mt-3 inline-flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-safety-500 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Ver todos los planes →
            </Link>
          </div>
          <div className="panel rounded-sm px-5 py-4">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              ¿Ya pagaste un plan?
            </p>
            <p className="mt-2 text-[13px] leading-5 text-foreground">
              La activación es manual mientras integramos pasarela de pago.
              Escríbenos y te activamos en menos de 1 hora hábil.
            </p>
            <a
              href="mailto:soporte@saturnlub.app"
              className="mt-3 inline-flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-rust-400 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Contactar soporte →
            </a>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-steel-700/80 bg-steel-900/50">
        <div className="mx-auto w-full max-w-7xl px-6 py-4 xl:px-8">
          <p className="industrial-label !text-[10px]">
            © {new Date().getFullYear()} SATURNLUB · SISTEMA OPERATIVO INDUSTRIAL
          </p>
        </div>
      </footer>
    </div>
  );
}

function PlanCard({
  badge,
  name,
  tagline,
  price,
  unit,
  features,
  ctaLabel,
  ctaHref,
  variant,
  highlighted,
}: {
  badge: string;
  name: string;
  tagline: string;
  price: string;
  unit: string;
  features: string[];
  ctaLabel: string;
  ctaHref: string;
  variant: "primary" | "outline";
  highlighted?: boolean;
}) {
  return (
    <div
      className={
        highlighted
          ? "panel panel-bolts relative overflow-hidden rounded-sm border-safety-500/40 shadow-[0_0_0_1px_rgba(255,193,7,0.25),0_16px_40px_-12px_rgba(0,0,0,0.5)]"
          : "panel relative overflow-hidden rounded-sm"
      }
    >
      {highlighted ? (
        <span aria-hidden className="bolt-bl" />
      ) : null}
      {highlighted ? <span aria-hidden className="bolt-br" /> : null}

      <div className="top-highlight flex items-center justify-between border-b border-steel-700 bg-steel-900/70 px-5 py-4">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className={
              highlighted
                ? "grid h-7 w-7 place-items-center rounded-sm bg-safety-500 font-mono text-[10px] font-bold text-steel-950"
                : "grid h-7 w-7 place-items-center rounded-sm border border-steel-700 bg-steel-800 font-mono text-[10px] font-bold text-muted-foreground"
            }
          >
            {badge}
          </span>
          <h2 className="font-display text-[20px] leading-none tracking-[0.04em] text-foreground sm:text-[22px]">
            {name.toUpperCase()}
          </h2>
        </div>
        {highlighted ? (
          <span className="hud-readout text-safety-500">Recomendado</span>
        ) : null}
      </div>

      <div className="space-y-5 px-5 py-6 sm:px-6">
        <p className="text-[13px] leading-5 text-muted-foreground">
          {tagline}
        </p>

        <div className="flex items-baseline gap-2">
          <span className="font-display text-[40px] leading-none tracking-[0.02em] text-foreground">
            {price}
          </span>
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {unit}
          </span>
        </div>

        <ul className="space-y-2.5 border-t border-steel-700/60 pt-5">
          {features.map((f) => (
            <li
              key={f}
              className="flex items-start gap-2.5 text-[13px] leading-5 text-zinc-300"
            >
              <span
                aria-hidden
                className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-sm border border-safety-500/40 bg-safety-500/10"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-2.5 w-2.5 text-safety-500"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
              {f}
            </li>
          ))}
        </ul>

        <a
          href={ctaHref}
          className={
            variant === "primary"
              ? "relative flex h-12 w-full items-center justify-center overflow-hidden rounded-sm border border-black/50 bg-safety-500 px-6 font-semibold uppercase tracking-[0.14em] text-[14px] text-steel-950 shadow-bevel-sm transition-all duration-150 ease-out hover:bg-safety-400 hover:shadow-safety-glow active:translate-y-[2px] active:bg-safety-600 active:shadow-industrial-pressed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              : "relative flex h-12 w-full items-center justify-center overflow-hidden rounded-sm border-2 border-steel-600 bg-transparent px-6 font-semibold uppercase tracking-[0.14em] text-[14px] text-foreground transition-all duration-150 ease-out hover:border-steel-500 hover:bg-steel-800 hover:text-safety-500 active:bg-steel-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          }
        >
          {variant === "primary" ? (
            <span
              aria-hidden
              className="metal-gradient pointer-events-none absolute inset-0"
            />
          ) : null}
          <span className="relative">{ctaLabel}</span>
        </a>
      </div>
    </div>
  );
}
