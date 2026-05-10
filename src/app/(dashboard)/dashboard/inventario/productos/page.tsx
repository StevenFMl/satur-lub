import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { ProductsTable, type ProductRow } from "./products-table";

export const metadata: Metadata = { title: "Productos · Inventario" };
export const dynamic = "force-dynamic";

export default async function ProductosPage() {
  const { user, membership } = await getActiveMembership();
  if (!user) redirect("/login");
  if (!membership) redirect("/onboarding");

  const supabase = await createClient();

  // Intenta el SELECT con columnas V1 (default_price, average_cost,
  // last_purchase_cost). Si la migración todavía no se aplicó, PostgREST
  // devuelve data=null; en ese caso caemos al SELECT base para que la lista
  // nunca quede vacía por columnas inexistentes.
  const { data: productsV1, error: v1Error } = await supabase
    .from("products")
    .select(
      "id, name, sku, unit, cost_price, default_price, average_cost, last_purchase_cost, product_kind, is_active, has_tax, tax_rate, created_at"
    )
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  let rawProducts = productsV1;

  if (v1Error || !productsV1) {
    // Fallback pre-migración: columnas base garantizadas.
    const { data: fallback } = await supabase
      .from("products")
      .select(
        "id, name, sku, unit, cost_price, product_kind, is_active, has_tax, tax_rate, created_at"
      )
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    rawProducts = fallback as typeof productsV1;
  }

  const productIds = (rawProducts ?? []).map((p) => p.id as string);

  // Tier prices: solo disponibles post-migración (view v_product_active_prices).
  // Si la view no existe aún, la query falla y devolvemos tiers vacíos —
  // la tabla muestra "—" en Precio público hasta que la migración se aplique.
  let tierPrices: Array<{ product_id: string; tier_code: string; unit_price: number }> = [];
  if (productIds.length) {
    const { data: tiers } = await supabase
      .from("v_product_active_prices")
      .select("product_id, tier_code, unit_price")
      .in("product_id", productIds);
    tierPrices = (tiers ?? []) as typeof tierPrices;
  }

  const priceByProduct = new Map<
    string,
    { mayorista: number | null; distribuidor: number | null }
  >();
  for (const tp of tierPrices) {
    const entry = priceByProduct.get(tp.product_id) ?? { mayorista: null, distribuidor: null };
    if (tp.tier_code === "MAYORISTA") entry.mayorista = tp.unit_price;
    else if (tp.tier_code === "DISTRIBUIDOR") entry.distribuidor = tp.unit_price;
    priceByProduct.set(tp.product_id, entry);
  }

  const rows: ProductRow[] = (rawProducts ?? []).map((p) => {
    const extra = priceByProduct.get(p.id as string);
    return {
      id: p.id as string,
      name: p.name as string,
      sku: p.sku as string,
      unit: p.unit as string,
      cost_price: p.cost_price as number | null,
      default_price: (p.default_price as number | null) ?? null,
      average_cost: (p.average_cost as number | null) ?? 0,
      last_purchase_cost: (p.last_purchase_cost as number | null) ?? null,
      price_mayorista: extra?.mayorista ?? null,
      price_distribuidor: extra?.distribuidor ?? null,
      product_kind: p.product_kind as ProductRow["product_kind"],
      tax_rate: p.tax_rate as number | null,
      has_tax: (p.has_tax as boolean | null) ?? true,
      is_active: p.is_active as boolean,
      created_at: p.created_at as string,
    };
  });

  const canManage =
    membership.role === "owner" || membership.role === "admin";

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      <header className="space-y-2">
        <span className="hud-readout">Inventario · Catálogo</span>
        <h1 className="font-display text-[36px] leading-none tracking-[0.02em] text-foreground sm:text-[42px]">
          PRODUCTOS
        </h1>
        <p className="max-w-2xl text-[14px] leading-6 text-muted-foreground">
          El catálogo es la fuente de verdad de lo que vendes y compras. Cada
          producto registra su SKU único, costo referencial y precios por tier
          (Público, Mayorista, Distribuidor).
        </p>
      </header>

      <ProductsTable initialRows={rows} canManage={canManage} />
    </div>
  );
}
