import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import {
  InfrastructureTabs,
  type BranchRow,
  type WarehouseRow,
  type BranchOption,
} from "./infrastructure-tabs";

export const metadata: Metadata = { title: "Locales y Bodegas · Inventario" };
export const dynamic = "force-dynamic";

export default async function InfrastructuraPage() {
  const { user, membership } = await getActiveMembership();
  if (!user) redirect("/login");
  if (!membership) redirect("/onboarding");

  const supabase = await createClient();

  // Queries en paralelo — RLS filtra por tenant automáticamente.
  const [branchesRes, warehousesRes, branchOptionsRes] = await Promise.all([
    supabase
      .from("branches")
      .select("id, branch_name, is_active, created_at")
      .eq("is_active", true)
      .order("created_at", { ascending: false }),
    supabase
      .from("warehouses")
      .select(
        "id, name, branch_id, is_active, created_at, branches(branch_name)"
      )
      .eq("is_active", true)
      .order("created_at", { ascending: false }),
    supabase
      .from("branches")
      .select("id, branch_name")
      .eq("is_active", true)
      .order("branch_name"),
  ]);

  if (branchesRes.error) {
    console.error("InfrastructuraPage · branches:", branchesRes.error);
  }
  if (warehousesRes.error) {
    console.error("InfrastructuraPage · warehouses:", warehousesRes.error);
  }

  const branches = (branchesRes.data ?? []) as unknown as BranchRow[];
  const warehouses = (warehousesRes.data ?? []) as unknown as WarehouseRow[];
  const branchOptions = (branchOptionsRes.data ?? []) as unknown as BranchOption[];
  const canManage =
    membership.role === "owner" || membership.role === "admin";

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      <header className="space-y-2">
        <span className="hud-readout">Inventario · Infraestructura</span>
        <h1 className="font-display text-[36px] leading-none tracking-[0.02em] text-foreground sm:text-[42px]">
          LOCALES Y BODEGAS
        </h1>
        <p className="max-w-2xl text-[14px] leading-6 text-muted-foreground">
          Define los puntos físicos de tu negocio y dónde se almacena el stock.
          Cada movimiento de inventario se registra contra una bodega.
        </p>
      </header>

      <InfrastructureTabs
        branches={branches}
        warehouses={warehouses}
        branchOptions={branchOptions}
        canManage={canManage}
      />
    </div>
  );
}
