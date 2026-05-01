import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { daysBetween, formatDate } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Dashboard",
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

  const planName = tenant?.subscription_plans?.name ?? "Trial";
  const trialEndsAt = tenant?.trial_ends_at ?? null;
  const trialDaysLeft = trialEndsAt
    ? daysBetween(new Date(), new Date(trialEndsAt))
    : null;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      <section className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">Bienvenido</p>
        <h2 className="text-2xl font-semibold tracking-tight">
          Hola, {fullName}
        </h2>
        <p className="text-sm text-muted-foreground">
          Este es el centro operativo de{" "}
          <span className="font-medium text-foreground">
            {tenant?.business_name ?? "tu negocio"}
          </span>
          .
        </p>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Negocio</CardDescription>
            <CardTitle className="truncate">
              {tenant?.business_name ?? "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            saturnlub.app/{tenant?.slug ?? "tu-negocio"}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Plan actual</CardDescription>
            <CardTitle>{planName}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Estado:{" "}
            <span className="font-medium capitalize text-foreground">
              {tenant?.status ?? "trial"}
            </span>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Trial</CardDescription>
            <CardTitle>
              {trialDaysLeft !== null
                ? `${trialDaysLeft} día${trialDaysLeft === 1 ? "" : "s"} restantes`
                : "Sin trial activo"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {trialEndsAt
              ? `Vence el ${formatDate(trialEndsAt)}`
              : "Tu plan no tiene periodo de prueba."}
          </CardContent>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Próximos pasos</CardTitle>
            <CardDescription>
              Configura tu operación para empezar a registrar trabajos.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Step
              done
              title="Crear tu cuenta y negocio"
              description="Listo. Ya tienes un workspace en SaturnLub."
            />
            <Step
              title="Invita a tu equipo"
              description="Agrega técnicos y administradores para colaborar."
            />
            <Step
              title="Carga tu inventario inicial"
              description="Registra aceites, filtros y servicios frecuentes."
            />
            <Step
              title="Crea tu primera orden"
              description="Atiende un vehículo y emite el comprobante asociado."
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tu cuenta</CardTitle>
            <CardDescription>Datos de acceso a SaturnLub.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Nombre" value={fullName} />
            <Row label="Correo" value={user.email ?? "—"} />
            <Row label="Rol" value={membership.role ?? "owner"} />
          </CardContent>
        </Card>
      </section>
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
    <div className="flex items-start gap-3 rounded-lg border border-border p-3">
      <span
        className={
          done
            ? "mt-0.5 grid h-5 w-5 place-items-center rounded-full bg-emerald-100 text-emerald-700"
            : "mt-0.5 grid h-5 w-5 place-items-center rounded-full border border-border text-muted-foreground"
        }
        aria-hidden
      >
        {done ? (
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : null}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="truncate text-sm font-medium">{value}</span>
    </div>
  );
}
