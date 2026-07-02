import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { ProductsTable, type ProductRow } from "./products-table";
import { StockTable, type StockRow } from "../stock/stock-table";
import { SupplierFilter } from "./supplier-filter";

export const metadata: Metadata = { title: "Inventario · SaturLub" };
export const dynamic = "force-dynamic";

// ── Types ─────────────────────────────────────────────────────────────────────

type NeedRow = {
  product_id:     string;
  warehouse_id:   string;
  product_name:   string;
  sku:            string;
  unit:           string;
  warehouse_name: string;
  qty:            number;   // current stock (can be negative)
  reorder_point:  number;   // 0 = no minimum set
  suggested_qty:  number;   // how many units to buy
  last_cost:      number | null;
  supplier_id:    string | null;
  supplier_name:  string;
  is_zero:        boolean;  // true when qty <= 0
};

type SupplierGroup = {
  supplier_id:   string | null;
  supplier_name: string;
  rows:          NeedRow[];
};

type RawBalance = {
  id: string;
  product_id: string;
  warehouse_id: string;
  quantity_on_hand: number;
  products: unknown;
  warehouses: { id: string; name: string } | null;
};

// ── Formatters ────────────────────────────────────────────────────────────────

const numFmt = new Intl.NumberFormat("es-EC", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const moneyFmt2 = new Intl.NumberFormat("es-EC", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const moneyFmt4 = new Intl.NumberFormat("es-EC", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ProductosPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; supplier_id?: string }>;
}) {
  const { user, membership } = await getActiveMembership();
  if (!user) redirect("/login");
  if (!membership) redirect("/onboarding");

  const params = await searchParams;
  const activeTab = params.tab ?? "catalogo";
  const supplier_id = params.supplier_id ?? null;

  const supabase = await createClient();

  // ── Parallel queries: suppliers + membership validation ────────────────────
  const { data: suppliersData } = await supabase
    .from("business_partners")
    .select("id, full_name")
    .eq("is_active", true)
    .or("partner_type.eq.supplier,partner_type.eq.distributor")
    .order("full_name");
  const suppliers = (suppliersData ?? []) as Array<{ id: string; full_name: string }>;

  const canManage = membership.role === "owner" || membership.role === "admin";

  // ── Tab 1: Catálogo ────────────────────────────────────────────────────────
  let catalogRows: ProductRow[] = [];
  if (activeTab === "catalogo") {
    const { data: productsV1, error: v1Error } = await supabase
      .from("products")
      .select(
        "id, name, sku, unit, cost_price, default_price, average_cost, last_purchase_cost, product_kind, is_active, has_tax, tax_rate, reorder_point, created_at, last_supplier_id"
      )
      .order("created_at", { ascending: false });

    let rawProducts = productsV1;

    if (v1Error || !productsV1) {
      const { data: fallback } = await supabase
        .from("products")
        .select(
          "id, name, sku, unit, cost_price, product_kind, is_active, has_tax, tax_rate, created_at, last_supplier_id"
        )
        .order("created_at", { ascending: false });
      rawProducts = fallback as typeof productsV1;
    }

    // Filter by supplier if requested
    const filteredProducts = supplier_id
      ? (rawProducts ?? []).filter((p) => p.last_supplier_id === supplier_id)
      : (rawProducts ?? []);

    const productIds = filteredProducts.map((p) => p.id as string);

    let tierPrices: Array<{ product_id: string; tier_code: string; unit_price: number }> = [];
    if (productIds.length) {
      const { data: tiers } = await supabase
        .from("v_product_active_prices")
        .select("product_id, tier_code, unit_price")
        .in("product_id", productIds);
      tierPrices = (tiers ?? []) as typeof tierPrices;
    }

    const priceByProduct = new Map<
      string,
      { mayorista: number | null; distribuidor: number | null }
    >();
    for (const tp of tierPrices) {
      const entry = priceByProduct.get(tp.product_id) ?? { mayorista: null, distribuidor: null };
      if (tp.tier_code === "MAYORISTA") entry.mayorista = tp.unit_price;
      else if (tp.tier_code === "DISTRIBUIDOR") entry.distribuidor = tp.unit_price;
      priceByProduct.set(tp.product_id, entry);
    }

    catalogRows = filteredProducts.map((p) => {
      const extra = priceByProduct.get(p.id as string);
      return {
        id: p.id as string,
        name: p.name as string,
        sku: p.sku as string,
        unit: p.unit as string,
        cost_price: p.cost_price as number | null,
        default_price: (p.default_price as number | null) ?? null,
        average_cost: (p.average_cost as number | null) ?? 0,
        last_purchase_cost: (p.last_purchase_cost as number | null) ?? null,
        price_mayorista: extra?.mayorista ?? null,
        price_distribuidor: extra?.distribuidor ?? null,
        product_kind:  p.product_kind as ProductRow["product_kind"],
        reorder_point: Number((p as { reorder_point?: number | null }).reorder_point ?? 0),
        tax_rate:      p.tax_rate as number | null,
        has_tax:       (p.has_tax as boolean | null) ?? true,
        is_active:     p.is_active as boolean,
        created_at:    p.created_at as string,
      };
    });
  }

  // ── Tab 2: Existencias ─────────────────────────────────────────────────────
  let stockRows: StockRow[] = [];
  let stockProducts: { id: string; name: string; sku: string; cost_price: number | null }[] = [];
  let stockWarehouses: { id: string; name: string }[] = [];

  if (activeTab === "existencias") {
    const { data: stockData, error: stockError } = await supabase
      .from("inventory_balances")
      .select(
        `
        id,
        product_id,
        warehouse_id,
        quantity_on_hand,
        products ( id, name, sku, unit, average_cost, last_purchase_cost, default_price, tax_rate, has_tax, reorder_point, last_supplier_id ),
        warehouses ( id, name )
        `
      )
      .order("quantity_on_hand", { ascending: true });

    if (stockError) {
      console.error("ProductosPage · inventory_balances query:", stockError);
    }

    const { data: rawPresentations } = await supabase
      .from("product_presentations")
      .select("product_id, unit_label, base_qty, sort_order")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    const presentationsByProduct = new Map<string, { unit_label: string; base_qty: number }[]>();
    for (const p of rawPresentations ?? []) {
      const key = p.product_id as string;
      if (!presentationsByProduct.has(key)) presentationsByProduct.set(key, []);
      presentationsByProduct.get(key)!.push({
        unit_label: p.unit_label as string,
        base_qty: Number(p.base_qty),
      });
    }

    const { data: rawProducts } = await supabase
      .from("products")
      .select("id, name, sku, cost_price, last_supplier_id")
      .eq("is_active", true)
      .order("name");

    const { data: rawWarehouses } = await supabase
      .from("warehouses")
      .select("id, name")
      .eq("is_active", true)
      .order("name");

    stockProducts = rawProducts ?? [];
    stockWarehouses = rawWarehouses ?? [];

    type RawProduct = {
      id: string; name: string; sku: string; unit: string;
      average_cost: number | null;
      last_purchase_cost: number | null;
      default_price: number | null;
      tax_rate: number | null;
      has_tax: boolean | null;
      reorder_point: number | null;
      last_supplier_id: string | null;
    };

    const mappedStockRows: StockRow[] = ((stockData ?? []) as unknown as RawBalance[]).map(
      (b) => {
        const p = b.products as RawProduct | null;
        return {
          id: b.id,
          product_id: b.product_id,
          warehouse_id: b.warehouse_id,
          warehouse_name: (b.warehouses as { id: string; name: string } | null)?.name ?? "—",
          product_name: p?.name ?? "—",
          sku: p?.sku ?? "—",
          unit: p?.unit ?? "unidad",
          quantity_on_hand: Number(b.quantity_on_hand ?? 0),
          average_cost: p?.average_cost != null ? Number(p.average_cost) : null,
          last_purchase_cost: p?.last_purchase_cost != null ? Number(p.last_purchase_cost) : null,
          sale_price:    p?.default_price != null ? Number(p.default_price) : null,
          tax_rate:      Number(p?.tax_rate ?? 15),
          has_tax:       p?.has_tax ?? true,
          reorder_point: Number(p?.reorder_point ?? 0),
          presentations: presentationsByProduct.get(b.product_id) ?? [],
          last_supplier_id: p?.last_supplier_id ?? null,
        };
      }
    );

    // Filter by supplier if requested
    stockRows = supplier_id
      ? mappedStockRows.filter((r) => (r as any).last_supplier_id === supplier_id)
      : mappedStockRows;
  }

  // ── Tab 3: Reposición ──────────────────────────────────────────────────────
  let groups: SupplierGroup[] = [];
  let zeroCount = 0;
  let reorderCount = 0;

  if (activeTab === "reposicion") {
    type RawBalanceReposicion = {
      product_id:       string;
      warehouse_id:     string;
      quantity_on_hand: number | string;
      products: {
        id: string; name: string; sku: string; unit: string;
        reorder_point: number | null;
        last_purchase_cost: number | null;
        last_supplier_id: string | null;
      } | null;
      warehouses: { id: string; name: string } | null;
    };

    const { data: rawBalances } = await supabase
      .from("inventory_balances")
      .select(`
        product_id, warehouse_id, quantity_on_hand,
        products ( id, name, sku, unit, reorder_point, last_purchase_cost, last_supplier_id ),
        warehouses ( id, name )
      `)
      .order("quantity_on_hand", { ascending: true });

    type RawHistory = {
      product_id:        string;
      supplier_id:       string;
      last_cost:         number | string;
      purchase_date:     string;
      business_partners: { id: string; full_name: string } | null;
    };

    const { data: rawHistory } = await supabase
      .from("product_supplier_history")
      .select("product_id, supplier_id, last_cost, purchase_date, business_partners ( id, full_name )")
      .order("purchase_date", { ascending: false });

    type SupplierEntry = { supplier_id: string; supplier_name: string; cost: number };
    const bestSupplier = new Map<string, SupplierEntry>();

    for (const h of (rawHistory ?? []) as unknown as RawHistory[]) {
      const cost = Number(h.last_cost ?? 0);
      const prev = bestSupplier.get(h.product_id);
      if (!prev || cost < prev.cost) {
        bestSupplier.set(h.product_id, {
          supplier_id:   h.supplier_id,
          supplier_name: h.business_partners?.full_name ?? "Desconocido",
          cost,
        });
      }
    }

    const needRows: NeedRow[] = [];

    for (const b of (rawBalances ?? []) as unknown as RawBalanceReposicion[]) {
      const p = b.products;
      if (!p) continue;

      // Filter by supplier if requested
      if (supplier_id && p.last_supplier_id !== supplier_id) {
        continue;
      }

      const qty          = Number(b.quantity_on_hand ?? 0);
      const rp           = Number(p.reorder_point ?? 0);
      const isZero       = qty <= 0;
      const belowMin     = rp > 0 && qty <= rp;

      if (!belowMin && !isZero) continue;

      const hist         = bestSupplier.get(b.product_id);
      const suggestedQty = rp > 0
        ? Math.max(0, rp - qty)
        : 0;

      needRows.push({
        product_id:     b.product_id,
        warehouse_id:   b.warehouse_id,
        product_name:   p.name,
        sku:            p.sku,
        unit:           p.unit,
        warehouse_name: b.warehouses?.name ?? "—",
        qty,
        reorder_point:  rp,
        suggested_qty:  suggestedQty,
        last_cost:      hist?.cost ?? (p.last_purchase_cost != null ? Number(p.last_purchase_cost) : null),
        supplier_id:    hist?.supplier_id ?? null,
        supplier_name:  hist?.supplier_name ?? "Sin proveedor definido",
        is_zero:        isZero,
      });
    }

    const groupMap = new Map<string | null, SupplierGroup>();

    for (const r of needRows) {
      const key = r.supplier_id;
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          supplier_id:   r.supplier_id,
          supplier_name: r.supplier_name,
          rows:          [],
        });
      }
      groupMap.get(key)!.rows.push(r);
    }

    groups = Array.from(groupMap.values()).sort((a, b) => {
      if (a.supplier_id === null && b.supplier_id !== null) return 1;
      if (a.supplier_id !== null && b.supplier_id === null) return -1;
      return a.supplier_name.localeCompare(b.supplier_name, "es");
    });

    zeroCount    = needRows.filter((r) => r.is_zero).length;
    reorderCount = needRows.filter((r) => !r.is_zero).length;
  }

  // ── Tab 4: Valoración ──────────────────────────────────────────────────────
  let valorRows: Array<{
    product_id:     string;
    warehouse_id:   string;
    product_name:   string;
    sku:            string;
    unit:           string;
    warehouse_name: string;
    qty:            number;
    cpp:            number;
    value:          number;
    reorder_point:  number;
    last_supplier_id: string | null;
  }> = [];

  let totalValue = 0;
  let productIdsSet = new Set<string>();
  let warehouseIdsSet = new Set<string>();
  let lowStockRows: any[] = [];
  let zeroRows: any[] = [];
  let byWarehouse: any[] = [];
  let topProducts: any[] = [];
  let withValueCount = 0;

  if (activeTab === "valoracion") {
    type RawRowValoracion = {
      product_id: string;
      warehouse_id: string;
      quantity_on_hand: number | string;
      products: { name: string; sku: string; unit: string; average_cost: number | null; reorder_point: number | null; last_supplier_id: string | null } | null;
      warehouses: { id: string; name: string } | null;
    };

    const { data: valorData, error: valorError } = await supabase
      .from("inventory_balances")
      .select(`
        product_id,
        warehouse_id,
        quantity_on_hand,
        products ( name, sku, unit, average_cost, reorder_point, last_supplier_id ),
        warehouses ( id, name )
      `)
      .order("quantity_on_hand", { ascending: false });

    if (valorError) console.error("ValorInventarioPage query error:", valorError);

    const mappedValorRows = ((valorData ?? []) as unknown as RawRowValoracion[]).map((b) => {
      const qty = Math.max(0, Number(b.quantity_on_hand ?? 0));
      const cpp = Math.max(0, Number(b.products?.average_cost ?? 0));
      return {
        product_id:     b.product_id,
        warehouse_id:   b.warehouse_id,
        product_name:   b.products?.name  ?? "—",
        sku:            b.products?.sku   ?? "—",
        unit:           b.products?.unit  ?? "unidad",
        warehouse_name: b.warehouses?.name ?? "Sin bodega",
        qty,
        cpp,
        value:         qty * cpp,
        reorder_point: Number(b.products?.reorder_point ?? 0),
        last_supplier_id: b.products?.last_supplier_id ?? null,
      };
    });

    // Filter by supplier if requested
    valorRows = supplier_id
      ? mappedValorRows.filter((r) => r.last_supplier_id === supplier_id)
      : mappedValorRows;

    totalValue = valorRows.reduce((s, r) => s + r.value, 0);
    productIdsSet = new Set(valorRows.map((r) => r.product_id));
    warehouseIdsSet = new Set(valorRows.map((r) => r.warehouse_id));
    lowStockRows = valorRows.filter((r) =>
      r.qty > 0 && r.reorder_point > 0 && r.qty <= r.reorder_point
    );
    zeroRows = valorRows.filter((r) => r.qty <= 0);

    type WHAcc = { name: string; value: number; products: number };
    const whMap = new Map<string, WHAcc>();
    for (const r of valorRows) {
      const e = whMap.get(r.warehouse_id) ?? { name: r.warehouse_name, value: 0, products: 0 };
      e.value    += r.value;
      e.products += 1;
      whMap.set(r.warehouse_id, e);
    }
    byWarehouse = Array.from(whMap.values()).sort((a, b) => b.value - a.value);

    topProducts = [...valorRows]
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 20);

    withValueCount = valorRows.filter((r) => r.value > 0).length;
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8">
      {/* Header */}
      <header className="space-y-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <span className="hud-readout">Inventario · Control Unificado</span>
            <h1 className="font-display text-[36px] leading-none tracking-[0.02em] text-foreground sm:text-[42px] uppercase">
              PRODUCTOS & INVENTARIO
            </h1>
            <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
              {activeTab === "catalogo" && "Registra tus productos, SKUs, costos de referencia y tiers de precios."}
              {activeTab === "existencias" && "Control del stock actual por bodega y cálculo de empaques."}
              {activeTab === "reposicion" && "Productos bajo el stock mínimo o agotados, agrupados por proveedor sugerido."}
              {activeTab === "valoracion" && "Análisis del valor monetario total del inventario basado en el CPP."}
            </p>
          </div>
        </div>

        {/* Tab selection + Supplier filter row */}
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-steel-800/80 pb-4">
          <div className="flex rounded-sm border border-steel-700 bg-steel-900">
            {(["catalogo", "existencias", "reposicion", "valoracion"] as const).map((t) => {
              const label = t === "catalogo" ? "Catálogo" :
                            t === "existencias" ? "Existencias" :
                            t === "reposicion" ? "Reposición" : "Valoración";
              const query = new URLSearchParams();
              query.set("tab", t);
              if (supplier_id) {
                query.set("supplier_id", supplier_id);
              }
              return (
                <Link
                  key={t}
                  href={`/dashboard/inventario/productos?${query.toString()}`}
                  className={[
                    "px-4 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] transition-colors",
                    activeTab === t ? "bg-steel-700 text-foreground" : "text-muted-foreground/70 hover:text-foreground",
                  ].join(" ")}
                >
                  {label}
                </Link>
              );
            })}
          </div>

          <SupplierFilter suppliers={suppliers} activeSupplierId={supplier_id ?? ""} />
        </div>
      </header>

      {/* Render Active Tab */}
      {activeTab === "catalogo" && (
        <ProductsTable initialRows={catalogRows} canManage={canManage} />
      )}

      {activeTab === "existencias" && (
        <StockTable
          initialRows={stockRows}
          products={stockProducts}
          warehouses={stockWarehouses}
        />
      )}

      {activeTab === "reposicion" && (
        <div className="space-y-8">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              {zeroCount > 0 && (
                <span className="rounded-sm border border-red-600/50 bg-red-700/10 px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-red-300">
                  {zeroCount} sin stock
                </span>
              )}
              {reorderCount > 0 && (
                <span className="rounded-sm border border-safety-500/50 bg-safety-500/10 px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-safety-500">
                  {reorderCount} reponer
                </span>
              )}
            </div>
          </div>

          {groups.length === 0 ? (
            <div className="panel rounded-sm px-6 py-16 text-center">
              <OkIcon className="mx-auto mb-3 h-8 w-8 text-signal-400" />
              <p className="font-mono text-[13px] font-bold uppercase tracking-[0.14em] text-signal-400">
                Todo el inventario está sobre el mínimo configurado
              </p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Cuando un producto baje del stock mínimo aparecerá aquí.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {groups.map((group) => (
                <SupplierGroupCard
                  key={group.supplier_id ?? "none"}
                  group={group}
                />
              ))}
            </div>
          )}

          {groups.length > 0 && (
            <aside className="rounded-sm border border-steel-700/50 bg-steel-900/30 px-5 py-3.5">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60">
                Fase 2 pendiente
              </p>
              <p className="mt-0.5 text-[12px] text-muted-foreground/70">
                El botón &quot;Nueva compra&quot; abrirá la OC pre-llenada con el proveedor y los ítems sugeridos.
                Por ahora redirige al formulario vacío.
              </p>
            </aside>
          )}
        </div>
      )}

      {activeTab === "valoracion" && (
        <div className="space-y-8">
          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <KpiCard label="Valor total"  value={moneyFmt2.format(totalValue)}   highlight />
            <KpiCard label="Productos"    value={String(productIdsSet.size)}     sub="con saldo" />
            <KpiCard label="Bodegas"      value={String(warehouseIdsSet.size)} />
            <KpiCard
              label="Reponer"
              value={String(lowStockRows.length)}
              sub={lowStockRows.length > 0 ? "bajo mínimo" : "sin alertas"}
              warn={lowStockRows.length > 0}
            />
            <KpiCard
              label="Sin stock"
              value={String(zeroRows.length)}
              sub={zeroRows.length > 0 ? "stock = 0" : undefined}
              warn={zeroRows.length > 0}
            />
          </div>

          {/* Value by warehouse */}
          {byWarehouse.length > 0 && (
            <section className="panel rounded-sm">
              <header className="top-highlight border-b-2 border-steel-700 bg-steel-900/70 px-5 py-3.5">
                <h2 className="font-display text-[16px] tracking-[0.04em]">VALOR POR BODEGA</h2>
              </header>
              <div className="divide-y divide-steel-800/60">
                {byWarehouse.map((wh) => {
                  const pct = totalValue > 0 ? (wh.value / totalValue) * 100 : 0;
                  return (
                    <div key={wh.name} className="px-5 py-4">
                      <div className="mb-2 flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <span className="text-[13px] font-semibold text-foreground">{wh.name}</span>
                          <span className="ml-2 font-mono text-[10px] text-muted-foreground/60">
                            {wh.products} producto{wh.products !== 1 ? "s" : ""}
                          </span>
                        </div>
                        <div className="shrink-0 text-right">
                          <span className="font-mono text-[15px] font-bold tabular-nums text-safety-500">
                            {moneyFmt2.format(wh.value)}
                          </span>
                          <span className="ml-2 font-mono text-[11px] tabular-nums text-muted-foreground/55">
                            {pct.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-steel-800">
                        <div
                          className="h-full rounded-full bg-safety-500/55 transition-all"
                          style={{ width: `${Math.min(100, pct).toFixed(2)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Top 20 by value */}
          {topProducts.length > 0 && (
            <section className="panel rounded-sm">
              <header className="top-highlight flex items-center justify-between border-b-2 border-steel-700 bg-steel-900/70 px-5 py-3.5">
                <h2 className="font-display text-[16px] tracking-[0.04em]">TOP 20 POR VALOR</h2>
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
                  CPP × stock
                </span>
              </header>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-left">
                  <thead className="border-b border-steel-800 bg-steel-950/40">
                    <tr>
                      <th className="px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground w-9">#</th>
                      <th className="px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Producto</th>
                      <th className="px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Bodega</th>
                      <th className="px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground text-right">Stock</th>
                      <th className="px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground text-right">CPP</th>
                      <th className="px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground text-right">Valor</th>
                      <th className="px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground w-[130px]">% del total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topProducts.map((r, idx) => {
                      const pct = totalValue > 0 ? (r.value / totalValue) * 100 : 0;
                      return (
                        <tr
                          key={`${r.product_id}:${r.warehouse_id}`}
                          className="border-b border-steel-800/50 transition-colors hover:bg-steel-900/40"
                        >
                          <td className="px-5 py-3.5 align-top font-mono text-[11px] tabular-nums text-muted-foreground/50">{idx + 1}</td>
                          <td className="px-5 py-3.5 align-top">
                            <div className="font-semibold text-foreground">{r.product_name}</div>
                            <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/60">
                              {r.sku} · {r.unit}
                            </div>
                          </td>
                          <td className="px-5 py-3.5 align-top text-[12.5px] text-muted-foreground">{r.warehouse_name}</td>
                          <td className="px-5 py-3.5 align-top text-right font-mono text-[13px] tabular-nums text-foreground">
                            {numFmt.format(r.qty)}
                          </td>
                          <td className="px-5 py-3.5 align-top text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                            {moneyFmt2.format(r.cpp)}
                          </td>
                          <td className="px-5 py-3.5 align-top text-right font-mono text-[14px] font-bold tabular-nums text-safety-500">
                            {moneyFmt2.format(r.value)}
                          </td>
                          <td className="px-5 py-3.5 align-top">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-steel-800">
                                <div
                                  className="h-full rounded-full bg-safety-500/45"
                                  style={{ width: `${Math.min(100, pct).toFixed(2)}%` }}
                                />
                              </div>
                              <span className="w-10 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground/55">
                                {pct.toFixed(1)}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {withValueCount > 20 && (
                <div className="border-t border-steel-800 px-5 py-2.5">
                  <p className="font-mono text-[10px] text-muted-foreground/50">
                    Top 20 de {withValueCount} productos con valor {">"} 0.
                  </p>
                </div>
              )}
            </section>
          )}

          {/* Low stock */}
          {lowStockRows.length > 0 && (
            <section className="panel rounded-sm">
              <header className="top-highlight flex items-center justify-between border-b-2 border-steel-700 bg-steel-900/70 px-5 py-3.5">
                <h2 className="font-display text-[16px] tracking-[0.04em]">
                  REPONER
                  <span className="ml-2 font-mono text-[12px] normal-case tracking-normal text-muted-foreground/70">
                    bajo stock mínimo configurado
                  </span>
                </h2>
              </header>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px] text-left">
                  <thead className="border-b border-steel-800 bg-steel-950/40">
                    <tr>
                      <th className="px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Producto</th>
                      <th className="px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Bodega</th>
                      <th className="px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground text-right">Stock actual</th>
                      <th className="px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground text-right">CPP</th>
                      <th className="px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground text-right">Valor restante</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lowStockRows
                      .sort((a, b) => a.qty - b.qty)
                      .map((r) => (
                        <tr
                          key={`${r.product_id}:${r.warehouse_id}`}
                          className="border-b border-steel-800/50 transition-colors hover:bg-steel-900/40"
                        >
                          <td className="px-5 py-3.5 align-top">
                            <div className="font-semibold text-foreground">{r.product_name}</div>
                            <div className="font-mono text-[10px] text-muted-foreground/60">{r.sku}</div>
                          </td>
                          <td className="px-5 py-3.5 align-top text-[12.5px] text-muted-foreground">{r.warehouse_name}</td>
                          <td className="px-5 py-3.5 align-top text-right font-mono text-[14px] font-bold tabular-nums text-red-400">
                            {numFmt.format(r.qty)}
                          </td>
                          <td className="px-5 py-3.5 align-top text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                            {moneyFmt2.format(r.cpp)}
                          </td>
                          <td className="px-5 py-3.5 align-top text-right font-mono text-[13px] tabular-nums text-foreground">
                            {moneyFmt2.format(r.value)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Empty state */}
          {valorRows.length === 0 && (
            <div className="panel rounded-sm px-6 py-16 text-center">
              <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-muted-foreground">
                Sin balances de inventario. Recibe mercancía para ver el valor aquí.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── SupplierGroupCard ─────────────────────────────────────────────────────────

function SupplierGroupCard({
  group,
}: {
  group: SupplierGroup;
}) {
  const totalSuggestedValue = group.rows.reduce((s, r) => {
    if (r.last_cost == null || r.suggested_qty === 0) return s;
    return s + r.suggested_qty * r.last_cost;
  }, 0);

  const zeroInGroup    = group.rows.filter((r) => r.is_zero).length;
  const reorderInGroup = group.rows.filter((r) => !r.is_zero).length;

  return (
    <section className="panel rounded-sm">
      {/* Group header */}
      <header className="top-highlight flex flex-col gap-3 border-b-2 border-steel-700 bg-steel-900/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-[17px] tracking-[0.03em]">
              {group.supplier_name}
            </h2>
            {group.supplier_id === null ? (
              <span className="rounded-sm border border-steel-600 px-1.5 py-0.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground/60">
                Sin proveedor
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            {zeroInGroup > 0 ? (
              <span className="font-mono text-[10px] text-red-400">
                {zeroInGroup} sin stock
              </span>
            ) : null}
            {reorderInGroup > 0 ? (
              <span className="font-mono text-[10px] text-safety-500/80">
                {reorderInGroup} bajo mínimo
              </span>
            ) : null}
            {totalSuggestedValue > 0 ? (
              <span className="font-mono text-[10px] text-muted-foreground/60">
                · estimado {moneyFmt2.format(totalSuggestedValue)}
              </span>
            ) : null}
          </div>
        </div>

        {/* CTA ─ Purchase redirect */}
        <Link
          href="/dashboard/compras/nueva"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-sm border border-safety-500/50 bg-safety-500/10 px-4 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-safety-500 transition-colors hover:bg-safety-500/20"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          Nueva compra
        </Link>
      </header>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[700px] text-left">
          <thead className="border-b border-steel-800 bg-steel-950/40">
            <tr>
              <th className="px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Producto</th>
              <th className="px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Bodega</th>
              <th className="px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground text-right">Stock actual</th>
              <th className="px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground text-right">Mínimo</th>
              <th className="px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground text-right">Pedir</th>
              <th className="px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground text-right">Últ. costo</th>
              <th className="px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground text-right">Est. compra</th>
            </tr>
          </thead>
          <tbody>
            {group.rows.map((r) => {
              const estCompra =
                r.last_cost != null && r.suggested_qty > 0
                  ? r.last_cost * r.suggested_qty
                  : null;
              return (
                <tr
                  key={`${r.product_id}:${r.warehouse_id}`}
                  className={[
                    "border-b border-steel-800/50 transition-colors hover:bg-steel-900/40",
                    r.is_zero ? "bg-red-950/10" : "",
                  ].join(" ")}
                >
                  <td className="px-5 py-3.5 align-middle">
                    <div className="font-semibold text-foreground">{r.product_name}</div>
                    <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/60">
                      {r.sku} · {r.unit}
                    </div>
                  </td>
                  <td className="px-5 py-3.5 align-middle text-[12.5px] text-muted-foreground">{r.warehouse_name}</td>
                  <td className="px-5 py-3.5 align-middle text-right">
                    <span className={[
                      "font-mono text-[14px] font-bold tabular-nums",
                      r.is_zero ? "text-red-400" : "text-safety-500",
                    ].join(" ")}>
                      {numFmt.format(r.qty)}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 align-middle text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                    {r.reorder_point > 0 ? numFmt.format(r.reorder_point) : "—"}
                  </td>
                  <td className="px-5 py-3.5 align-middle text-right">
                    {r.suggested_qty > 0 ? (
                      <span className="font-mono text-[14px] font-bold tabular-nums text-foreground">
                        {numFmt.format(r.suggested_qty)}
                      </span>
                    ) : (
                      <span className="font-mono text-[11px] text-muted-foreground/40">
                        {r.reorder_point === 0 ? "Sin mín." : "0"}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 align-middle text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                    {r.last_cost != null ? moneyFmt4.format(r.last_cost) : <span className="text-muted-foreground/35">—</span>}
                  </td>
                  <td className="px-5 py-3.5 align-middle text-right font-mono text-[13px] tabular-nums text-foreground">
                    {estCompra != null ? moneyFmt2.format(estCompra) : <span className="text-muted-foreground/35">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {/* Group totals */}
          {totalSuggestedValue > 0 && (
            <tfoot>
              <tr className="border-t-2 border-steel-700 bg-steel-950/60">
                <td colSpan={6} className="px-5 py-2.5 text-right font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">
                  Total estimado compra
                </td>
                <td className="px-5 py-2.5 text-right font-mono text-[14px] font-bold tabular-nums text-safety-500">
                  {moneyFmt2.format(totalSuggestedValue)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Mobile cards */}
      <div className="divide-y divide-steel-800/60 sm:hidden">
        {group.rows.map((r) => {
          const estCompra =
            r.last_cost != null && r.suggested_qty > 0
              ? r.last_cost * r.suggested_qty
              : null;
          return (
            <div
              key={`${r.product_id}:${r.warehouse_id}`}
              className={[
                "px-4 py-3.5",
                r.is_zero ? "bg-red-950/10" : "",
              ].join(" ")}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold leading-tight text-foreground">{r.product_name}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/60">
                    {r.sku} · {r.unit} · {r.warehouse_name}
                  </div>
                </div>
                {r.is_zero ? (
                  <span className="shrink-0 rounded-sm border border-red-600/50 bg-red-700/10 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-red-400">
                    Sin stock
                  </span>
                ) : (
                  <span className="shrink-0 rounded-sm border border-safety-500/40 bg-safety-500/10 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-safety-500">
                    Reponer
                  </span>
                )}
              </div>
              <div className="mt-2.5 grid grid-cols-4 gap-2 border-t border-steel-800/40 pt-2.5 text-center">
                <MobileCell label="Stock" value={numFmt.format(r.qty)} dim={r.qty <= 0} />
                <MobileCell label="Mínimo" value={r.reorder_point > 0 ? numFmt.format(r.reorder_point) : "—"} />
                <MobileCell
                  label="Pedir"
                  value={r.suggested_qty > 0 ? numFmt.format(r.suggested_qty) : "—"}
                  bold
                />
                <MobileCell
                  label="Est."
                  value={estCompra != null ? moneyFmt2.format(estCompra) : "—"}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Helper UI Components ──────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  highlight,
  warn,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
  warn?: boolean;
}) {
  return (
    <div className={["panel rounded-sm px-4 py-3.5", highlight ? "border-safety-500/50" : ""].join(" ")}>
      <div className="font-mono text-[9.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">
        {label}
      </div>
      <div
        className={[
          "mt-1 font-mono text-[20px] font-bold tabular-nums sm:text-[22px]",
          highlight ? "text-safety-500" : warn ? "text-red-400" : "text-foreground",
        ].join(" ")}
      >
        {value}
      </div>
      {sub ? (
        <div className="mt-0.5 font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground/50">
          {sub}
        </div>
      ) : null}
    </div>
  );
}

function MobileCell({
  label,
  value,
  bold,
  dim,
}: {
  label: string;
  value: string;
  bold?: boolean;
  dim?: boolean;
}) {
  return (
    <div>
      <div className="font-mono text-[8.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground/60">
        {label}
      </div>
      <div className={[
        "mt-0.5 font-mono text-[12px] tabular-nums",
        bold ? "font-bold text-foreground" : dim ? "text-red-400" : "text-muted-foreground",
      ].join(" ")}>
        {value}
      </div>
    </div>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function OkIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}
