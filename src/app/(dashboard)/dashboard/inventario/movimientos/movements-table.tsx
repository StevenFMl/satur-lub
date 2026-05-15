"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { todayEC } from "@/lib/date-ec";

// ── Types ───────────────────────────────────────────────────────────────────

export type MovementRow = {
  id: string;
  created_at: string;
  movement_type: string;
  quantity: number;
  direction: number | null;
  unit_cost: number | null;
  reason: string;
  reference_type: string | null;
  reference_id: string | null;
  performed_by_user_id: string | null;
  product: { id: string; name: string; sku: string; unit: string } | null;
  warehouse: { id: string; name: string } | null;
};

type LookupItem = { id: string; name: string };

type Props = {
  rows: MovementRow[];
  products: LookupItem[];
  warehouses: LookupItem[];
  totalFiltered: number;
  hasFilter: boolean;
};

// ── Movement type metadata ──────────────────────────────────────────────────

type ToneName = "active" | "danger" | "warning" | "info" | "rust" | "neutral";

const TYPE_META: Record<string, { label: string; tone: ToneName }> = {
  in:              { label: "Entrada",          tone: "active"  },
  purchase:        { label: "Compra",           tone: "active"  },
  out:             { label: "Salida",           tone: "danger"  },
  sale:            { label: "Venta",            tone: "rust"    },
  sale_reversal:   { label: "Anulación venta",  tone: "info"    },
  purchase_cancel: { label: "Anulación compra", tone: "danger"  },
  return:          { label: "Devolución",       tone: "active"  },
  adjustment:      { label: "Ajuste",           tone: "warning" },
  transfer:        { label: "Traspaso",         tone: "info"    },
};

const ALL_TYPES = Object.keys(TYPE_META);

// Sign from direction column (if present) or inferred from type
function getSign(row: MovementRow): "+" | "−" | "±" {
  if (row.direction === 1)  return "+";
  if (row.direction === -1) return "−";
  // Inference fallback for records without direction
  if (["in", "purchase", "sale_reversal", "return"].includes(row.movement_type)) return "+";
  if (["out", "sale", "purchase_cancel"].includes(row.movement_type)) return "−";
  return "±"; // adjustment, transfer
}

const SIGN_CLASS: Record<"+" | "−" | "±", string> = {
  "+": "text-emerald-300",
  "−": "text-red-300",
  "±": "text-foreground",
};

// ── CSV export ───────────────────────────────────────────────────────────────

function downloadCsv(filename: string, headers: string[], rows: string[][]): void {
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const content = [headers, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Formatters ──────────────────────────────────────────────────────────────

const dateFmt = new Intl.DateTimeFormat("es-EC", {
  day: "2-digit", month: "short", year: "numeric",
  hour: "2-digit", minute: "2-digit",
});

const dateOnlyFmt = new Intl.DateTimeFormat("es-EC", {
  day: "2-digit", month: "short", year: "numeric",
});

const qtyFmt = new Intl.NumberFormat("es-EC", {
  minimumFractionDigits: 0, maximumFractionDigits: 4,
});

const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency", currency: "USD",
  minimumFractionDigits: 2, maximumFractionDigits: 4,
});

// ── Component ───────────────────────────────────────────────────────────────

export function MovementsTable({ rows, products, warehouses, hasFilter }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Mirror current URL params into local state (for filter form)
  const [productId,   setProductId]   = React.useState(searchParams.get("product_id")   ?? "");
  const [warehouseId, setWarehouseId] = React.useState(searchParams.get("warehouse_id") ?? "");
  const [types, setTypes] = React.useState<string[]>(
    searchParams.get("type")?.split(",").filter(Boolean) ?? []
  );
  const [dateFrom, setDateFrom] = React.useState(searchParams.get("date_from") ?? "");
  const [dateTo,   setDateTo]   = React.useState(searchParams.get("date_to")   ?? "");

  // Client-side text search (within already-fetched results)
  const [query, setQuery] = React.useState("");

  const toggleType = (t: string) => {
    setTypes((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);
  };

  const applyFilters = () => {
    const p = new URLSearchParams();
    if (productId)      p.set("product_id",   productId);
    if (warehouseId)    p.set("warehouse_id",  warehouseId);
    if (types.length)   p.set("type",          types.join(","));
    if (dateFrom)       p.set("date_from",     dateFrom);
    if (dateTo)         p.set("date_to",       dateTo);
    router.push(`/dashboard/inventario/movimientos?${p.toString()}`, { scroll: false });
  };

  const clearFilters = () => {
    setProductId(""); setWarehouseId(""); setTypes([]);
    setDateFrom("");  setDateTo(""); setQuery("");
    router.push("/dashboard/inventario/movimientos", { scroll: false });
  };

  // Client-side text search over fetched rows
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.product?.name.toLowerCase().includes(q) ||
        r.product?.sku.toLowerCase().includes(q) ||
        r.reason.toLowerCase().includes(q) ||
        r.warehouse?.name.toLowerCase().includes(q)
    );
  }, [rows, query]);

  const hasLocalFilter = query.trim().length > 0;

  return (
    <div className="space-y-5">
      {/* ── Filter panel ─────────────────────────────────────────────────── */}
      <div className="panel rounded-sm">
        <div className="border-b border-steel-800 px-5 py-3">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground/60">
            Filtros de servidor
          </span>
        </div>
        <div className="space-y-4 px-5 py-4">
          {/* Row 1: product + warehouse + dates */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div>
              <label className="mb-1 block font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground/60">
                Producto
              </label>
              <select
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                className="h-9 w-full rounded-sm border border-steel-700 bg-steel-900 px-2.5 font-mono text-[11px] text-foreground focus:border-safety-500 focus:outline-none"
              >
                <option value="">Todos los productos</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground/60">
                Bodega
              </label>
              <select
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                className="h-9 w-full rounded-sm border border-steel-700 bg-steel-900 px-2.5 font-mono text-[11px] text-foreground focus:border-safety-500 focus:outline-none"
              >
                <option value="">Todas las bodegas</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground/60">
                Desde
              </label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-9 w-full rounded-sm border border-steel-700 bg-steel-900 px-2.5 font-mono text-[11px] text-foreground focus:border-safety-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground/60">
                Hasta
              </label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-9 w-full rounded-sm border border-steel-700 bg-steel-900 px-2.5 font-mono text-[11px] text-foreground focus:border-safety-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Row 2: type chips */}
          <div>
            <label className="mb-1.5 block font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground/60">
              Tipo de movimiento
            </label>
            <div className="flex flex-wrap gap-1.5">
              {ALL_TYPES.map((t) => {
                const meta  = TYPE_META[t];
                const active = types.includes(t);
                return (
                  <button
                    key={t} type="button"
                    onClick={() => toggleType(t)}
                    className={[
                      "rounded-sm border px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.1em] transition-all",
                      active
                        ? "border-safety-500 bg-safety-500/10 text-safety-500"
                        : "border-steel-700 bg-steel-900/40 text-muted-foreground hover:border-steel-600 hover:text-foreground",
                    ].join(" ")}
                  >
                    {meta?.label ?? t}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Row 3: actions */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={applyFilters}
              className="inline-flex h-8 items-center gap-2 rounded-sm border border-safety-500 bg-safety-500/10 px-4 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-safety-500 transition-colors hover:bg-safety-500/20"
            >
              Aplicar filtros
            </button>
            {hasFilter ? (
              <button
                type="button"
                onClick={clearFilters}
                className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60 hover:text-muted-foreground"
              >
                Limpiar
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* ── Client-side text search ───────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar en resultados (producto, motivo…)"
            className="pl-10"
          />
        </div>
        <div className="flex items-center gap-3">
          <p className="font-mono text-[11px] text-muted-foreground/60">
            {hasLocalFilter
              ? `${filtered.length} de ${rows.length} movimientos`
              : `${rows.length} movimiento${rows.length !== 1 ? "s" : ""}`}
          </p>
          {filtered.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                const today = todayEC();
                downloadCsv(
                  `kardex_${today}.csv`,
                  ["Fecha", "Hora", "Producto", "SKU", "Bodega", "Tipo", "Signo", "Cantidad", "Unidad", "Costo_Unit", "Motivo", "Referencia", "Usuario"],
                  filtered.map((r) => {
                    const dt   = new Date(r.created_at);
                    const sign = getSign(r);
                    return [
                      dt.toLocaleDateString("es-EC"),
                      dt.toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" }),
                      r.product?.name ?? "",
                      r.product?.sku  ?? "",
                      r.warehouse?.name ?? "",
                      TYPE_META[r.movement_type]?.label ?? r.movement_type,
                      sign,
                      String(r.quantity),
                      r.product?.unit ?? "",
                      r.unit_cost != null ? String(r.unit_cost) : "",
                      r.reason,
                      r.reference_type ?? "",
                      r.performed_by_user_id ? r.performed_by_user_id.slice(0, 8).toUpperCase() : "",
                    ];
                  })
                );
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-steel-700 bg-steel-800 px-3 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-steel-600 hover:text-foreground"
            >
              <DownloadIcon className="h-3.5 w-3.5" />
              CSV
            </button>
          ) : null}
        </div>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <div className="panel overflow-hidden rounded-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left">
            <thead className="border-b-2 border-steel-700 bg-steel-900/70">
              <tr>
                <Th>Fecha</Th>
                <Th>Producto</Th>
                <Th className="hidden md:table-cell">Bodega</Th>
                <Th>Tipo</Th>
                <Th className="text-right">Cantidad</Th>
                <Th className="hidden lg:table-cell text-right">Costo unit.</Th>
                <Th className="hidden lg:table-cell">Motivo</Th>
                <Th className="hidden xl:table-cell">Ref.</Th>
                <Th className="hidden xl:table-cell">Usuario</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-5 py-12 text-center text-[13px] text-muted-foreground">
                    {rows.length === 0
                      ? hasFilter
                        ? "Sin movimientos para los filtros aplicados."
                        : "Aún no hay movimientos registrados."
                      : "Sin resultados para la búsqueda."}
                  </td>
                </tr>
              ) : (
                filtered.map((r) => {
                  const meta = TYPE_META[r.movement_type] ?? { label: r.movement_type, tone: "neutral" as ToneName };
                  const sign = getSign(r);
                  const qty  = r.quantity;
                  const dt   = new Date(r.created_at);
                  return (
                    <tr key={r.id} className="border-b border-steel-800 transition-colors hover:bg-steel-900/50">
                      {/* Fecha */}
                      <Td className="min-w-[130px]">
                        <div className="font-mono text-[11.5px] tabular-nums text-foreground">
                          {dateOnlyFmt.format(dt)}
                        </div>
                        <div className="font-mono text-[10px] tabular-nums text-muted-foreground/60">
                          {dt.toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </Td>

                      {/* Producto */}
                      <Td className="min-w-[140px]">
                        {r.product ? (
                          <>
                            <Link
                              href={`/dashboard/inventario/movimientos?product_id=${r.product.id}`}
                              className="font-semibold text-foreground hover:text-safety-500 transition-colors"
                            >
                              {r.product.name}
                            </Link>
                            <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/60">
                              {r.product.sku}
                              {r.product.unit ? ` · ${r.product.unit}` : ""}
                            </div>
                          </>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </Td>

                      {/* Bodega */}
                      <Td className="hidden md:table-cell min-w-[100px]">
                        {r.warehouse ? (
                          <span className="text-[12.5px] text-foreground">
                            {r.warehouse.name}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </Td>

                      {/* Tipo */}
                      <Td className="min-w-[110px]">
                        <Badge tone={meta.tone as Parameters<typeof Badge>[0]["tone"]}>
                          {meta.label}
                        </Badge>
                      </Td>

                      {/* Cantidad */}
                      <Td className="text-right min-w-[80px]">
                        <span className={`font-mono text-[14px] font-bold tabular-nums ${SIGN_CLASS[sign]}`}>
                          {sign}{qtyFmt.format(qty)}
                        </span>
                        {r.product?.unit ? (
                          <div className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground/50">
                            {r.product.unit}
                          </div>
                        ) : null}
                      </Td>

                      {/* Costo unitario */}
                      <Td className="hidden lg:table-cell text-right min-w-[90px]">
                        {r.unit_cost != null ? (
                          <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
                            {moneyFmt.format(r.unit_cost)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/30">—</span>
                        )}
                      </Td>

                      {/* Motivo */}
                      <Td className="hidden lg:table-cell max-w-[220px]">
                        <p className="text-[11.5px] leading-4 text-muted-foreground line-clamp-2" title={r.reason}>
                          {r.reason}
                        </p>
                      </Td>

                      {/* Referencia */}
                      <Td className="hidden xl:table-cell min-w-[80px]">
                        {r.reference_type ? (
                          <span className="rounded-sm border border-steel-700 bg-steel-800 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground/70">
                            {r.reference_type}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/30">—</span>
                        )}
                      </Td>

                      {/* Usuario */}
                      <Td className="hidden xl:table-cell min-w-[90px]">
                        {r.performed_by_user_id ? (
                          <span className="font-mono text-[10px] text-muted-foreground/60">
                            #{r.performed_by_user_id.slice(0, 8).toUpperCase()}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/30">—</span>
                        )}
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 0 ? (
          <div className="border-t border-steel-800 px-5 py-2.5">
            <p className="font-mono text-[10px] text-muted-foreground/50">
              {filtered.length} movimiento{filtered.length !== 1 ? "s" : ""}
              {hasFilter ? " · con filtros activos" : ""}
              {" · "}
              <span className="text-muted-foreground/40">
                (máx. 500 por consulta — usa rango de fechas para períodos específicos)
              </span>
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

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

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
