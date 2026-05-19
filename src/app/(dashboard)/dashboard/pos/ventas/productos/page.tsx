import type { Metadata } from "next";
import { redirect }      from "next/navigation";
import { createClient }  from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { getPosPermissions }   from "@/lib/auth/permissions";
import { todayEC, clampToTodayEC } from "@/lib/date-ec";
import { ProductosTable } from "./productos-table";

export const metadata: Metadata = { title: "Productos vendidos · SaturLub" };
export const dynamic = "force-dynamic";

// ── Types ──────────────────────────────────────────────────────────────────

type CostSource = "snapshot" | "cpp" | "last" | "zero";

type RawItem = {
  id:             string;
  sale_id:        string;
  product_id:     string | null;
  item_name:      string | null;
  quantity:       number | string;
  base_qty:       number | string | null;
  unit_price:     number | string;
  discount_amount: number | string | null;
  line_total:     number | string;
  is_taxable:     boolean;
  tax_rate:       number | string;
  unit_cost:      number | string | null;
};

type RawProduct = {
  id:                 string;
  name:               string;
  sku:                string;
  unit:               string;
  average_cost:       number | string | null;
  last_purchase_cost: number | string | null;
};

type RawReturnItem = {
  sale_item_id:      string;
  quantity_returned: number | string;
  line_refund:       number | string;
};

export type DrillItem = {
  sale_id:       string;
  sale_date:     string;
  customer_name: string;
  warehouse_id:  string | null;
  qty:           number;
  unit_price:    number;
  gross:         number;
  net_refund:    number;
};

export type ProductSalesRow = {
  product_id:     string | null;
  name:           string;
  sku:            string;
  unit:           string;
  qty_net:        number;
  qty_returned:   number;
  gross_billed:   number;
  net_revenue:    number;
  total_discount: number;
  total_iva:      number;
  cost_estimate:  number;
  cost_source:    CostSource;
  gross_profit:   number;
  margin_pct:     number;
  last_sale_date: string;
  sale_count:     number;
  drill:          DrillItem[];
};

export type WarehouseOption = {
  id:   string;
  name: string;
};

// ── Cost resolution (mirrors rentabilidad.tsx) ─────────────────────────────
// Priority: sale_items.unit_cost (snapshot) → products.average_cost (CPP)
//           → products.last_purchase_cost → 0

function resolveCost(
  itemCost: number | string | null | undefined,
  product:  RawProduct | undefined,
): { unitCost: number; source: CostSource } {
  if (itemCost !== null && itemCost !== undefined) {
    const snap = Number(itemCost);
    return { unitCost: snap, source: snap > 0 ? "snapshot" : "zero" };
  }
  if (!product) return { unitCost: 0, source: "zero" };
  const cpp  = Number(product.average_cost       ?? 0);
  const last = Number(product.last_purchase_cost ?? 0);
  if (cpp  > 0) return { unitCost: cpp,  source: "cpp"  };
  if (last > 0) return { unitCost: last, source: "last" };
  return { unitCost: 0, source: "zero" };
}

// ── Default range ──────────────────────────────────────────────────────────

function defaultRange(): { from: string; to: string } {
  const today      = todayEC();
  const [year, mo] = today.split("-");
  return { from: `${year}-${mo}-01`, to: today };
}

// ── Page ───────────────────────────────────────────────────────────────────

export default async function ProductosVendidosPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; warehouse?: string }>;
}) {
  const { user, membership } = await getActiveMembership();
  if (!user)       redirect("/login");
  if (!membership) redirect("/onboarding");

  const permissions = getPosPermissions(membership.role);
  if (!permissions.canUsePOS) redirect("/dashboard");

  const params = await searchParams;
  const def    = defaultRange();
  const from   = params.from ?? def.from;
  const to     = clampToTodayEC(params.to ?? def.to);
  const warehouseFilter = params.warehouse ?? null;

  const supabase = await createClient();
  const tenantId = membership.tenant_id;

  // ── 1. Parallel: sales (in range) + products ───────────────────────────
  const [{ data: salesRaw }, { data: productsRaw }, { data: warehousesRaw }] =
    await Promise.all([
      supabase
        .from("sales")
        .select("id, sale_date, created_at, warehouse_id, customer_id")
        .eq("tenant_id", tenantId)
        .eq("status", "confirmed")
        .gte("sale_date", from)
        .lte("sale_date", to)
        .order("sale_date", { ascending: false })
        .limit(2000),

      supabase
        .from("products")
        .select("id, name, sku, unit, average_cost, last_purchase_cost")
        .eq("tenant_id", tenantId)
        .limit(3000),

      supabase
        .from("warehouses")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .order("name"),
    ]);

  const allSales    = (salesRaw    ?? []) as any[];
  const products    = (productsRaw ?? []) as RawProduct[];
  const warehouses  = (warehousesRaw ?? []) as WarehouseOption[];

  // Filter by warehouse if provided
  const sales = warehouseFilter
    ? allSales.filter((s) => s.warehouse_id === warehouseFilter)
    : allSales;

  const saleIds = sales.map((s: any) => s.id as string);
  const productById = new Map<string, RawProduct>(products.map((p) => [p.id, p]));

  // ── 2. Sale items + customers (parallel, depend on saleIds) ───────────
  const customerIds = [...new Set(sales.map((s: any) => s.customer_id as string).filter(Boolean))];

  const [{ data: itemsRaw }, { data: returnsRaw }, { data: customersRaw }] = await Promise.all([
    saleIds.length > 0
      ? supabase
          .from("sale_items")
          .select("id, sale_id, product_id, item_name, quantity, base_qty, unit_price, discount_amount, line_total, is_taxable, tax_rate, unit_cost")
          .in("sale_id", saleIds)
      : (Promise.resolve({ data: [] }) as any),

    saleIds.length > 0
      ? supabase
          .from("sale_returns")
          .select("original_sale_id, sale_return_items(sale_item_id, quantity_returned, line_refund)")
          .in("original_sale_id", saleIds)
      : (Promise.resolve({ data: [] }) as any),

    customerIds.length > 0
      ? supabase
          .from("business_partners")
          .select("id, full_name")
          .in("id", customerIds)
      : (Promise.resolve({ data: [] }) as any),
  ]);

  const items     = (itemsRaw     ?? []) as RawItem[];
  const customers = (customersRaw ?? []) as { id: string; full_name: string }[];

  // ── 3. Build lookup maps ───────────────────────────────────────────────
  const customerMap = new Map<string, string>(
    customers.map((c) => [c.id, c.full_name]),
  );

  const saleMeta = new Map<string, { sale_date: string; customer_name: string; warehouse_id: string | null }>(
    sales.map((s: any) => [
      s.id as string,
      {
        sale_date:     s.sale_date      as string,
        customer_name: customerMap.get(s.customer_id as string) ?? "—",
        warehouse_id:  s.warehouse_id   as string | null,
      },
    ]),
  );

  // Returns: build map item_id → { qty, lineRefund }
  const returnedByItem = new Map<string, { qty: number; lineRefund: number }>();
  for (const ret of (returnsRaw ?? []) as any[]) {
    for (const ri of (ret.sale_return_items ?? []) as RawReturnItem[]) {
      const cur = returnedByItem.get(ri.sale_item_id) ?? { qty: 0, lineRefund: 0 };
      cur.qty        += Number(ri.quantity_returned ?? 0);
      cur.lineRefund += Number(ri.line_refund        ?? 0);
      returnedByItem.set(ri.sale_item_id, cur);
    }
  }

  // ── 4. Aggregate by product ────────────────────────────────────────────
  type Acc = {
    product_id:     string | null;
    name:           string;
    sku:            string;
    unit:           string;
    qty_net:        number;
    qty_returned:   number;
    gross_billed:   number;
    net_revenue:    number;
    total_discount: number;
    cost_estimate:  number;
    cost_source:    CostSource;
    last_sale_date: string;
    sale_ids:       Set<string>;
    drill:          DrillItem[];
  };

  const costSourceRank = (src: CostSource) =>
    src === "snapshot" ? 4 : src === "cpp" ? 3 : src === "last" ? 2 : 1;

  const accMap = new Map<string, Acc>();

  const getKey = (item: RawItem): string =>
    item.product_id ?? `manual:${(item.item_name ?? "").toLowerCase().trim()}`;

  for (const item of items) {
    const key       = getKey(item);
    const product   = item.product_id ? productById.get(item.product_id) : undefined;
    const qty       = Number(item.quantity    ?? 0);
    const baseQty   = Number(item.base_qty    ?? 1);
    const gross     = Number(item.line_total  ?? 0);
    const discount  = Number(item.discount_amount ?? 0);
    const rate      = Number(item.tax_rate    ?? 0);
    const taxable   = item.is_taxable !== false;
    const lineNet   = taxable && rate > 0 ? gross / (1 + rate / 100) : gross;
    const unitPrice = Number(item.unit_price  ?? 0);

    const { unitCost, source } = resolveCost(item.unit_cost, product);
    const lineCost = qty * baseQty * unitCost;

    // Returns netting
    const ret       = returnedByItem.get(item.id) ?? { qty: 0, lineRefund: 0 };
    const retNet    = taxable && rate > 0 ? ret.lineRefund / (1 + rate / 100) : ret.lineRefund;
    const retCost   = qty > 0 ? lineCost * (ret.qty / qty) : 0;
    const netQty    = qty - ret.qty;
    const netGross  = gross - ret.lineRefund;
    const netRevenue = lineNet - retNet;

    const meta = saleMeta.get(item.sale_id);

    const acc = accMap.get(key) ?? {
      product_id:     item.product_id,
      name:           product?.name ?? item.item_name ?? "Producto manual",
      sku:            product?.sku  ?? "—",
      unit:           product?.unit ?? "",
      qty_net:        0,
      qty_returned:   0,
      gross_billed:   0,
      net_revenue:    0,
      total_discount: 0,
      cost_estimate:  0,
      cost_source:    "zero",
      last_sale_date: "",
      sale_ids:       new Set<string>(),
      drill:          [],
    };

    acc.qty_net        += netQty;
    acc.qty_returned   += ret.qty;
    acc.gross_billed   += netGross;
    acc.net_revenue    += netRevenue;
    acc.total_discount += discount;
    acc.cost_estimate  += lineCost - retCost;
    acc.sale_ids.add(item.sale_id);

    // Keep highest-confidence cost source
    if (costSourceRank(source) > costSourceRank(acc.cost_source)) {
      acc.cost_source = source;
    }

    // Track last sale date
    const saleDate = meta?.sale_date ?? "";
    if (saleDate > acc.last_sale_date) acc.last_sale_date = saleDate;

    // Drill item
    acc.drill.push({
      sale_id:       item.sale_id,
      sale_date:     meta?.sale_date     ?? "",
      customer_name: meta?.customer_name ?? "—",
      warehouse_id:  meta?.warehouse_id  ?? null,
      qty:           qty,
      unit_price:    unitPrice,
      gross:         gross,
      net_refund:    ret.lineRefund,
    });

    accMap.set(key, acc);
  }

  // ── 5. Convert to output rows ─────────────────────────────────────────
  const rows: ProductSalesRow[] = Array.from(accMap.values()).map((acc) => {
    const profit = acc.net_revenue - acc.cost_estimate;
    const margin = acc.net_revenue > 0 ? (profit / acc.net_revenue) * 100 : 0;
    return {
      product_id:     acc.product_id,
      name:           acc.name,
      sku:            acc.sku,
      unit:           acc.unit,
      qty_net:        Math.max(0, acc.qty_net),
      qty_returned:   acc.qty_returned,
      gross_billed:   acc.gross_billed,
      net_revenue:    acc.net_revenue,
      total_discount: acc.total_discount,
      total_iva:      acc.gross_billed - acc.net_revenue,
      cost_estimate:  acc.cost_estimate,
      cost_source:    acc.cost_source,
      gross_profit:   profit,
      margin_pct:     margin,
      last_sale_date: acc.last_sale_date,
      sale_count:     acc.sale_ids.size,
      drill:          acc.drill.sort((a, b) => (b.sale_date > a.sale_date ? 1 : -1)),
    };
  });

  return (
    <ProductosTable
      rows={rows}
      warehouses={warehouses}
      from={from}
      to={to}
      warehouseFilter={warehouseFilter}
    />
  );
}
