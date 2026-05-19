import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { AuditoriaTable, type AuditoriaRow, type TopProduct } from "./auditoria-table";

export const metadata: Metadata = { title: "Auditoría · SaturLub" };
export const dynamic = "force-dynamic";

// ── Default range: current month ──────────────────────────────────────────────

function defaultRange(): { from: string; to: string } {
  const now  = new Date();
  const year = now.getFullYear();
  const mo   = String(now.getMonth() + 1).padStart(2, "0");
  const day  = String(now.getDate()).padStart(2, "0");
  return { from: `${year}-${mo}-01`, to: `${year}-${mo}-${day}` };
}

// ── Page ──────────────────────────────────────────────────────────────────────

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
  const to     = params.to   ?? def.to;

  const supabase = await createClient();

  // ── Main query: below-cost sales ─────────────────────────────────────────
  // Includes both new (below_cost_override = true) and legacy ([BAJO_COSTO] notes)
  // thanks to the v18 backfill migration.
  const { data: rawSales, error: salesErr } = await supabase
    .from("sales")
    .select(`
      id, created_at, sale_date, document_kind,
      subtotal, tax_total, total,
      below_cost_override, below_cost_loss_estimated, notes,
      business_partners ( id, full_name, document_number )
    `)
    .eq("status",               "confirmed")
    .eq("below_cost_override",  true)
    .gte("created_at", `${from}T00:00:00`)
    .lte("created_at", `${to}T23:59:59`)
    .order("created_at", { ascending: false })
    .limit(500);

  if (salesErr) console.error("AuditoriaPage [sales]:", salesErr);

  type RawSale = {
    id:                         string;
    created_at:                 string;
    sale_date:                  string | null;
    document_kind:              string;
    subtotal:                   number | string;
    tax_total:                  number | string;
    total:                      number | string;
    below_cost_override:        boolean;
    below_cost_loss_estimated:  number | string;
    notes:                      string | null;
    business_partners:          { id: string; full_name: string; document_number: string | null } | null;
  };

  const sales = (rawSales ?? []) as unknown as RawSale[];

  const rows: AuditoriaRow[] = sales.map((s) => ({
    id:                        s.id,
    display_date:              s.sale_date ?? s.created_at.slice(0, 10),
    created_at:                s.created_at,
    document_kind:             s.document_kind,
    customer_name:             s.business_partners?.full_name ?? "—",
    customer_ruc:              s.business_partners?.document_number ?? null,
    total:                     Number(s.total    ?? 0),
    subtotal:                  Number(s.subtotal ?? 0),
    loss_estimated:            Number(s.below_cost_loss_estimated ?? 0),
    // Legacy records (backfilled) have loss_estimated = 0; flag them for UI
    is_legacy:                 Number(s.below_cost_loss_estimated ?? 0) === 0 && s.notes?.startsWith("[BAJO_COSTO]") === true,
    notes:                     s.notes,
  }));

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const count          = rows.length;
  const totalLoss      = rows.reduce((s, r) => s + r.loss_estimated, 0);
  const avgLoss        = count > 0 ? totalLoss / count : 0;
  const totalSaleValue = rows.reduce((s, r) => s + r.total, 0);

  // ── Top products in below-cost sales ─────────────────────────────────────
  let topProducts: TopProduct[] = [];

  if (sales.length > 0) {
    const saleIds = sales.map((s) => s.id);

    const [{ data: itemsData }, { data: productsData }] = await Promise.all([
      supabase
        .from("sale_items")
        .select("sale_id, product_id, quantity")
        .in("sale_id", saleIds)
        .limit(5000),
      supabase
        .from("products")
        .select("id, name, sku")
        .eq("is_active", true)
        .limit(3000),
    ]);

    const productById = new Map(
      (productsData ?? []).map((p: { id: string; name: string; sku: string }) => [p.id, p])
    );

    // Count how many below-cost sales each product appears in
    type ItemRow = { sale_id: string; product_id: string; quantity: number | string };
    const prodSalesSet = new Map<string, Set<string>>(); // product_id → Set of sale_ids
    for (const item of (itemsData ?? []) as unknown as ItemRow[]) {
      const set = prodSalesSet.get(item.product_id) ?? new Set<string>();
      set.add(item.sale_id);
      prodSalesSet.set(item.product_id, set);
    }

    topProducts = Array.from(prodSalesSet.entries())
      .map(([pid, salesSet]) => {
        const p = productById.get(pid);
        return {
          product_id:  pid,
          name:        p?.name ?? "Producto eliminado",
          sku:         p?.sku  ?? "—",
          sale_count:  salesSet.size,
        };
      })
      .sort((a, b) => b.sale_count - a.sale_count)
      .slice(0, 5);
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8">
      <header className="space-y-2">
        <span className="hud-readout">Administración · Auditoría ventas</span>
        <div>
          <h1 className="font-display text-[36px] leading-none tracking-[0.02em] text-foreground sm:text-[42px]">
            AUDITORÍA
          </h1>
          <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
            Ventas confirmadas con precio por debajo del costo estimado (CPP).
          </p>
        </div>
      </header>

      <AuditoriaTable
        rows={rows}
        from={from}
        to={to}
        count={count}
        totalLoss={totalLoss}
        avgLoss={avgLoss}
        totalSaleValue={totalSaleValue}
        topProducts={topProducts}
      />
    </div>
  );
}
