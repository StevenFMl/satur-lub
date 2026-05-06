import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { PurchasesTable, type PurchaseRow } from "./purchases-table";

export const metadata: Metadata = { title: "Compras · Inventario" };
export const dynamic = "force-dynamic";

export default async function ComprasPage() {
  const { user, membership } = await getActiveMembership();
  if (!user) redirect("/login");
  if (!membership) redirect("/onboarding");

  const supabase = await createClient();

  // JOIN purchase_orders con business_partners para traer el nombre del proveedor.
  // Usamos nombre de tabla (no columna FK) para evitar PGRST200 en FK compuestas.
  const { data, error } = await supabase
    .from("purchase_orders")
    .select(
      `
      id,
      created_at,
      payment_method,
      payment_status,
      status,
      total,
      business_partners ( full_name )
      `
    )
    .order("created_at", { ascending: false });

  if (error) {
    console.error("ComprasPage · purchase_orders query:", error);
  }

  const rows: PurchaseRow[] = (
    (data ?? []) as unknown as RawPO[]
  ).map((po) => ({
    id: po.id,
    created_at: po.created_at,
    supplier_name:
      (po.business_partners as { full_name: string } | null)?.full_name ?? "—",
    payment_method: po.payment_method,
    payment_status: po.payment_status,
    status: po.status,
    total: Number(po.total ?? 0),
  }));

  const canManage =
    membership.role === "owner" || membership.role === "admin";

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      <header className="space-y-2">
        <span className="hud-readout">Inventario · Compras</span>
        <h1 className="font-display text-[36px] leading-none tracking-[0.02em] text-foreground sm:text-[42px]">
          HISTORIAL DE COMPRAS
        </h1>
        <p className="max-w-2xl text-[14px] leading-6 text-muted-foreground">
          Todas las órdenes de compra registradas. Si cometiste un error,
          puedes anular una compra recibida para revertir el inventario.
        </p>
      </header>

      <PurchasesTable initialRows={rows} canManage={canManage} />
    </div>
  );
}

/** Tipado interno para el raw de Supabase antes de aplanar. */
type RawPO = {
  id: string;
  created_at: string;
  payment_method: string | null;
  payment_status: string;
  status: string;
  total: number;
  business_partners: { full_name: string } | null;
};
