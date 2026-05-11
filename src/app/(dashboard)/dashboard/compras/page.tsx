import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { PurchasesList, type PurchaseListRow } from "./purchases-list";

export const metadata: Metadata = { title: "Compras · SaturLub" };
export const dynamic = "force-dynamic";

type RawPO = {
  id: string;
  created_at: string;
  purchase_date: string | null;
  total: number;
  subtotal: number;
  tax_total: number;
  status: string;
  payment_method: string | null;
  payment_status: string;
  payment_due_date: string | null;
  notes: string | null;
  business_partners: { id: string; full_name: string } | null;
  warehouses: { id: string; name: string } | null;
  purchase_order_items: { id: string }[] | null;
};

export default async function ComprasIndexPage() {
  const { user, membership } = await getActiveMembership();
  if (!user) redirect("/login");
  if (!membership) redirect("/onboarding");

  const supabase = await createClient();

  // Resilient: trata de traer purchase_date (post-migración V1). Si la columna
  // no existe aún, cae al SELECT base para no romper la pantalla.
  const { data: rawV1, error: v1Error } = await supabase
    .from("purchase_orders")
    .select(
      `
      id, created_at, purchase_date,
      total, subtotal, tax_total,
      status, payment_method, payment_status, payment_due_date, notes,
      business_partners ( id, full_name ),
      warehouses ( id, name ),
      purchase_order_items ( id )
      `
    )
    .order("created_at", { ascending: false });

  let raw: RawPO[] = (rawV1 ?? []) as unknown as RawPO[];

  if (v1Error) {
    console.error("ComprasIndexPage v1 query:", v1Error);
    const { data: fallback } = await supabase
      .from("purchase_orders")
      .select(
        `
        id, created_at,
        total, subtotal, tax_total,
        status, payment_method, payment_status, payment_due_date, notes,
        business_partners ( id, full_name ),
        warehouses ( id, name ),
        purchase_order_items ( id )
        `
      )
      .order("created_at", { ascending: false });
    raw = (fallback ?? []).map((p) => ({
      ...(p as unknown as RawPO),
      purchase_date: null,
    }));
  }

  const rows: PurchaseListRow[] = raw.map((po) => ({
    id: po.id,
    date: po.purchase_date ?? po.created_at,
    created_at: po.created_at,
    supplier_id: po.business_partners?.id ?? null,
    supplier_name: po.business_partners?.full_name ?? "—",
    warehouse_name: po.warehouses?.name ?? null,
    total: Number(po.total ?? 0),
    subtotal: Number(po.subtotal ?? 0),
    tax_total: Number(po.tax_total ?? 0),
    status: po.status,
    payment_method: po.payment_method,
    payment_status: po.payment_status,
    payment_due_date: po.payment_due_date,
    item_count: po.purchase_order_items?.length ?? 0,
    notes: po.notes,
  }));

  const canManage =
    membership.role === "owner" || membership.role === "admin";

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 sm:space-y-8">
      <header className="space-y-2">
        <span className="hud-readout">Operación · Compras</span>
        <h1 className="font-display text-[32px] leading-none tracking-[0.02em] text-foreground sm:text-[42px]">
          COMPRAS
        </h1>
        <p className="max-w-2xl text-[13px] leading-6 text-muted-foreground sm:text-[14px]">
          Historial de compras a proveedores. Cada recepción actualiza
          inventario y costo promedio ponderado (CPP) en una sola transacción.
        </p>
      </header>

      <PurchasesList initialRows={rows} canManage={canManage} />
    </div>
  );
}
