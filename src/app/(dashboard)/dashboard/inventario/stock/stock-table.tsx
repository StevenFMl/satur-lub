"use client";
import { downloadCsvFile } from "@/lib/export/format";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { KardexSheet, type KardexMovement } from "./kardex-sheet";
import { todayEC } from "@/lib/date-ec";
import { InitialBalanceDialog } from "./initial-balance-dialog";
import { AdjustmentDialog } from "./adjustment-dialog";
import { Button } from "@/components/ui/button";
import { PlusCircle } from "lucide-react";

export type StockRow = {
  id: string;
  product_id: string;
  warehouse_id: string;
  warehouse_name: string;
  product_name: string;
  sku: string;
  unit: string;
  quantity_on_hand: number;
  average_cost: number | null;
  last_purchase_cost: number | null;
  sale_price: number | null;    // precio público c/IVA (default_price)
  tax_rate: number;
  has_tax: boolean;
  reorder_point: number;        // 0 = sin mínimo configurado
};

type StockStatus = "all" | "reorder" | "zero";

const numberFmt = new Intl.NumberFormat("es-EC", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function downloadCsv(filename: string, headers: string[], rows: string[][]): void {
  downloadCsvFile(filename, headers, rows);
}

export function StockTable({ 
  initialRows, 
  products = [], 
  warehouses = [] 
}: { 
  initialRows: StockRow[];
  products?: { id: string; name: string; sku: string; cost_price: number | null }[];
  warehouses?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<StockStatus>("all");

  // Micro-Kárdex state — controlado por ?productId & ?warehouseId en la URL
  const activeProductId = searchParams.get("productId");
  const activeWarehouseId = searchParams.get("warehouseId");
  const isSheetOpen = Boolean(activeProductId && activeWarehouseId);

  const [movements, setMovements] = React.useState<KardexMovement[]>([]);
  const [loadingKardex, setLoadingKardex] = React.useState(false);
  const [initialBalanceOpen, setInitialBalanceOpen] = React.useState(false);

  // Per-row adjustment dialog
  const [adjustmentRow, setAdjustmentRow] = React.useState<StockRow | null>(null);
  const [adjustmentOpen, setAdjustmentOpen] = React.useState(false);

  // Local optimistic stock update after adjustment
  const [localStock, setLocalStock] = React.useState<Record<string, number>>({});

  // La fila activa para mostrar nombre en el Sheet
  const activeRow = React.useMemo(
    () =>
      isSheetOpen
        ? initialRows.find(
            (r) =>
              r.product_id === activeProductId &&
              r.warehouse_id === activeWarehouseId
          )
        : undefined,
    [initialRows, activeProductId, activeWarehouseId, isSheetOpen]
  );

  // Fetch movements cuando se abre el Sheet
  React.useEffect(() => {
    if (!isSheetOpen || !activeProductId || !activeWarehouseId) {
      setMovements([]);
      return;
    }

    let cancelled = false;
    setLoadingKardex(true);

    fetch(
      `/api/kardex?product_id=${activeProductId}&warehouse_id=${activeWarehouseId}`
    )
      .then((res) => res.json())
      .then((data: { movements?: KardexMovement[] }) => {
        if (!cancelled) {
          setMovements(data.movements ?? []);
          setLoadingKardex(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMovements([]);
          setLoadingKardex(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isSheetOpen, activeProductId, activeWarehouseId]);

  const openAdjustment = (row: StockRow) => {
    setAdjustmentRow(row);
    setAdjustmentOpen(true);
  };

  const openKardex = (row: StockRow) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("productId", row.product_id);
    params.set("warehouseId", row.warehouse_id);
    router.push(`/dashboard/inventario/stock?${params.toString()}`, {
      scroll: false,
    });
  };

  const closeKardex = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("productId");
    params.delete("warehouseId");
    const qs = params.toString();
    router.push(
      `/dashboard/inventario/stock${qs ? `?${qs}` : ""}`,
      { scroll: false }
    );
  };

  const filtered = React.useMemo(() => {
    let result = initialRows;
    const q = query.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (r) =>
          r.product_name.toLowerCase().includes(q) ||
          r.sku.toLowerCase().includes(q) ||
          r.warehouse_name.toLowerCase().includes(q)
      );
    }
    if (statusFilter !== "all") {
      result = result.filter((r) => {
        const qty = localStock[`${r.product_id}:${r.warehouse_id}`] ?? r.quantity_on_hand;
        if (statusFilter === "zero")   return qty <= 0;
        if (statusFilter === "reorder") return r.reorder_point > 0 && qty > 0 && qty <= r.reorder_point;
        return true;
      });
    }
    return result;
  }, [initialRows, query, statusFilter, localStock]);

  // reorderCount: configured minimum breached (qty > 0 but <= reorder_point)
  // zeroCount:    completely out of stock
  const reorderCount = React.useMemo(
    () =>
      initialRows.filter(
        (r) => r.reorder_point > 0 && r.quantity_on_hand > 0 && r.quantity_on_hand <= r.reorder_point
      ).length,
    [initialRows]
  );
  const zeroCount = React.useMemo(
    () => initialRows.filter((r) => r.quantity_on_hand <= 0).length,
    [initialRows]
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-md flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por producto, SKU o bodega"
            className="pl-10"
            aria-label="Buscar existencia"
          />
        </div>
        <div className="flex items-center gap-3">
          {zeroCount > 0 ? (
            <div className="flex items-center gap-2">
              <WarningIcon className="h-4 w-4 text-red-400" />
              <span className="font-mono text-[12px] font-bold uppercase tracking-[0.12em] text-red-300">
                {zeroCount} sin stock
              </span>
            </div>
          ) : null}
          {reorderCount > 0 ? (
            <div className="flex items-center gap-2">
              <WarningIcon className="h-4 w-4 text-safety-500/80" />
              <span className="font-mono text-[12px] font-bold uppercase tracking-[0.12em] text-safety-500/80">
                {reorderCount} reponer
              </span>
            </div>
          ) : null}
          {filtered.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                const today = todayEC();
                downloadCsv(
                  `existencias_${today}.csv`,
                  ["Producto", "SKU", "Unidad", "Bodega", "Stock_Actual", "Stock_Minimo", "Estado", "Costo_Promedio", "Valor_Stock", "Precio_Venta_cIVA"],
                  filtered.map((r) => {
                    const qty  = localStock[`${r.product_id}:${r.warehouse_id}`] ?? r.quantity_on_hand;
                    const cpp  = r.average_cost ?? 0;
                    const valorStock = Math.round(qty * cpp * 10000) / 10000;
                    const estado = qty <= 0
                      ? "Sin stock"
                      : r.reorder_point > 0 && qty <= r.reorder_point
                        ? "Reponer"
                        : "Normal";
                    return [
                      r.product_name,
                      r.sku,
                      r.unit,
                      r.warehouse_name,
                      String(qty),
                      String(r.reorder_point),
                      estado,
                      r.average_cost != null ? String(r.average_cost) : "",
                      r.average_cost != null ? String(valorStock) : "",
                      r.sale_price != null ? String(r.sale_price) : "",
                    ];
                  })
                );
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-steel-700 bg-steel-800 px-3 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-steel-600 hover:text-foreground"
            >
              <DownloadIcon className="h-3.5 w-3.5" />
              CSV
            </button>
          ) : null}
          <Button size="md" onClick={() => setInitialBalanceOpen(true)}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Ajuste / Saldo Inicial
          </Button>
        </div>
      </div>

      {/* ── Status filter pills ─────────────────────────────────── */}
      {(reorderCount > 0 || zeroCount > 0) ? (
        <div className="flex flex-wrap gap-1.5">
          {(["all", "reorder", "zero"] as const).map((f) => {
            const active = statusFilter === f;
            const label = f === "all"
              ? `Todos (${initialRows.length})`
              : f === "reorder"
                ? `Reponer (${reorderCount})`
                : `Sin stock (${zeroCount})`;
            return (
              <button
                key={f}
                type="button"
                onClick={() => setStatusFilter(f)}
                className={[
                  "rounded-sm border px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.1em] transition-colors",
                  active
                    ? f === "zero"
                      ? "border-red-600/70 bg-red-700/15 text-red-300"
                      : f === "reorder"
                        ? "border-safety-500/60 bg-safety-500/10 text-safety-500"
                        : "border-safety-500 bg-safety-500/10 text-safety-500"
                    : "border-steel-700 bg-steel-900/40 text-muted-foreground hover:border-steel-600 hover:text-foreground",
                ].join(" ")}
              >
                {label}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="panel overflow-hidden rounded-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-b-2 border-steel-700 bg-steel-900/70">
              <tr>
                <Th>Producto / SKU</Th>
                <Th className="text-right">Stock</Th>
                <Th>Bodega</Th>
                <Th className="text-right">Costos (Últ. / CPP)</Th>
                <Th className="text-right">P.V. c/IVA</Th>
                <Th>Estado</Th>
                <Th className="text-right">Auditoría</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-5 py-12 text-center text-[13px] text-muted-foreground"
                  >
                    {initialRows.length === 0
                      ? "No hay existencias registradas. Los balances se generan automáticamente al recibir compras."
                      : "Sin resultados para tu búsqueda."}
                  </td>
                </tr>
              ) : (
                filtered.map((r) => {
                  const displayQty  = localStock[`${r.product_id}:${r.warehouse_id}`] ?? r.quantity_on_hand;
                  const isZero      = displayQty <= 0;
                  const isReorder   = !isZero && r.reorder_point > 0 && displayQty <= r.reorder_point;
                  const priceWithTax = r.sale_price;
                  const priceWithoutTax = r.sale_price != null && r.has_tax && r.tax_rate > 0
                    ? r.sale_price / (1 + r.tax_rate / 100)
                    : r.sale_price;
                  return (
                    <tr
                      key={r.id}
                      className="border-b border-steel-800 transition-colors hover:bg-steel-900/50"
                    >
                      <Td>
                        <span className="font-semibold text-foreground">
                          {r.product_name}
                        </span>
                        <div className="mt-0.5 font-mono text-[11px] text-muted-foreground/70">
                          {r.sku} · <span className="capitalize">{r.unit}</span>
                        </div>
                      </Td>
                      <Td className="text-right">
                        <span
                          className={
                            "font-mono text-[15px] font-bold tabular-nums " +
                            (isZero ? "text-red-400" : isReorder ? "text-safety-500" : "text-foreground")
                          }
                        >
                          {numberFmt.format(displayQty)}
                        </span>
                        {r.reorder_point > 0 ? (
                          <div className="mt-0.5 font-mono text-[9.5px] tabular-nums text-muted-foreground/50">
                            mín. {numberFmt.format(r.reorder_point)}
                          </div>
                        ) : null}
                      </Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <WarehouseIcon className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-[13px] text-foreground">
                            {r.warehouse_name}
                          </span>
                        </div>
                      </Td>
                      <Td className="text-right">
                        {(() => {
                          const rate = r.has_tax && r.tax_rate > 0 ? r.tax_rate : 0;
                          const withIva = (net: number) => rate > 0 ? net * (1 + rate / 100) : null;
                          const cpp  = r.average_cost ?? 0;
                          const last = r.last_purchase_cost;
                          return (
                            <div className="flex flex-col items-end gap-1.5">
                              {last != null ? (
                                <div className="text-right">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground/60">Últ. compra</span>
                                    <span className="font-mono text-[13px] font-bold tabular-nums text-foreground">
                                      {moneyFmt.format(last)}
                                    </span>
                                  </div>
                                  {withIva(last) != null ? (
                                    <div className="mt-0.5 font-mono text-[10px] tabular-nums text-muted-foreground/50">
                                      c/IVA {moneyFmt.format(withIva(last)!)}
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                              <div className="text-right">
                                <div className="flex items-center gap-2">
                                  <span className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground/60">CPP</span>
                                  <span className={`font-mono tabular-nums ${last != null ? "text-[11px] text-muted-foreground/70" : "text-[13px] font-bold text-foreground"}`}>
                                    {moneyFmt.format(cpp)}
                                  </span>
                                </div>
                                {withIva(cpp) != null ? (
                                  <div className="mt-0.5 font-mono text-[10px] tabular-nums text-muted-foreground/50">
                                    c/IVA {moneyFmt.format(withIva(cpp)!)}
                                  </div>
                                ) : null}
                              </div>
                              {last == null ? (
                                <span className="font-mono text-[9px] text-muted-foreground/40">Sin compra reg.</span>
                              ) : null}
                            </div>
                          );
                        })()}
                      </Td>
                      <Td className="text-right">
                        {priceWithTax != null ? (
                          <>
                            <span className="font-mono text-[14px] font-bold tabular-nums text-safety-500">
                              {moneyFmt.format(priceWithTax)}
                            </span>
                            {r.sale_price != null && r.has_tax && r.tax_rate > 0 && priceWithoutTax != null ? (
                              <div className="mt-0.5 font-mono text-[10px] tabular-nums text-muted-foreground/60">
                                s/IVA {moneyFmt.format(priceWithoutTax)}
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <span className="font-mono text-[11px] text-muted-foreground/40">Sin precio</span>
                        )}
                      </Td>
                      <Td>
                        {isZero ? (
                          <Badge tone="danger">
                            <WarningIcon className="h-3 w-3" />
                            Sin stock
                          </Badge>
                        ) : isReorder ? (
                          <Badge tone="warning">
                            <WarningIcon className="h-3 w-3" />
                            Reponer
                          </Badge>
                        ) : (
                          <Badge tone="active">Normal</Badge>
                        )}
                      </Td>
                      <Td className="text-right">
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openAdjustment(r)}
                            className="inline-flex items-center gap-1.5 rounded-sm border border-safety-500/40 bg-safety-500/5 px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-safety-500 transition-colors hover:border-safety-500/70 hover:bg-safety-500/10"
                          >
                            <AdjustIcon className="h-3.5 w-3.5" />
                            Ajustar
                          </button>
                          <div className="flex items-stretch">
                            <button
                              type="button"
                              onClick={() => openKardex(r)}
                              className="inline-flex items-center gap-1.5 rounded-l-sm border border-r-0 border-steel-700 bg-steel-800 px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-steel-600 hover:text-foreground"
                            >
                              <KardexIcon className="h-3.5 w-3.5" />
                              Historial
                            </button>
                            <Link
                              href={`/dashboard/inventario/movimientos?product_id=${r.product_id}&warehouse_id=${r.warehouse_id}`}
                              className="inline-flex items-center rounded-r-sm border border-steel-700 bg-steel-800 px-2 py-1.5 font-mono text-[10px] text-muted-foreground/60 transition-colors hover:border-steel-600 hover:text-safety-500"
                              title="Ver todos los movimientos de este producto"
                            >
                              ↗
                            </Link>
                          </div>
                        </div>
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {initialRows.length > 0 ? (
        <p className="text-right font-mono text-[11px] text-muted-foreground">
          {filtered.length} de {initialRows.length} registro
          {initialRows.length !== 1 ? "s" : ""}
        </p>
      ) : null}

      {/* Micro-Kárdex Sheet */}
      <KardexSheet
        open={isSheetOpen}
        onClose={closeKardex}
        productName={activeRow?.product_name ?? "—"}
        warehouseName={activeRow?.warehouse_name ?? "—"}
        movements={movements}
        loading={loadingKardex}
      />
      {/* Modal de Ajuste / Saldo Inicial */}
      <InitialBalanceDialog
        open={initialBalanceOpen}
        onClose={() => setInitialBalanceOpen(false)}
        products={products}
        warehouses={warehouses}
      />

      {/* Ajuste de inventario por fila */}
      <AdjustmentDialog
        open={adjustmentOpen}
        onClose={() => setAdjustmentOpen(false)}
        row={adjustmentRow}
        onSuccess={(_before, qtyAfter, _delta) => {
          if (adjustmentRow) {
            setLocalStock((prev) => ({
              ...prev,
              [`${adjustmentRow.product_id}:${adjustmentRow.warehouse_id}`]: qtyAfter,
            }));
          }
          setAdjustmentOpen(false);
        }}
      />
    </div>
  );
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={
        "px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground " +
        (className ?? "")
      }
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={"px-5 py-4 align-top " + (className ?? "")}>{children}</td>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function WarningIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function KardexIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M14 3v6h6" />
      <path d="M8 13h8" />
      <path d="M8 17h5" />
    </svg>
  );
}

function AdjustIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="12" y1="20" x2="12" y2="10" />
      <line x1="18" y1="20" x2="18" y2="4" />
      <line x1="6"  y1="20" x2="6"  y2="16" />
    </svg>
  );
}

function WarehouseIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 9 12 4l9 5" />
      <path d="M5 9v11h4v-7h6v7h4V9" />
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
