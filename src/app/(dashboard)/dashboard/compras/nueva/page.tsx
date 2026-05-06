import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import {
  PurchaseForm,
  type LookupSupplier,
  type LookupProduct,
  type LookupWarehouse,
} from "./purchase-form";

export const metadata: Metadata = { title: "Nueva compra · Recepción" };

export default async function NuevaCompraPage() {
  const { user, membership } = await getActiveMembership();
  if (!user) redirect("/login");
  if (!membership) redirect("/onboarding");

  const supabase = await createClient();

  // Lookups en paralelo. RLS los filtra al tenant del usuario.
  const [suppliersRes, productsRes, warehousesRes] = await Promise.all([
    supabase
      .from("business_partners")
      .select("id, full_name, document_number")
      .eq("partner_type", "supplier")
      .eq("is_active", true)
      .order("full_name"),
    supabase
      .from("products")
      .select("id, sku, name, cost_price")
      .eq("is_active", true)
      .order("name")
      .limit(500),
    supabase
      .from("warehouses")
      .select("id, name")
      .eq("is_active", true)
      .order("name"),
  ]);

  const suppliers = (suppliersRes.data ?? []) as unknown as LookupSupplier[];
  const products = (productsRes.data ?? []) as unknown as LookupProduct[];
  const warehouses = (warehousesRes.data ?? []) as unknown as LookupWarehouse[];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      <header className="space-y-2">
        <span className="hud-readout">Compras · Recepción</span>
        <h1 className="font-display text-[36px] leading-none tracking-[0.02em] text-foreground sm:text-[42px]">
          NUEVA COMPRA
        </h1>
        <p className="max-w-2xl text-[14px] leading-6 text-muted-foreground">
          Recibe mercancía y actualiza el inventario en una sola transacción
          atómica. Si algo falla, nada queda registrado.
        </p>
      </header>

      <PurchaseForm
        suppliers={suppliers}
        products={products}
        warehouses={warehouses}
      />
    </div>
  );
}
