import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { todayEC, clampToTodayEC } from "@/lib/date-ec";
import { DevolucionesTable, type DevolucionRow } from "./devoluciones-table";

export const metadata: Metadata = { title: "Devoluciones · SaturLub" };
export const dynamic = "force-dynamic";

function defaultRange(): { from: string; to: string } {
  const today      = todayEC();
  const [year, mo] = today.split("-");
  return { from: `${year}-${mo}-01`, to: today };
}

function logQueryError(label: string, err: unknown) {
  if (!err) return;
  const e = err as { code?: string; message?: string; details?: string; hint?: string };
  console.error(`[devoluciones] ${label}:`, {
    code:    e.code,
    message: e.message,
    details: e.details,
    hint:    e.hint,
    raw:     JSON.stringify(err),
  });
}

export default async function DevolucionesPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { user, membership } = await getActiveMembership();
  if (!user)       redirect("/login");
  if (!membership) redirect("/onboarding");

  const tenantId = membership.tenant_id;
  const params   = await searchParams;
  const def      = defaultRange();
  const from     = params.from ?? def.from;
  const to       = clampToTodayEC(params.to ?? def.to);

  const supabase = await createClient();

  // ── 1. Flat sale_returns query (no nested joins → avoids PGRST200) ────────
  const { data: returnsRaw, error: retErr } = await supabase
    .from("sale_returns")
    .select(`
      id, return_type, reason, notes, refund_amount, refund_method,
      refund_reference, processed_at, original_sale_id,
      exchange_sale_id, exchange_credit_applied, exchange_credit_refunded
    `)
    .eq("tenant_id", tenantId)
    .gte("processed_at", `${from}T00:00:00`)
    .lte("processed_at", `${to}T23:59:59`)
    .order("processed_at", { ascending: false })
    .limit(500);

  if (retErr) {
    logQueryError("sale_returns", retErr);
    // Main query failed — render page with empty state rather than crashing
    return (
      <div className="mx-auto w-full max-w-7xl space-y-8">
        <header className="space-y-2">
          <span className="hud-readout">Documentos · Devoluciones</span>
          <div>
            <h1 className="font-display text-[36px] leading-none tracking-[0.02em] text-foreground sm:text-[42px]">
              DEVOLUCIONES
            </h1>
            <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
              Historial de devoluciones por período de procesamiento · Reembolso e inventario
            </p>
          </div>
        </header>
        <p className="rounded-sm border border-hazard-500/30 bg-hazard-500/5 px-4 py-3 font-mono text-[12px] text-hazard-400">
          Error al cargar devoluciones. Intente recargar la página.
        </p>
        <DevolucionesTable from={from} to={to} rows={[]} />
      </div>
    );
  }

  type RawReturn = {
    id:                      string;
    return_type:             string;
    reason:                  string;
    notes:                   string | null;
    refund_amount:           number;
    refund_method:           string | null;
    refund_reference:        string | null;
    processed_at:            string;
    original_sale_id:        string;
    exchange_sale_id:        string | null;
    exchange_credit_applied:  number;
    exchange_credit_refunded: number;
  };

  const returns = (returnsRaw ?? []) as unknown as RawReturn[];

  if (returns.length === 0) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-8">
        <PageHeader />
        <DevolucionesTable from={from} to={to} rows={[]} />
      </div>
    );
  }

  // ── 2. Parallel secondary lookups (flat) ─────────────────────────────────
  const returnIds      = returns.map((r) => r.id);
  const saleIds        = [...new Set(returns.map((r) => r.original_sale_id).filter(Boolean))];

  const [itemsRes, salesRes] = await Promise.all([
    supabase
      .from("sale_return_items")
      .select("sale_return_id, sale_item_id, quantity_returned, base_qty, line_refund, restock")
      .in("sale_return_id", returnIds),
    saleIds.length > 0
      ? supabase
          .from("sales")
          .select("id, sale_date, document_kind, customer_id")
          .in("id", saleIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (itemsRes.error) logQueryError("sale_return_items", itemsRes.error);
  if (salesRes.error) logQueryError("sales lookup", salesRes.error);

  type RawSale = { id: string; sale_date: string | null; document_kind: string; customer_id: string | null };
  const salesById = new Map<string, RawSale>();
  for (const s of ((salesRes.data ?? []) as unknown as RawSale[])) {
    salesById.set(s.id, s);
  }

  // ── 3. Fetch business_partners for customer names ─────────────────────────
  const customerIds = [
    ...new Set(
      [...salesById.values()].map((s) => s.customer_id).filter((id): id is string => id != null)
    ),
  ];

  type RawPartner = { id: string; full_name: string };
  const partnerById = new Map<string, string>();

  if (customerIds.length > 0) {
    const { data: partnersRaw, error: partErr } = await supabase
      .from("business_partners")
      .select("id, full_name")
      .in("id", customerIds);

    if (partErr) logQueryError("business_partners lookup", partErr);
    for (const p of ((partnersRaw ?? []) as unknown as RawPartner[])) {
      partnerById.set(p.id, p.full_name);
    }
  }

  // ── 4. Fetch sale_item names ──────────────────────────────────────────────
  type RawReturnItem = {
    sale_return_id:    string;
    sale_item_id:      string;
    quantity_returned: number;
    base_qty:          number;
    line_refund:       number;
    restock:           boolean;
  };

  const allItems = (itemsRes.data ?? []) as unknown as RawReturnItem[];
  const allItemIds = [...new Set(allItems.map((i) => i.sale_item_id))];

  const itemNameById = new Map<string, string>();
  if (allItemIds.length > 0) {
    const { data: saleItemsRaw, error: siErr } = await supabase
      .from("sale_items")
      .select("id, item_name")
      .in("id", allItemIds);

    if (siErr) logQueryError("sale_items lookup", siErr);
    for (const si of ((saleItemsRaw ?? []) as { id: string; item_name: string | null }[])) {
      itemNameById.set(si.id, si.item_name ?? "Producto");
    }
  }

  // ── 5. Group return items by return id ────────────────────────────────────
  const itemsByReturnId = new Map<string, RawReturnItem[]>();
  for (const item of allItems) {
    const arr = itemsByReturnId.get(item.sale_return_id) ?? [];
    arr.push(item);
    itemsByReturnId.set(item.sale_return_id, arr);
  }

  // ── 6. Assemble typed rows ────────────────────────────────────────────────
  const rows: DevolucionRow[] = returns.map((r) => {
    const sale      = salesById.get(r.original_sale_id);
    const custName  = sale?.customer_id ? (partnerById.get(sale.customer_id) ?? "—") : "—";
    const lineItems = itemsByReturnId.get(r.id) ?? [];

    return {
      id:                      r.id,
      return_type:             r.return_type as "full" | "partial" | "exchange",
      reason:                  r.reason,
      notes:                   r.notes,
      refund_amount:           Number(r.refund_amount ?? 0),
      refund_method:           r.refund_method,
      refund_reference:        r.refund_reference,
      processed_at:            r.processed_at,
      original_sale_id:        r.original_sale_id,
      exchange_sale_id:        r.exchange_sale_id ?? null,
      exchange_credit_applied:  Number(r.exchange_credit_applied  ?? 0),
      exchange_credit_refunded: Number(r.exchange_credit_refunded ?? 0),
      sale_date:      sale?.sale_date ?? null,
      document_kind:  sale?.document_kind ?? "ticket",
      customer_name:  custName,
      items: lineItems.map((i) => ({
        sale_item_id:      i.sale_item_id,
        quantity_returned: Number(i.quantity_returned ?? 0),
        base_qty:          Number(i.base_qty ?? 1),
        line_refund:       Number(i.line_refund ?? 0),
        restock:           i.restock !== false,
        item_name:         itemNameById.get(i.sale_item_id) ?? "Producto",
      })),
    };
  });

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8">
      <PageHeader />
      <DevolucionesTable from={from} to={to} rows={rows} />
    </div>
  );
}

function PageHeader() {
  return (
    <header className="space-y-2">
      <span className="hud-readout">Documentos · Devoluciones</span>
      <div>
        <h1 className="font-display text-[36px] leading-none tracking-[0.02em] text-foreground sm:text-[42px]">
          DEVOLUCIONES
        </h1>
        <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
          Historial de devoluciones por período de procesamiento · Reembolso e inventario
        </p>
      </div>
    </header>
  );
}
