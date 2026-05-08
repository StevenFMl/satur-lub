"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { KardexSheet, type KardexMovement } from "./kardex-sheet";
import { InitialBalanceDialog } from "./initial-balance-dialog";
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
};

const LOW_STOCK_THRESHOLD = 5;

const numberFmt = new Intl.NumberFormat("es-EC", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

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

  // Micro-Kárdex state — controlado por ?productId & ?warehouseId en la URL
  const activeProductId = searchParams.get("productId");
  const activeWarehouseId = searchParams.get("warehouseId");
  const isSheetOpen = Boolean(activeProductId && activeWarehouseId);

  const [movements, setMovements] = React.useState<KardexMovement[]>([]);
  const [loadingKardex, setLoadingKardex] = React.useState(false);
  const [initialBalanceOpen, setInitialBalanceOpen] = React.useState(false);

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
    const q = query.trim().toLowerCase();
    if (!q) return initialRows;
    return initialRows.filter(
      (r) =>
        r.product_name.toLowerCase().includes(q) ||
        r.sku.toLowerCase().includes(q) ||
        r.warehouse_name.toLowerCase().includes(q)
    );
  }, [initialRows, query]);

  const lowCount = React.useMemo(
    () =>
      initialRows.filter((r) => r.quantity_on_hand <= LOW_STOCK_THRESHOLD)
        .length,
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
          {lowCount > 0 ? (
            <div className="flex items-center gap-2">
              <WarningIcon className="h-4 w-4 text-red-400" />
              <span className="font-mono text-[12px] font-bold uppercase tracking-[0.12em] text-red-300">
                {lowCount} producto{lowCount !== 1 ? "s" : ""} con stock bajo
              </span>
            </div>
          ) : null}
          <Button size="md" onClick={() => setInitialBalanceOpen(true)}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Ajuste / Saldo Inicial
          </Button>
        </div>
      </div>

      <div className="panel overflow-hidden rounded-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-b-2 border-steel-700 bg-steel-900/70">
              <tr>
                <Th>Producto</Th>
                <Th>SKU</Th>
                <Th className="text-right">Cantidad</Th>
                <Th>Unidad</Th>
                <Th>Bodega</Th>
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
                  const isLow = r.quantity_on_hand <= LOW_STOCK_THRESHOLD;
                  return (
                    <tr
                      key={r.id}
                      className="border-b border-steel-800 transition-colors hover:bg-steel-900/50"
                    >
                      <Td>
                        <span className="font-semibold text-foreground">
                          {r.product_name}
                        </span>
                      </Td>
                      <Td>
                        <span className="font-mono text-[12.5px] tabular-nums text-muted-foreground">
                          {r.sku}
                        </span>
                      </Td>
                      <Td className="text-right">
                        <span
                          className={
                            "font-mono text-[14px] font-bold tabular-nums " +
                            (isLow ? "text-red-300" : "text-foreground")
                          }
                        >
                          {numberFmt.format(r.quantity_on_hand)}
                        </span>
                      </Td>
                      <Td>
                        <span className="font-mono text-[12px] capitalize tracking-[0.06em] text-muted-foreground">
                          {r.unit}
                        </span>
                      </Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <WarehouseIcon className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-[13px] text-foreground">
                            {r.warehouse_name}
                          </span>
                        </div>
                      </Td>
                      <Td>
                        {isLow ? (
                          <Badge tone="danger">
                            <WarningIcon className="h-3 w-3" />
                            Stock Bajo
                          </Badge>
                        ) : (
                          <Badge tone="active">Normal</Badge>
                        )}
                      </Td>
                      <Td className="text-right">
                        <button
                          type="button"
                          onClick={() => openKardex(r)}
                          className="inline-flex items-center gap-1.5 rounded-sm border border-steel-700 bg-steel-800 px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-safety-500/60 hover:text-safety-500"
                        >
                          <KardexIcon className="h-3.5 w-3.5" />
                          Historial
                        </button>
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
