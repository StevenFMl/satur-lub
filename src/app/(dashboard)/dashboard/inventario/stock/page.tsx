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
  // NOTA: usamos el nombre de la tabla (no de la columna FK) para evitar PGRST200
  // con foreign keys compuestas (tenant_id, product_id).
  const { data, error } = await supabase
    .from("inventory_balances")
    .select(
      `
      id,
      product_id,
      warehouse_id,
      quantity_on_hand,
      products ( id, name, sku, unit ),
      warehouses ( id, name )
      `
    )
    .order("quantity_on_hand", { ascending: true });

  if (error) {
    console.error("StockPage · inventory_balances query:", error);
  }

  const { data: rawProducts } = await supabase
    .from("products")
    .select("id, name, sku, cost_price")
    .eq("is_active", true)
    .order("name");

  const { data: rawWarehouses } = await supabase
    .from("warehouses")
    .select("id, name")
    .eq("is_active", true)
    .order("name");

  const products = rawProducts ?? [];
  const warehouses = rawWarehouses ?? [];

  // Aplanar los joins. Conservamos product_id/warehouse_id como claves duras
  // para construir links al kárdex sin depender del embed.
  const rows: StockRow[] = ((data ?? []) as unknown as RawBalance[]).map(
    (b) => ({
      id: b.id,
      product_id: b.product_id,
      warehouse_id: b.warehouse_id,
      warehouse_name:
        (b.warehouses as { id: string; name: string } | null)?.name ?? "—",
      product_name:
        (b.products as { id: string; name: string; sku: string; unit: string } | null)
          ?.name ?? "—",
      sku:
        (b.products as { id: string; name: string; sku: string; unit: string } | null)
          ?.sku ?? "—",
      unit:
        (b.products as { id: string; name: string; sku: string; unit: string } | null)
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

      <StockTable initialRows={rows} products={products} warehouses={warehouses} />
    </div>
  );
}

/** Tipado interno para el raw de Supabase antes de aplanar. */
type RawBalance = {
  id: string;
  product_id: string;
  warehouse_id: string;
  quantity_on_hand: number;
  products: { id: string; name: string; sku: string; unit: string } | null;
  warehouses: { id: string; name: string } | null;
};
