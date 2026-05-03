import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { daysBetween, formatDate } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Panel de control",
};

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("tenant_memberships")
    .select(
      `
      role,
      tenants (
        id,
        business_name,
        slug,
        status,
        trial_ends_at,
        subscription_plans:plan_id ( name, code )
      )
    `
    )
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (!membership) redirect("/onboarding");

  const tenant = membership.tenants as unknown as {
    id: string;
    business_name: string;
    slug: string;
    status: string;
    trial_ends_at: string | null;
    subscription_plans: { name: string; code: string } | null;
  } | null;

  const fullName =
    (user.user_metadata?.full_name as string | undefined) ?? user.email ?? "—";

  const planName = tenant?.subscription_plans?.name ?? "Prueba";
  const trialEndsAt = tenant?.trial_ends_at ?? null;
  const trialDaysLeft = trialEndsAt
    ? daysBetween(new Date(), new Date(trialEndsAt))
    : null;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      {/* Hero */}
      <section className="space-y-3">
        <span className="hud-readout">Centro de operación</span>
        <h2 className="font-display text-[40px] leading-[0.95] tracking-[0.02em] text-foreground sm:text-[48px]">
          HOLA,{" "}
          <span className="text-safety-500">
            {fullName.split(" ")[0]?.toUpperCase()}
          </span>
          .
        </h2>
        <p className="max-w-2xl text-[14px] leading-7 text-muted-foreground">
          Este es el panel operativo de{" "}
          <span className="font-semibold text-foreground">
            {tenant?.business_name ?? "tu negocio"}
          </span>
          . Desde aquí gestionas órdenes, vehículos, inventario y cobranza.
        </p>
      </section>

      {/* KPIs principales */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Tile
          label="Negocio"
          value={tenant?.business_name ?? "—"}
          hint={`saturnlub.app/${tenant?.slug ?? "tu-negocio"}`}
        />
        <Tile
          label="Plan"
          value={planName}
          hint={`Estado · ${tenant?.status ?? "trial"}`}
        />
        <Tile
          label="Periodo de prueba"
          value={
            trialDaysLeft !== null
              ? `${trialDaysLeft} día${trialDaysLeft === 1 ? "" : "s"}`
              : "Sin prueba"
          }
          hint={
            trialEndsAt ? `Vence ${formatDate(trialEndsAt)}` : "Sin vencimiento"
          }
        />
      </section>

      {/* Próximos pasos + cuenta */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="panel rounded-sm lg:col-span-2">
          <div className="top-highlight flex items-center justify-between border-b border-steel-700 bg-steel-900/70 px-5 py-4">
            <h3 className="font-display text-[18px] leading-none tracking-[0.04em] text-foreground">
              PRÓXIMOS PASOS
            </h3>
            <span className="hud-readout">Configuración · 4 pasos</span>
          </div>
          <div className="space-y-2 px-5 py-5">
            <Step
              done
              title="Crear cuenta y negocio"
              description="Listo. Tu workspace en SaturnLub está activo."
            />
            <Step
              title="Invita a tu equipo"
              description="Agrega mecánicos, cobradores y administradores."
            />
            <Step
              title="Carga tu inventario inicial"
              description="Registra aceites, filtros y servicios frecuentes."
            />
            <Step
              title="Crea tu primera orden"
              description="Atiende un vehículo y emite el comprobante asociado."
            />
          </div>
        </div>

        <div className="panel rounded-sm">
          <div className="top-highlight flex items-center justify-between border-b border-steel-700 bg-steel-900/70 px-5 py-4">
            <h3 className="font-display text-[18px] leading-none tracking-[0.04em] text-foreground">
              TU CUENTA
            </h3>
            <span className="hud-readout">{membership.role ?? "owner"}</span>
          </div>
          <div className="space-y-3 px-5 py-5">
            <Row label="Nombre" value={fullName} />
            <Row label="Correo" value={user.email ?? "—"} mono />
            <Row
              label="Rol"
              value={(membership.role ?? "owner").toUpperCase()}
              mono
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="panel rounded-sm p-5 transition-colors duration-150 hover:border-steel-500">
      <p className="hud-readout">{label}</p>
      <p className="mt-2 truncate font-display text-[24px] leading-none tracking-[0.02em] text-foreground">
        {value}
      </p>
      <p className="mt-2 truncate font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {hint}
      </p>
    </div>
  );
}

function Step({
  title,
  description,
  done,
}: {
  title: string;
  description: string;
  done?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 border border-steel-700 bg-steel-950 p-3">
      <span
        className={
          done
            ? "mt-0.5 grid h-5 w-5 place-items-center rounded-sm bg-safety-500 text-steel-950"
            : "mt-0.5 grid h-5 w-5 place-items-center rounded-sm border border-steel-700 bg-steel-800 font-mono text-[10px] text-muted-foreground"
        }
        aria-hidden
      >
        {done ? (
          <svg
            viewBox="0 0 24 24"
            className="h-3 w-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          "·"
        )}
      </span>
      <div className="min-w-0">
        <p className="font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-foreground">
          {title}
        </p>
        <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-steel-700/60 pb-2 last:border-0 last:pb-0">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </span>
      <span
        className={
          mono
            ? "truncate font-mono text-[12.5px] font-semibold tracking-[0.02em] text-foreground"
            : "truncate text-[13px] font-semibold text-foreground"
        }
      >
        {value}
      </span>
    </div>
  );
}
