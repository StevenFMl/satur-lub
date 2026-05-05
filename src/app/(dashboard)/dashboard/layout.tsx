import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { Sidebar } from "@/components/dashboard/sidebar";
import { DashboardHeader } from "@/components/dashboard/header";
import { getActiveMembership } from "@/lib/supabase/membership";
import { isTrialBlocked, decodeJwtPayload, type AccessClaims } from "@/lib/supabase/access-claims";
import { createClient } from "@/lib/supabase/server";

/**
 * Layout específico de `/dashboard/*`. Carga el chrome (sidebar + header) y
 * fuerza:
 *  - `/onboarding` si el usuario no tiene tenant activo.
 *  - `/upgrade`    si el trial expiró o la suscripción está delinquent.
 *
 * El guard de sesión vive en `(dashboard)/layout.tsx`. Esto duplica el
 * trial-guard del middleware solo cuando el JWT custom hook todavía no está
 * activado en Supabase (defensa en profundidad).
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const claims = session?.access_token
    ? decodeJwtPayload<AccessClaims>(session.access_token)
    : null;

  const { user, membership, trial } = await getActiveMembership();
  if (!user) redirect("/login");

  if (!claims?.tenant_id) {
    if (membership) {
      await supabase.auth.refreshSession();
    } else {
      redirect("/onboarding");
    }
  } else {
    if (!membership) redirect("/onboarding");
  }

  if (isTrialBlocked(trial)) redirect("/upgrade");

  const fullName =
    (user.user_metadata?.full_name as string | undefined) ??
    user.email ??
    "Usuario";

  const headersList = await headers();
  const activePath =
    headersList.get("x-pathname") ??
    headersList.get("x-invoke-path") ??
    "/dashboard";

  return (
    <div className="garage-backdrop flex min-h-dvh">
      <Sidebar activePath={activePath} />
      <div className="flex min-w-0 flex-1 flex-col">
        <DashboardHeader
          businessName={membership.tenants?.business_name ?? "Mi negocio"}
          userName={fullName}
          userEmail={user.email ?? ""}
          role={membership.role ?? "owner"}
        />
        <main className="flex-1 px-6 py-8 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
