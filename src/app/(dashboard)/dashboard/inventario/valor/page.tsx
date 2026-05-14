import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";

export const metadata: Metadata = { title: "Valor de inventario · Inventario" };
export const dynamic = "force-dynamic";

const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

const numFmt = new Intl.NumberFormat("es-EC", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

type RawRow = {
  product_id: string;
  warehouse_id: string;
  quantity_on_hand: number | string;
  products: { name: string; sku: string; unit: string; average_cost: number | null; reorder_point: number | null } | null;
  warehouses: { id: string; name: string } | null;
};

export default async function ValorInventarioPage() {
  const { user, membership } = await getActiveMembership();
  if (!user)       redirect("/login");
  if (!membership) redirect("/onboarding");

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("inventory_balances")
    .select(`
      product_id,
      warehouse_id,
      quantity_on_hand,
      products ( name, sku, unit, average_cost, reorder_point ),
      warehouses ( id, name )
    `)
    .order("quantity_on_hand", { ascending: false });

  if (error) console.error("ValorInventarioPage:", error);

  // ── Flatten ──────────────────────────────────────────────────────────────
  const rows = ((data ?? []) as unknown as RawRow[]).map((b) => {
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
    };
  });

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const totalValue     = rows.reduce((s, r) => s + r.value, 0);
  const productIds     = new Set(rows.map((r) => r.product_id));
  const warehouseIds   = new Set(rows.map((r) => r.warehouse_id));
  // Uses reorder_point per product; falls back to qty=0 as universal alert
  const lowStockRows   = rows.filter((r) =>
    r.qty > 0 && r.reorder_point > 0 && r.qty <= r.reorder_point
  );
  const zeroRows       = rows.filter((r) => r.qty <= 0);

  // ── By warehouse ──────────────────────────────────────────────────────────
  type WHAcc = { name: string; value: number; products: number };
  const whMap = new Map<string, WHAcc>();
  for (const r of rows) {
    const e = whMap.get(r.warehouse_id) ?? { name: r.warehouse_name, value: 0, products: 0 };
    e.value    += r.value;
    e.products += 1;
    whMap.set(r.warehouse_id, e);
  }
  const byWarehouse = Array.from(whMap.values()).sort((a, b) => b.value - a.value);

  // ── Top 20 by value ───────────────────────────────────────────────────────
  const topProducts = [...rows]
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 20);

  const withValueCount = rows.filter((r) => r.value > 0).length;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="space-y-2">
        <span className="hud-readout">Inventario · Gerencial</span>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-[36px] leading-none tracking-[0.02em] text-foreground sm:text-[42px]">
              VALOR DE INVENTARIO
            </h1>
            <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
              CPP × stock actual. Se actualiza automáticamente con cada compra, venta o ajuste.
            </p>
          </div>
          <Link
            href="/dashboard/inventario/stock"
            className="shrink-0 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
          >
            ← Existencias
          </Link>
        </div>
      </header>

      {/* ── KPI cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard label="Valor total"  value={moneyFmt.format(totalValue)}   highlight />
        <KpiCard label="Productos"    value={String(productIds.size)}        sub="con saldo" />
        <KpiCard label="Bodegas"      value={String(warehouseIds.size)} />
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

      {/* ── Value by warehouse ─────────────────────────────────────────── */}
      {byWarehouse.length > 0 ? (
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
                        {moneyFmt.format(wh.value)}
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
      ) : null}

      {/* ── Top 20 by value ────────────────────────────────────────────── */}
      {topProducts.length > 0 ? (
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
                  <Th className="w-9">#</Th>
                  <Th>Producto</Th>
                  <Th>Bodega</Th>
                  <Th className="text-right">Stock</Th>
                  <Th className="text-right">CPP</Th>
                  <Th className="text-right">Valor</Th>
                  <Th className="w-[130px]">% del total</Th>
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
                      <Td className="font-mono text-[11px] tabular-nums text-muted-foreground/50">{idx + 1}</Td>
                      <Td>
                        <div className="font-semibold text-foreground">{r.product_name}</div>
                        <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/60">
                          {r.sku} · {r.unit}
                        </div>
                      </Td>
                      <Td className="text-[12.5px] text-muted-foreground">{r.warehouse_name}</Td>
                      <Td className="text-right font-mono text-[13px] tabular-nums text-foreground">
                        {numFmt.format(r.qty)}
                      </Td>
                      <Td className="text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                        {moneyFmt.format(r.cpp)}
                      </Td>
                      <Td className="text-right font-mono text-[14px] font-bold tabular-nums text-safety-500">
                        {moneyFmt.format(r.value)}
                      </Td>
                      <Td>
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
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {withValueCount > 20 ? (
            <div className="border-t border-steel-800 px-5 py-2.5">
              <p className="font-mono text-[10px] text-muted-foreground/50">
                Top 20 de {withValueCount} productos con valor {">"} 0.
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* ── Low stock ─────────────────────────────────────────────────── */}
      {lowStockRows.length > 0 ? (
        <section className="panel rounded-sm">
          <header className="top-highlight flex items-center justify-between border-b-2 border-steel-700 bg-steel-900/70 px-5 py-3.5">
            <h2 className="font-display text-[16px] tracking-[0.04em]">
              REPONER
              <span className="ml-2 font-mono text-[12px] normal-case tracking-normal text-muted-foreground/70">
                bajo stock mínimo configurado
              </span>
            </h2>
            <div className="flex items-center gap-3">
              <Link
                href="/dashboard/inventario/reposicion"
                className="font-mono text-[10px] uppercase tracking-[0.14em] text-safety-500 transition-colors hover:text-safety-400"
              >
                Ver reposición →
              </Link>
              <Link
                href="/dashboard/inventario/stock"
                className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60 transition-colors hover:text-foreground"
              >
                Existencias
              </Link>
            </div>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-left">
              <thead className="border-b border-steel-800 bg-steel-950/40">
                <tr>
                  <Th>Producto</Th>
                  <Th>Bodega</Th>
                  <Th className="text-right">Stock actual</Th>
                  <Th className="text-right">CPP</Th>
                  <Th className="text-right">Valor restante</Th>
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
                      <Td>
                        <div className="font-semibold text-foreground">{r.product_name}</div>
                        <div className="font-mono text-[10px] text-muted-foreground/60">{r.sku}</div>
                      </Td>
                      <Td className="text-[12.5px] text-muted-foreground">{r.warehouse_name}</Td>
                      <Td className="text-right font-mono text-[14px] font-bold tabular-nums text-red-400">
                        {numFmt.format(r.qty)}
                      </Td>
                      <Td className="text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                        {moneyFmt.format(r.cpp)}
                      </Td>
                      <Td className="text-right font-mono text-[13px] tabular-nums text-foreground">
                        {moneyFmt.format(r.value)}
                      </Td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* Empty state */}
      {rows.length === 0 ? (
        <div className="panel rounded-sm px-6 py-16 text-center">
          <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-muted-foreground">
            Sin balances de inventario. Recibe mercancía para ver el valor aquí.
          </p>
        </div>
      ) : null}

    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

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

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={"px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground " + (className ?? "")}>
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={"px-5 py-3.5 align-top " + (className ?? "")}>{children}</td>;
}
