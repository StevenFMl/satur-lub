import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/dashboard/sidebar";
import { DashboardHeader } from "@/components/dashboard/header";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, tenants(business_name)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (!membership) redirect("/onboarding");

  const tenant = (membership.tenants as unknown as { business_name: string } | null) ?? null;

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
    <div className="flex min-h-dvh bg-muted/30">
      <Sidebar activePath={activePath} />
      <div className="flex min-w-0 flex-1 flex-col">
        <DashboardHeader
          businessName={tenant?.business_name ?? "Mi negocio"}
          userName={fullName}
          userEmail={user.email ?? ""}
        />
        <main className="flex-1 px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
