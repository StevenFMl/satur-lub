import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { getPosPermissions } from "@/lib/auth/permissions";
import { SaleDetail } from "./sale-detail";

export const metadata: Metadata = { title: "Detalle de Venta · SaturLub" };
export const dynamic = "force-dynamic";

export type SaleDetailData = {
  id:                  string;
  sale_date:           string;
  created_at:          string;
  status:              string;
  total:               number;
  subtotal:            number;
  tax_total:           number;
  discount_total:      number;
  document_kind:       string;
  notes:               string | null;
  cancelled_at:        string | null;
  cancelled_by:        string | null;
  cancellation_reason: string | null;
  cancellation_note:   string | null;
  customer: {
    full_name:       string;
    document_type:   string;
    document_number: string;
    phone:           string | null;
  } | null;
  warehouse: { name: string } | null;
  payments: {
    id:             string;
    payment_method: string;
    amount:         number;
    reference:      string | null;
  }[];
  items: {
    id:                    string;
    quantity:              number;
    unit_price:            number;
    discount_amount:       number;
    tax_rate:              number;
    line_total:            number;
    is_taxable:            boolean;
    base_qty:              number;
    original_unit_price:   number | null;
    price_override_type:   string | null;
    price_override_reason: string | null;
    price_override_at:     string | null;
    product_name:          string;
    product_sku:           string;
    product_unit:          string;
    presentation_label:    string | null;
  }[];
};

export default async function SaleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user, membership } = await getActiveMembership();
  if (!user) redirect("/login");
  if (!membership) redirect("/onboarding");

  const permissions = getPosPermissions(membership.role);
  if (!permissions.canUsePOS) redirect("/dashboard");

  const { id } = await params;
  const supabase = await createClient();

  const { data: raw, error } = await supabase
    .from("sales")
    .select(
      `id, sale_date, created_at, status, total, subtotal, tax_total,
       discount_total, document_kind, notes,
       cancelled_at, cancelled_by, cancellation_reason, cancellation_note,
       business_partners!customer_id(full_name, document_type, document_number, phone),
       warehouses!warehouse_id(name),
       sale_payments(id, payment_method, amount, reference),
       sale_items(
         id, quantity, unit_price, discount_amount, tax_rate, line_total,
         is_taxable, base_qty,
         original_unit_price, price_override_type, price_override_reason, price_override_at,
         products!product_id(name, sku, unit),
         product_presentations!presentation_id(unit_label)
       )`
    )
    .eq("id", id)
    .single();

  if (error || !raw) notFound();

  // Normalize
  const sale: SaleDetailData = {
    id:                  raw.id as string,
    sale_date:           raw.sale_date as string,
    created_at:          raw.created_at as string,
    status:              raw.status as string,
    total:               Number(raw.total ?? 0),
    subtotal:            Number(raw.subtotal ?? 0),
    tax_total:           Number(raw.tax_total ?? 0),
    discount_total:      Number(raw.discount_total ?? 0),
    document_kind:       raw.document_kind as string,
    notes:               raw.notes as string | null,
    cancelled_at:        raw.cancelled_at as string | null,
    cancelled_by:        raw.cancelled_by as string | null,
    cancellation_reason: raw.cancellation_reason as string | null,
    cancellation_note:   raw.cancellation_note as string | null,
    customer:            raw.business_partners as unknown as SaleDetailData["customer"],
    warehouse:           raw.warehouses as unknown as SaleDetailData["warehouse"],
    payments: ((raw.sale_payments as any[]) ?? []).map((p) => ({
      id:             p.id as string,
      payment_method: p.payment_method as string,
      amount:         Number(p.amount ?? 0),
      reference:      p.reference as string | null,
    })),
    items: ((raw.sale_items as any[]) ?? []).map((si) => ({
      id:                    si.id as string,
      quantity:              Number(si.quantity ?? 0),
      unit_price:            Number(si.unit_price ?? 0),
      discount_amount:       Number(si.discount_amount ?? 0),
      tax_rate:              Number(si.tax_rate ?? 0),
      line_total:            Number(si.line_total ?? 0),
      is_taxable:            Boolean(si.is_taxable),
      base_qty:              Number(si.base_qty ?? 1),
      original_unit_price:   si.original_unit_price != null ? Number(si.original_unit_price) : null,
      price_override_type:   si.price_override_type as string | null,
      price_override_reason: si.price_override_reason as string | null,
      price_override_at:     si.price_override_at as string | null,
      product_name:          (si.products as any)?.name ?? "—",
      product_sku:           (si.products as any)?.sku  ?? "",
      product_unit:          (si.products as any)?.unit ?? "",
      presentation_label:    (si.product_presentations as any)?.unit_label ?? null,
    })),
  };

  return (
    <SaleDetail
      sale={sale}
      canVoidSale={permissions.canVoidSale}
    />
  );
}
