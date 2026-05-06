import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { BranchesTable, type BranchRow } from "./branches-table";

export const metadata: Metadata = { title: "Sucursales · Configuración" };
export const dynamic = "force-dynamic";

export default async function SucursalesPage() {
  const { user, membership } = await getActiveMembership();
  if (!user) redirect("/login");
  if (!membership) redirect("/onboarding");

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("branches")
    .select("id, branch_name, is_active, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("SucursalesPage · branches query:", error);
  }

  const rows = ((data ?? []) as unknown) as BranchRow[];
  const canManage =
    membership.role === "owner" || membership.role === "admin";

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      <header className="space-y-2">
        <span className="hud-readout">Configuración · Negocio</span>
        <h1 className="font-display text-[36px] leading-none tracking-[0.02em] text-foreground sm:text-[42px]">
          SUCURSALES
        </h1>
        <p className="max-w-2xl text-[14px] leading-6 text-muted-foreground">
          Define los puntos físicos donde opera tu negocio. Cada bodega y cada
          venta puede asociarse a una sucursal.
        </p>
      </header>

      <BranchesTable initialRows={rows} canManage={canManage} />
    </div>
  );
}
