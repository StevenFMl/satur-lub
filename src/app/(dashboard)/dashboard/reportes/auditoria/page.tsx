import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { todayEC, clampToTodayEC } from "@/lib/date-ec";
import { AuditoriaTable, type AuditRow } from "./auditoria-table";

export const metadata: Metadata = { title: "Auditoría · SaturLub" };
export const dynamic = "force-dynamic";

function defaultRange(): { from: string; to: string } {
  const today      = todayEC();
  const [year, mo] = today.split("-");
  return { from: `${year}-${mo}-01`, to: today };
}

export default async function AuditoriaPage({
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

  // ── 1. Fetch returns with original sale + items aggregate ──────────────────
  type RawItem = {
    quantity_returned: number;
    line_refund:       number;
  };

  type RawReturn = {
    id:                       string;
    return_type:              string;
    reason:                   string;
    processed_at:             string;
    refund_amount:            number;
    refund_method:            string | null;
    exchange_credit_applied:   number;
    exchange_credit_refunded:  number;
    exchange_sale_id:         string | null;
    original_sale_id:         string;
    sales: {
      sale_date: string | null;
      total:     number;
      business_partners: { full_name: string } | null;
    } | null;
    sale_return_items: RawItem[];
  };

  const { data: returnsRaw, error: retErr } = await supabase
    .from("sale_returns")
    .select(`
      id, return_type, reason, processed_at,
      refund_amount, refund_method,
      exchange_credit_applied, exchange_credit_refunded,
      exchange_sale_id, original_sale_id,
      sales!original_sale_id (
        sale_date, total,
        business_partners!customer_id ( full_name )
      ),
      sale_return_items ( quantity_returned, line_refund )
    `)
    .gte("processed_at", `${from}T00:00:00`)
    .lte("processed_at", `${to}T23:59:59`)
    .order("processed_at", { ascending: false })
    .limit(500);

  if (retErr) console.error("AuditoriaPage [returns]:", retErr);

  const returns = (returnsRaw ?? []) as unknown as RawReturn[];

  // ── 2. Fetch exchange sale details (date + total) ──────────────────────────
  const exchangeIds = [...new Set(
    returns.map(r => r.exchange_sale_id).filter(Boolean) as string[]
  )];

  const exchangeById = new Map<string, { sale_date: string | null; total: number }>();
  if (exchangeIds.length > 0) {
    const { data: excSales } = await supabase
      .from("sales")
      .select("id, sale_date, total")
      .in("id", exchangeIds);

    for (const s of (excSales ?? []) as { id: string; sale_date: string | null; total: number }[]) {
      exchangeById.set(s.id, { sale_date: s.sale_date, total: Number(s.total ?? 0) });
    }
  }

  // ── 3. Build typed rows ────────────────────────────────────────────────────
  const rows: AuditRow[] = returns.map((r) => {
    const items       = r.sale_return_items ?? [];
    const itemsRefund = items.reduce((s, i) => s + Number(i.line_refund ?? 0), 0);
    const itemsCount  = items.length;
    const excSale     = r.exchange_sale_id ? (exchangeById.get(r.exchange_sale_id) ?? null) : null;

    return {
      id:                      r.id,
      return_type:             r.return_type as "full" | "partial" | "exchange",
      reason:                  r.reason,
      processed_at:            r.processed_at,
      refund_amount:           Number(r.refund_amount ?? 0),
      refund_method:           r.refund_method,
      exchange_credit_applied:  Number(r.exchange_credit_applied  ?? 0),
      exchange_credit_refunded: Number(r.exchange_credit_refunded ?? 0),
      exchange_sale_id:        r.exchange_sale_id ?? null,
      original_sale_id:        r.original_sale_id,
      sale_date:               r.sales?.sale_date ?? null,
      sale_total:              Number(r.sales?.total ?? 0),
      customer_name:           r.sales?.business_partners?.full_name ?? "—",
      exchange_date:           excSale?.sale_date ?? null,
      exchange_total:          excSale ? excSale.total : null,
      items_count:             itemsCount,
      items_refund:            itemsRefund,
    };
  });

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8">
      <header className="space-y-2">
        <span className="hud-readout">Reportes · Auditoría</span>
        <div>
          <h1 className="font-display text-[36px] leading-none tracking-[0.02em] text-foreground sm:text-[42px]">
            AUDITORÍA
          </h1>
          <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
            Ciclo completo venta · devolución · cambio · reembolso · crédito cedido
          </p>
        </div>
      </header>

      <AuditoriaTable from={from} to={to} rows={rows} />
    </div>
  );
}
