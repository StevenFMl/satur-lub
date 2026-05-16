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

export default async function DevolucionesPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { user, membership } = await getActiveMembership();
  if (!user)       redirect("/login");
  if (!membership) redirect("/onboarding");

  const params = await searchParams;
  const def    = defaultRange();
  const from   = params.from ?? def.from;
  const to     = clampToTodayEC(params.to ?? def.to);

  const supabase = await createClient();

  // ── 1. Fetch sale_returns in period ─────────────────────────────────────
  // Filter by processed_at (when the return was processed), not sale date.
  const { data: returnsRaw, error: retErr } = await supabase
    .from("sale_returns")
    .select(`
      id, return_type, reason, notes, refund_amount, refund_method,
      refund_reference, processed_at, original_sale_id,
      exchange_sale_id, exchange_credit_applied, exchange_credit_refunded,
      sales!original_sale_id (
        sale_date, document_kind,
        business_partners!customer_id ( full_name )
      ),
      sale_return_items (
        sale_item_id, quantity_returned, base_qty, line_refund, restock
      )
    `)
    .gte("processed_at", `${from}T00:00:00`)
    .lte("processed_at", `${to}T23:59:59`)
    .order("processed_at", { ascending: false })
    .limit(500);

  if (retErr) console.error("DevolucionesPage [returns]:", retErr);

  // ── 2. Fetch item names for all return items ─────────────────────────────
  type RawReturnItem = {
    sale_item_id:      string;
    quantity_returned: number;
    base_qty:          number;
    line_refund:       number;
    restock:           boolean;
  };
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
    sales: {
      sale_date:         string | null;
      document_kind:     string;
      business_partners: { full_name: string } | null;
    } | null;
    sale_return_items: RawReturnItem[];
  };

  const returns = (returnsRaw ?? []) as unknown as RawReturn[];

  // Collect all sale_item_ids to look up item names (snapshot from v21)
  const allItemIds = [...new Set(
    returns.flatMap((r) => r.sale_return_items.map((i) => i.sale_item_id))
  )];

  const itemNameById = new Map<string, string>();
  if (allItemIds.length > 0) {
    const { data: saleItemsRaw } = await supabase
      .from("sale_items")
      .select("id, item_name")
      .in("id", allItemIds);

    for (const si of (saleItemsRaw ?? []) as { id: string; item_name: string | null }[]) {
      itemNameById.set(si.id, si.item_name ?? "Producto");
    }
  }

  // ── 3. Build typed rows ──────────────────────────────────────────────────
  const rows: DevolucionRow[] = returns.map((r) => ({
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
    sale_date:        r.sales?.sale_date ?? null,
    document_kind:    r.sales?.document_kind ?? "ticket",
    customer_name:    r.sales?.business_partners?.full_name ?? "—",
    items: (r.sale_return_items ?? []).map((i) => ({
      sale_item_id:      i.sale_item_id,
      quantity_returned: Number(i.quantity_returned ?? 0),
      base_qty:          Number(i.base_qty ?? 1),
      line_refund:       Number(i.line_refund ?? 0),
      restock:           i.restock !== false,
      item_name:         itemNameById.get(i.sale_item_id) ?? "Producto",
    })),
  }));

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8">
      <header className="space-y-2">
        <span className="hud-readout">Reportes · Operaciones</span>
        <div>
          <h1 className="font-display text-[36px] leading-none tracking-[0.02em] text-foreground sm:text-[42px]">
            DEVOLUCIONES
          </h1>
          <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
            Historial de devoluciones por período de procesamiento · Reembolso e inventario
          </p>
        </div>
      </header>

      <DevolucionesTable from={from} to={to} rows={rows} />
    </div>
  );
}
