import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import {
  WarehousesTable,
  type WarehouseRow,
  type BranchOption,
} from "./warehouses-table";

export const metadata: Metadata = { title: "Bodegas · Inventario" };

export default async function BodegasPage() {
  const { user, membership } = await getActiveMembership();
  if (!user) redirect("/login");
  if (!membership) redirect("/onboarding");

  const supabase = await createClient();

  // RLS aísla por tenant; aquí solo aplicamos orden y joins de presentación.
  const [warehousesRes, branchesRes] = await Promise.all([
    supabase
      .from("warehouses")
      .select(
        "id, name, branch_id, is_active, created_at, branches:branch_id(branch_name)"
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("branches")
      .select("id, branch_name")
      .eq("is_active", true)
      .order("branch_name"),
  ]);

  const rows = ((warehousesRes.data ?? []) as unknown) as WarehouseRow[];
  const branches = ((branchesRes.data ?? []) as unknown) as BranchOption[];

  const canManage =
    membership.role === "owner" || membership.role === "admin";

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      <header className="space-y-2">
        <span className="hud-readout">Inventario · Catálogo</span>
        <h1 className="font-display text-[36px] leading-none tracking-[0.02em] text-foreground sm:text-[42px]">
          BODEGAS
        </h1>
        <p className="max-w-2xl text-[14px] leading-6 text-muted-foreground">
          Define dónde se almacena el stock. Cada movimiento de inventario
          (compras, ventas, traspasos) se registra contra una bodega.
        </p>
      </header>

      <WarehousesTable
        initialRows={rows}
        branches={branches}
        canManage={canManage}
      />
    </div>
  );
}
