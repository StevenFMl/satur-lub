import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";

export const metadata: Metadata = { title: "Reposición · Inventario" };
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

// ── Formatters ────────────────────────────────────────────────────────────────

const numFmt = new Intl.NumberFormat("es-EC", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ReposicionPage() {
  const { user, membership } = await getActiveMembership();
  if (!user)       redirect("/login");
  if (!membership) redirect("/onboarding");

  const supabase = await createClient();

  // ── 1. All inventory balances with product + warehouse ─────────────────────
  type RawBalance = {
    product_id:       string;
    warehouse_id:     string;
    quantity_on_hand: number | string;
    products: {
      id: string; name: string; sku: string; unit: string;
      reorder_point: number | null;
      last_purchase_cost: number | null;
    } | null;
    warehouses: { id: string; name: string } | null;
  };

  const { data: rawBalances } = await supabase
    .from("inventory_balances")
    .select(`
      product_id, warehouse_id, quantity_on_hand,
      products ( id, name, sku, unit, reorder_point, last_purchase_cost ),
      warehouses ( id, name )
    `)
    .order("quantity_on_hand", { ascending: true });

  // ── 2. Supplier history — best (lowest) cost per product ───────────────────
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

  // Build map: product_id → best (lowest cost) supplier entry
  // If multiple suppliers exist, the one with the cheapest last cost is preferred.
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

  // ── 3. Filter to products that need reordering ────────────────────────────
  const needRows: NeedRow[] = [];

  for (const b of (rawBalances ?? []) as unknown as RawBalance[]) {
    const p    = b.products;
    if (!p) continue;

    const qty          = Number(b.quantity_on_hand ?? 0);
    const rp           = Number(p.reorder_point ?? 0);
    const isZero       = qty <= 0;
    const belowMin     = rp > 0 && qty <= rp;

    // Only include if below minimum OR completely out of stock
    if (!belowMin && !isZero) continue;

    const hist         = bestSupplier.get(b.product_id);
    const suggestedQty = rp > 0
      ? Math.max(0, rp - qty)  // fill back up to reorder_point
      : 0;                     // no minimum → can't suggest quantity

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

  // ── 4. Group by supplier ──────────────────────────────────────────────────
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

  // Sort: suppliers with known name first, then "Sin proveedor" last
  const groups: SupplierGroup[] = Array.from(groupMap.values()).sort((a, b) => {
    if (a.supplier_id === null && b.supplier_id !== null) return 1;
    if (a.supplier_id !== null && b.supplier_id === null) return -1;
    return a.supplier_name.localeCompare(b.supplier_name, "es");
  });

  const zeroCount    = needRows.filter((r) => r.is_zero).length;
  const reorderCount = needRows.filter((r) => !r.is_zero).length;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto w-full max-w-7xl space-y-8">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="space-y-2">
        <span className="hud-readout">Inventario · Compras sugeridas</span>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-[36px] leading-none tracking-[0.02em] text-foreground sm:text-[42px]">
              REPOSICIÓN
            </h1>
            <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
              Productos bajo stock mínimo o sin stock, agrupados por proveedor sugerido.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2.5">
            {zeroCount > 0 ? (
              <span className="rounded-sm border border-red-600/50 bg-red-700/10 px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-red-300">
                {zeroCount} sin stock
              </span>
            ) : null}
            {reorderCount > 0 ? (
              <span className="rounded-sm border border-safety-500/50 bg-safety-500/10 px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-safety-500">
                {reorderCount} reponer
              </span>
            ) : null}
            <Link
              href="/dashboard/inventario/stock"
              className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
            >
              ← Existencias
            </Link>
          </div>
        </div>
      </header>

      {/* ── Empty state ──────────────────────────────────────────────── */}
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
              numFmt={numFmt}
              moneyFmt={moneyFmt}
            />
          ))}
        </div>
      )}

      {/* ── Phase-2 callout ──────────────────────────────────────────── */}
      {groups.length > 0 ? (
        <aside className="rounded-sm border border-steel-700/50 bg-steel-900/30 px-5 py-3.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60">
            Fase 2 pendiente
          </p>
          <p className="mt-0.5 text-[12px] text-muted-foreground/70">
            El botón &quot;Nueva compra&quot; abrirá la OC pre-llenada con el proveedor y los ítems sugeridos.
            Por ahora redirige al formulario vacío.
          </p>
        </aside>
      ) : null}

    </div>
  );
}

// ── SupplierGroupCard ─────────────────────────────────────────────────────────

function SupplierGroupCard({
  group,
  numFmt,
  moneyFmt,
}: {
  group:    SupplierGroup;
  numFmt:   Intl.NumberFormat;
  moneyFmt: Intl.NumberFormat;
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
                · estimado {moneyFmt.format(totalSuggestedValue)}
              </span>
            ) : null}
          </div>
        </div>

        {/* CTA — fase 2: pre-fill supplier + products */}
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
              <Th>Producto</Th>
              <Th>Bodega</Th>
              <Th className="text-right">Stock actual</Th>
              <Th className="text-right">Mínimo</Th>
              <Th className="text-right">Pedir</Th>
              <Th className="text-right">Últ. costo</Th>
              <Th className="text-right">Est. compra</Th>
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
                  <Td>
                    <div className="font-semibold text-foreground">{r.product_name}</div>
                    <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/60">
                      {r.sku} · {r.unit}
                    </div>
                  </Td>
                  <Td className="text-[12.5px] text-muted-foreground">{r.warehouse_name}</Td>
                  <Td className="text-right">
                    <span className={[
                      "font-mono text-[14px] font-bold tabular-nums",
                      r.is_zero ? "text-red-400" : "text-safety-500",
                    ].join(" ")}>
                      {numFmt.format(r.qty)}
                    </span>
                  </Td>
                  <Td className="text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                    {r.reorder_point > 0 ? numFmt.format(r.reorder_point) : "—"}
                  </Td>
                  <Td className="text-right">
                    {r.suggested_qty > 0 ? (
                      <span className="font-mono text-[14px] font-bold tabular-nums text-foreground">
                        {numFmt.format(r.suggested_qty)}
                      </span>
                    ) : (
                      <span className="font-mono text-[11px] text-muted-foreground/40">
                        {r.reorder_point === 0 ? "Sin mín." : "0"}
                      </span>
                    )}
                  </Td>
                  <Td className="text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                    {r.last_cost != null ? moneyFmt.format(r.last_cost) : <span className="text-muted-foreground/35">—</span>}
                  </Td>
                  <Td className="text-right font-mono text-[13px] tabular-nums text-foreground">
                    {estCompra != null ? moneyFmt.format(estCompra) : <span className="text-muted-foreground/35">—</span>}
                  </Td>
                </tr>
              );
            })}
          </tbody>
          {/* Group totals */}
          {totalSuggestedValue > 0 ? (
            <tfoot>
              <tr className="border-t-2 border-steel-700 bg-steel-950/60">
                <td colSpan={6} className="px-5 py-2.5 text-right font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">
                  Total estimado compra
                </td>
                <td className="px-5 py-2.5 text-right font-mono text-[14px] font-bold tabular-nums text-safety-500">
                  {moneyFmt.format(totalSuggestedValue)}
                </td>
              </tr>
            </tfoot>
          ) : null}
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
                  value={estCompra != null ? moneyFmt.format(estCompra) : "—"}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

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

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={"px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground " + (className ?? "")}>
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={"px-5 py-3.5 align-middle " + (className ?? "")}>{children}</td>;
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
