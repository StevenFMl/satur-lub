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
      products ( id, name, sku, unit, average_cost, last_purchase_cost, default_price, tax_rate, has_tax, reorder_point ),
      warehouses ( id, name )
      `
    )
    .order("quantity_on_hand", { ascending: true });

  if (error) {
    console.error("StockPage · inventory_balances query:", error);
  }

  const { data: rawPresentations } = await supabase
    .from("product_presentations")
    .select("product_id, unit_label, base_qty, sort_order")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  const presentationsByProduct = new Map<string, { unit_label: string; base_qty: number }[]>();
  for (const p of rawPresentations ?? []) {
    const key = p.product_id as string;
    if (!presentationsByProduct.has(key)) presentationsByProduct.set(key, []);
    presentationsByProduct.get(key)!.push({
      unit_label: p.unit_label as string,
      base_qty: Number(p.base_qty),
    });
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

  type RawProduct = {
    id: string; name: string; sku: string; unit: string;
    average_cost: number | null;
    last_purchase_cost: number | null;
    default_price: number | null;
    tax_rate: number | null;
    has_tax: boolean | null;
    reorder_point: number | null;
  };

  // Aplanar los joins. Conservamos product_id/warehouse_id como claves duras
  // para construir links al kárdex sin depender del embed.
  const rows: StockRow[] = ((data ?? []) as unknown as RawBalance[]).map(
    (b) => {
      const p = b.products as RawProduct | null;
      return {
        id: b.id,
        product_id: b.product_id,
        warehouse_id: b.warehouse_id,
        warehouse_name: (b.warehouses as { id: string; name: string } | null)?.name ?? "—",
        product_name: p?.name ?? "—",
        sku: p?.sku ?? "—",
        unit: p?.unit ?? "unidad",
        quantity_on_hand: Number(b.quantity_on_hand ?? 0),
        average_cost: p?.average_cost != null ? Number(p.average_cost) : null,
        last_purchase_cost: p?.last_purchase_cost != null ? Number(p.last_purchase_cost) : null,
        sale_price:    p?.default_price != null ? Number(p.default_price) : null,
        tax_rate:      Number(p?.tax_rate ?? 15),
        has_tax:       p?.has_tax ?? true,
        reorder_point: Number(p?.reorder_point ?? 0),
        presentations: presentationsByProduct.get(b.product_id) ?? [],
      };
    }
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

type RawBalance = {
  id: string;
  product_id: string;
  warehouse_id: string;
  quantity_on_hand: number;
  products: unknown;
  warehouses: { id: string; name: string } | null;
};
