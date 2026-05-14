import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { PurchaseDetail, type LineItem, type PurchaseFull } from "./purchase-detail";

export const metadata: Metadata = { title: "Detalle de compra · SaturLub" };
export const dynamic = "force-dynamic";

type RawPO = {
  id: string;
  created_at: string;
  purchase_date: string | null;
  subtotal: number | string;
  tax_total: number | string;
  total: number | string;
  tax_rate: number | string;
  is_tax_inclusive: boolean;
  status: string;
  payment_method: string | null;
  payment_status: string;
  payment_due_date: string | null;
  notes: string | null;
  document_number: string | null;
  business_partners: { id: string; full_name: string; document_number: string } | null;
  warehouses: { id: string; name: string } | null;
};

type RawItem = {
  id: string;
  quantity: number | string;
  quantity_bonus: number | string | null;
  unit_cost: number | string;
  line_total: number | string;
  is_taxable: boolean | null;
  base_qty?: number | string | null;
  products: { id: string; name: string; sku: string; unit: string } | null;
};

export default async function PurchaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { user, membership } = await getActiveMembership();
  if (!user) redirect("/login");
  if (!membership) redirect("/onboarding");

  const supabase = await createClient();

  // Tratamos primero con purchase_date / is_tax_inclusive (post-V1). Si falla
  // por columnas inexistentes, hacemos fallback al SELECT base.
  let po: RawPO | null = null;
  {
    const { data, error } = await supabase
      .from("purchase_orders")
      .select(
        `
        id, created_at, purchase_date,
        subtotal, tax_total, total, tax_rate, is_tax_inclusive,
        status, payment_method, payment_status, payment_due_date,
        notes, document_number,
        business_partners ( id, full_name, document_number ),
        warehouses ( id, name )
        `
      )
      .eq("id", id)
      .maybeSingle();
    if (!error && data) po = data as unknown as RawPO;
  }
  if (!po) {
    const { data } = await supabase
      .from("purchase_orders")
      .select(
        `
        id, created_at,
        subtotal, tax_total, total, tax_rate, is_tax_inclusive,
        status, payment_method, payment_status, payment_due_date,
        notes, document_number,
        business_partners ( id, full_name, document_number ),
        warehouses ( id, name )
        `
      )
      .eq("id", id)
      .maybeSingle();
    if (data) {
      po = { ...(data as unknown as RawPO), purchase_date: null };
    }
  }

  if (!po) notFound();

  // quantity_bonus es V8; is_taxable es V1. Si fallan por columna inexistente
  // hacemos fallback progresivo para no romper deploys parciales.
  let rawItems: RawItem[] = [];
  {
    const { data, error } = await supabase
      .from("purchase_order_items")
      .select(
        `
        id, quantity, quantity_bonus, unit_cost, line_total, is_taxable, base_qty,
        products ( id, name, sku, unit )
        `
      )
      .eq("purchase_order_id", id)
      .order("created_at", { ascending: true });
    if (!error && data) rawItems = data as unknown as RawItem[];
  }
  if (rawItems.length === 0) {
    const { data, error } = await supabase
      .from("purchase_order_items")
      .select(
        `
        id, quantity, unit_cost, line_total, is_taxable,
        products ( id, name, sku, unit )
        `
      )
      .eq("purchase_order_id", id)
      .order("created_at", { ascending: true });
    if (!error && data) {
      rawItems = (data as unknown as RawItem[]).map((it) => ({
        ...it,
        quantity_bonus: 0,
      }));
    }
  }
  if (rawItems.length === 0) {
    const { data } = await supabase
      .from("purchase_order_items")
      .select(
        `
        id, quantity, unit_cost, line_total,
        products ( id, name, sku, unit )
        `
      )
      .eq("purchase_order_id", id)
      .order("created_at", { ascending: true });
    rawItems = (data ?? []).map((it) => ({
      ...(it as unknown as RawItem),
      quantity_bonus: 0,
      is_taxable: true,
    }));
  }

  const purchase: PurchaseFull = {
    id: po.id,
    created_at: po.created_at,
    purchase_date: po.purchase_date,
    subtotal: Number(po.subtotal),
    tax_total: Number(po.tax_total),
    total: Number(po.total),
    tax_rate: Number(po.tax_rate),
    is_tax_inclusive: po.is_tax_inclusive,
    status: po.status,
    payment_method: po.payment_method,
    payment_status: po.payment_status,
    payment_due_date: po.payment_due_date,
    notes: po.notes,
    document_number: po.document_number,
    supplier: po.business_partners
      ? {
          id: po.business_partners.id,
          name: po.business_partners.full_name,
          document_number: po.business_partners.document_number,
        }
      : null,
    warehouse: po.warehouses
      ? { id: po.warehouses.id, name: po.warehouses.name }
      : null,
  };

  const items: LineItem[] = rawItems.map((it) => ({
    id: it.id,
    quantity: Number(it.quantity),
    quantity_bonus: Number(it.quantity_bonus ?? 0),
    unit_cost: Number(it.unit_cost),
    line_total: Number(it.line_total),
    is_taxable: it.is_taxable ?? true,
    base_qty: Number(it.base_qty ?? 1),
    product: it.products
      ? {
          id: it.products.id,
          name: it.products.name,
          sku: it.products.sku,
          unit: it.products.unit,
        }
      : null,
  }));

  const canManage =
    membership.role === "owner" || membership.role === "admin";

  return (
    <PurchaseDetail purchase={purchase} items={items} canManage={canManage} />
  );
}
