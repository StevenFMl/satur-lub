import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { RentabilidadTable, type ProductProfitRow, type SaleProfitRow } from "./rentabilidad-table";
import { todayEC, clampToTodayEC } from "@/lib/date-ec";

export const metadata: Metadata = { title: "Rentabilidad · SaturLub" };
export const dynamic = "force-dynamic";

// ── Default range: current month ──────────────────────────────────────────────

function defaultRange(): { from: string; to: string } {
  const today      = todayEC();
  const [year, mo] = today.split("-");
  return { from: `${year}-${mo}-01`, to: today };
}

// ── Types ─────────────────────────────────────────────────────────────────────

type RawItem = {
  id:         string;               // sale_items.id — needed to link to return_items
  product_id: string | null;       // NULL for manual items (v21+)
  item_name:  string | null;       // snapshot name — always set for v21+ sales
  quantity:   number | string;
  base_qty:   number | string | null; // presentation conversion factor (v3+); default 1
  line_total: number | string;
  tax_rate:   number | string;
  is_taxable: boolean;
  unit_cost:  number | string | null; // populated by trigger v17 for new sales; NULL for old
};

type RawSale = {
  id:             string;
  created_at:     string;
  sale_date:      string | null;
  document_kind:  string;
  total:          number | string;
  business_partners: { full_name: string; document_number: string | null } | null;
  sale_items:     RawItem[];
};

// Return data — fetched after sales so we can filter by original_sale_id
type RawReturnItem = {
  sale_item_id:      string;
  quantity_returned: number | string;
  line_refund:       number | string;   // gross with IVA (proportional from line_total)
};
type RawReturn = {
  original_sale_id:  string;
  sale_return_items: RawReturnItem[];
};

type RawProduct = {
  id:                 string;
  name:               string;
  sku:                string;
  unit:               string;
  average_cost:       number | string | null;
  last_purchase_cost: number | string | null;
};

// ── Cost resolution ───────────────────────────────────────────────────────────
// Prioridad:
//   1. sale_items.unit_cost  → snapshot histórico (trigger v17, ventas nuevas)
//   2. products.average_cost → CPP actual (ventas anteriores al trigger)
//   3. products.last_purchase_cost → fallback
//   4. 0 → sin costo (servicios o productos sin compras)
//
// "snapshot" = garantía de que el costo corresponde al momento exacto de la venta.
// "cpp"      = CPP vigente hoy (puede diferir del momento de venta).
// "last"     = último costo de compra; aproximación, no histórico.
// "zero"     = sin costo registrado.

type CostSource = "snapshot" | "cpp" | "last" | "zero";

function resolveItemCost(
  saleItemCost: number | string | null | undefined,
  product: RawProduct | undefined,
): { unitCost: number; source: CostSource } {
  // Snapshot: sale_items.unit_cost existe (trigger v17)
  if (saleItemCost !== null && saleItemCost !== undefined) {
    const snap = Number(saleItemCost);
    return { unitCost: snap, source: snap > 0 ? "snapshot" : "zero" };
  }
  // Fallback: producto con CPP actual
  if (!product) return { unitCost: 0, source: "zero" };
  const cpp  = Number(product.average_cost       ?? 0);
  const last = Number(product.last_purchase_cost ?? 0);
  if (cpp  > 0) return { unitCost: cpp,  source: "cpp"  };
  if (last > 0) return { unitCost: last, source: "last" };
  return            { unitCost: 0,     source: "zero" };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function RentabilidadPage({
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

  // ── Parallel queries: sales + products ─────────────────────────────────
  const [{ data: salesData, error: saleErr }, { data: productsData, error: prodErr }] =
    await Promise.all([
      supabase
        .from("sales")
        .select(`
          id, created_at, sale_date, document_kind, total,
          business_partners ( full_name, document_number ),
          sale_items ( id, product_id, item_name, quantity, base_qty, line_total, tax_rate, is_taxable, unit_cost )
        `)
        .eq("status", "confirmed")
        .gte("created_at", `${from}T00:00:00`)
        .lte("created_at", `${to}T23:59:59`)
        .order("created_at", { ascending: false })
        .limit(1000),

      supabase
        .from("products")
        .select("id, name, sku, unit, average_cost, last_purchase_cost")
        .eq("is_active", true)
        .limit(3000),
    ]);

  if (saleErr) console.error("RentabilidadPage [sales]:", saleErr);
  if (prodErr) console.error("RentabilidadPage [products]:", prodErr);

  const sales    = (salesData    ?? []) as unknown as RawSale[];
  const products = (productsData ?? []) as unknown as RawProduct[];

  const productById = new Map<string, RawProduct>(products.map((p) => [p.id, p]));

  // ── Returns query — sequential (needs sale IDs) ─────────────────────────
  // Returns are attributed to the sale's period (where revenue was originally
  // recognised), regardless of when the return was processed.
  const saleIds = sales.map((s) => s.id);
  const returnedByItemId = new Map<string, { qty: number; lineRefund: number }>();

  if (saleIds.length > 0) {
    const { data: returnsData, error: retErr } = await supabase
      .from("sale_returns")
      .select("original_sale_id, sale_return_items ( sale_item_id, quantity_returned, line_refund )")
      .in("original_sale_id", saleIds);

    if (retErr) console.error("RentabilidadPage [returns]:", retErr);

    for (const ret of (returnsData ?? []) as unknown as RawReturn[]) {
      for (const ri of ret.sale_return_items ?? []) {
        const cur = returnedByItemId.get(ri.sale_item_id) ?? { qty: 0, lineRefund: 0 };
        cur.qty       += Number(ri.quantity_returned ?? 0);
        cur.lineRefund += Number(ri.line_refund       ?? 0);
        returnedByItemId.set(ri.sale_item_id, cur);
      }
    }
  }

  // ── Per-product aggregation ──────────────────────────────────────────────
  type ProdAcc = {
    product_id:     string;
    name:           string;
    sku:            string;
    unit:           string;
    qty_sold:       number;   // net: sold − returned
    revenue_net:    number;   // net of returns, s/IVA
    revenue_gross:  number;   // net of returns, c/IVA
    cost_total:     number;   // net: original cost − returned cost
    cost_source:    CostSource;
    returned_qty:   number;   // total presentation units returned in this period
    returned_gross: number;   // total gross amount refunded (sum of line_refund)
  };
  const prodMap = new Map<string, ProdAcc>();
  const saleRows: SaleProfitRow[] = [];

  const rank = (src: CostSource) =>
    src === "snapshot" ? 4 : src === "cpp" ? 3 : src === "last" ? 2 : 1;

  for (const s of sales) {
    let saleRevenueNet    = 0;
    let saleRevenueGross  = 0;
    let saleCostTotal     = 0;
    let saleReturnedGross = 0;  // total gross refunded across all items in this sale
    let saleCostSource: CostSource = "zero";

    for (const item of s.sale_items ?? []) {
      const pid     = item.product_id;  // null for manual items
      const qty     = Number(item.quantity  ?? 0);
      // base_qty: how many base-unit (caneca) each presentation unit represents.
      // unit_cost is per BASE unit, so lineCost = qty × baseQty × unitCost.
      const baseQty = Number(item.base_qty  ?? 1);
      const gross   = Number(item.line_total ?? 0);
      const rate    = Number(item.tax_rate   ?? 0);
      const taxable = item.is_taxable !== false;
      const lineNet = taxable && rate > 0 ? gross / (1 + rate / 100) : gross;

      const { unitCost, source } = resolveItemCost(item.unit_cost, pid ? productById.get(pid) : undefined);
      const lineCost = qty * baseQty * unitCost;

      // ── Returns netting ──────────────────────────────────────────────────
      // line_refund is gross (c/IVA), proportional from line_total.
      // We apply the same IVA ratio to derive the net refund.
      const returned = returnedByItemId.get(item.id) ?? { qty: 0, lineRefund: 0 };
      const retNetRefund = taxable && rate > 0
        ? returned.lineRefund / (1 + rate / 100)
        : returned.lineRefund;
      // Proportional cost reversal: (returnedQty / qty) × lineCost
      const retCost = qty > 0 ? lineCost * (returned.qty / qty) : 0;

      // Net figures (positive = revenue still in; negative impossible since returned ≤ sold)
      const netGross = gross   - returned.lineRefund;
      const netNet   = lineNet - retNetRefund;
      const netCost  = lineCost - retCost;

      saleRevenueNet    += netNet;
      saleRevenueGross  += netGross;
      saleCostTotal     += netCost;
      saleReturnedGross += returned.lineRefund;

      if (source === "snapshot") saleCostSource = "snapshot";
      else if (source === "cpp"  && saleCostSource === "zero") saleCostSource = "cpp";
      else if (source === "last" && saleCostSource === "zero") saleCostSource = "last";

      // ── Per-product accumulation ─────────────────────────────────────────
      const p        = pid ? productById.get(pid) : undefined;
      const itemName = pid
        ? (p?.name ?? "Producto eliminado")
        : (item.item_name ?? "Ítem manual");
      const mapKey   = pid ?? `manual::${itemName}`;

      const existing = prodMap.get(mapKey) ?? {
        product_id:     pid ?? "manual",
        name:           itemName,
        sku:            pid ? (p?.sku ?? "—") : "MANUAL",
        unit:           pid ? (p?.unit ?? "unidad") : "unidad",
        qty_sold:       0,
        revenue_net:    0,
        revenue_gross:  0,
        cost_total:     0,
        cost_source:    source,
        returned_qty:   0,
        returned_gross: 0,
      };
      existing.qty_sold      += qty - returned.qty;    // net units
      existing.revenue_net   += netNet;
      existing.revenue_gross += netGross;
      existing.cost_total    += netCost;
      existing.returned_qty   += returned.qty;
      existing.returned_gross += returned.lineRefund;
      if (rank(source) > rank(existing.cost_source)) existing.cost_source = source;
      prodMap.set(mapKey, existing);
    }

    const saleProfit = saleRevenueNet - saleCostTotal;
    const saleMargin = saleRevenueNet > 0 ? (saleProfit / saleRevenueNet) * 100 : 0;

    saleRows.push({
      id:             s.id,
      display_date:   s.sale_date ?? s.created_at.slice(0, 10),
      document_kind:  s.document_kind,
      customer_name:  s.business_partners?.full_name ?? "—",
      revenue_net:    saleRevenueNet,
      revenue_gross:  saleRevenueGross,
      cost_total:     saleCostTotal,
      profit:         saleProfit,
      margin:         saleMargin,
      cost_source:    saleCostSource,
      returned_gross: saleReturnedGross,
      has_returns:    saleReturnedGross > 0,
    });
  }

  const productRows: ProductProfitRow[] = Array.from(prodMap.values()).map((acc) => {
    const profit = acc.revenue_net - acc.cost_total;
    const margin = acc.revenue_net > 0 ? (profit / acc.revenue_net) * 100 : 0;
    return {
      ...acc,
      profit,
      margin,
      has_returns: acc.returned_gross > 0,
    };
  });

  // ── Global KPIs ──────────────────────────────────────────────────────────
  const totalRevenueNet    = saleRows.reduce((s, r) => s + r.revenue_net,  0);
  const totalCost          = saleRows.reduce((s, r) => s + r.cost_total,   0);
  const totalProfit        = totalRevenueNet - totalCost;
  const globalMargin       = totalRevenueNet > 0 ? (totalProfit / totalRevenueNet) * 100 : 0;
  const countSales         = saleRows.length;
  const hasMissingCosts    = productRows.some((r) => r.cost_source === "zero");
  const negativeProducts   = productRows.filter((r) => r.cost_source !== "zero" && r.profit < 0).length;
  const negativeSales      = saleRows.filter((r) => r.cost_total > 0 && r.profit < 0).length;
  // % of items with historical snapshot cost (v17 trigger)
  const snapshotPct = productRows.length > 0
    ? Math.round(productRows.filter((r) => r.cost_source === "snapshot").length / productRows.length * 100)
    : 0;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8">
      <header className="space-y-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="hud-readout">Administración · Rentabilidad</span>
            <h1 className="font-display text-[36px] leading-none tracking-[0.02em] text-foreground sm:text-[42px]">
              RENTABILIDAD
            </h1>
            <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
              Utilidad bruta neta de devoluciones. Costo s/IVA · Ventas s/IVA.
            </p>
          </div>
          <a
            href={`/dashboard/pos/ventas/productos?from=${from}&to=${to}`}
            className="self-start font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60 hover:text-foreground transition-colors"
          >
            Productos vendidos →
          </a>
        </div>
      </header>

      <RentabilidadTable
        from={from}
        to={to}
        productRows={productRows}
        saleRows={saleRows}
        totalRevenueNet={totalRevenueNet}
        totalCost={totalCost}
        totalProfit={totalProfit}
        globalMargin={globalMargin}
        countSales={countSales}
        hasMissingCosts={hasMissingCosts}
        negativeProducts={negativeProducts}
        negativeSales={negativeSales}
        snapshotPct={snapshotPct}
      />
    </div>
  );
}
