import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { StockTable, type StockRow } from "./stock-table";

export const metadata: Metadata = { title: "Existencias · Inventario" };
export const dynamic = "force-dynamic";

export default async function StockPage() {
  const { user, membership } = await getActiveMembership();
  if (!user) redirect("/login");
  if (!membership) redirect("/onboarding");

  const supabase = await createClient();

  // JOIN inventory_balances con products y warehouses.
  // RLS en inventory_balances filtra por tenant automáticamente.
  const { data, error } = await supabase
    .from("inventory_balances")
    .select(
      `
      id,
      quantity_on_hand,
      products:product_id ( name, sku, unit ),
      warehouses:warehouse_id ( name )
      `
    )
    .order("quantity_on_hand", { ascending: true });

  if (error) {
    console.error("StockPage · inventory_balances query:", error);
  }

  // Aplanar los joins en filas planas para el componente de tabla.
  const rows: StockRow[] = ((data ?? []) as unknown as RawBalance[]).map(
    (b) => ({
      id: b.id,
      warehouse_name:
        (b.warehouses as { name: string } | null)?.name ?? "—",
      product_name:
        (b.products as { name: string; sku: string; unit: string } | null)
          ?.name ?? "—",
      sku:
        (b.products as { name: string; sku: string; unit: string } | null)
          ?.sku ?? "—",
      unit:
        (b.products as { name: string; sku: string; unit: string } | null)
          ?.unit ?? "unidad",
      quantity_on_hand: Number(b.quantity_on_hand ?? 0),
    })
  );

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      <header className="space-y-2">
        <span className="hud-readout">Inventario · Control</span>
        <h1 className="font-display text-[36px] leading-none tracking-[0.02em] text-foreground sm:text-[42px]">
          EXISTENCIAS
        </h1>
        <p className="max-w-2xl text-[14px] leading-6 text-muted-foreground">
          Vista consolidada del stock por bodega. Los balances se actualizan
          automáticamente con cada compra, venta o traspaso registrado.
        </p>
      </header>

      <StockTable initialRows={rows} />
    </div>
  );
}

/** Tipado interno para el raw de Supabase antes de aplanar. */
type RawBalance = {
  id: string;
  quantity_on_hand: number;
  products: { name: string; sku: string; unit: string } | null;
  warehouses: { name: string } | null;
};
