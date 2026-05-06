import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { ProductsTable, type ProductRow } from "./products-table";

export const metadata: Metadata = { title: "Productos · Inventario" };

export default async function ProductosPage() {
  const { user, membership } = await getActiveMembership();
  if (!user) redirect("/login");
  if (!membership) redirect("/onboarding");

  const supabase = await createClient();

  // RLS aísla por tenant; aquí solo orden y proyección mínima necesaria.
  const { data } = await supabase
    .from("products")
    .select("id, name, sku, cost_price, product_kind, is_active, created_at")
    .order("created_at", { ascending: false });

  const rows = ((data ?? []) as unknown) as ProductRow[];
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
          producto registra su SKU único y costo base por defecto.
        </p>
      </header>

      <ProductsTable initialRows={rows} canManage={canManage} />
    </div>
  );
}
