import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { SuppliersTable, type SupplierRow } from "./suppliers-table";

export const metadata: Metadata = { title: "Proveedores" };

export default async function ProveedoresPage() {
  const { user, membership } = await getActiveMembership();
  if (!user) redirect("/login");
  if (!membership) redirect("/onboarding");

  const supabase = await createClient();
  // Solo activos — los inactivados (soft-delete) desaparecen de la UI.
  const { data } = await supabase
    .from("business_partners")
    .select(
      "id, full_name, document_type, document_number, email, phone, is_active, created_at"
    )
    .eq("partner_type", "supplier")
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  const rows = ((data ?? []) as unknown) as SupplierRow[];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      <header className="space-y-3">
        <span className="hud-readout">Catálogo · Compras</span>
        <h1 className="font-display text-[36px] leading-none tracking-[0.02em] text-foreground sm:text-[42px]">
          PROVEEDORES
        </h1>
        <p className="max-w-2xl text-[14px] leading-6 text-muted-foreground">
          Registra a quién le compras mercancía. Cada proveedor queda aislado
          a tu negocio actual y disponible para recibir órdenes de compra.
        </p>
      </header>

      <SuppliersTable initialRows={rows} />
    </div>
  );
}
