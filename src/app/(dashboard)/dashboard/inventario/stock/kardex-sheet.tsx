"use client";

import * as React from "react";
import { Sheet } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";

type MovementType =
  | "in"
  | "out"
  | "adjustment"
  | "sale"
  | "purchase"
  | "transfer";

export type KardexMovement = {
  id: string;
  created_at: string;
  movement_type: MovementType;
  quantity: number | string;
  unit_cost: number | string | null;
  reason: string;
  reference_type: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  productName: string;
  warehouseName: string;
  movements: KardexMovement[];
  loading?: boolean;
};

const TYPE_META: Record<
  MovementType,
  {
    label: string;
    tone: "active" | "danger" | "warning" | "info" | "rust";
    sign: "+" | "−" | "±";
  }
> = {
  in: { label: "Entrada", tone: "active", sign: "+" },
  purchase: { label: "Compra", tone: "active", sign: "+" },
  out: { label: "Salida", tone: "danger", sign: "−" },
  sale: { label: "Venta", tone: "rust", sign: "−" },
  transfer: { label: "Traspaso", tone: "info", sign: "±" },
  adjustment: { label: "Ajuste", tone: "warning", sign: "±" },
};

const dateFmt = new Intl.DateTimeFormat("es-EC", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const qtyFmt = new Intl.NumberFormat("es-EC", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function KardexSheet({
  open,
  onClose,
  productName,
  warehouseName,
  movements,
  loading,
}: Props) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Kárdex · ${productName}`}
      description={`Historial de movimientos en ${warehouseName}`}
    >
      <div className="flex h-full flex-col">
        {loading ? (
          <div className="flex flex-1 items-center justify-center py-16">
            <span
              aria-hidden
              className="inline-block h-6 w-6 animate-spin rounded-full border-[2.5px] border-safety-500 border-t-transparent"
            />
            <span className="ml-3 font-mono text-[12px] uppercase tracking-[0.14em] text-muted-foreground">
              Cargando movimientos…
            </span>
          </div>
        ) : movements.length === 0 ? (
          <div className="flex-1 px-6 py-16 text-center text-[13px] text-muted-foreground">
            Sin movimientos registrados para este producto en esta bodega.
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-left">
              <thead className="sticky top-0 z-10 border-b-2 border-steel-700 bg-steel-900">
                <tr>
                  <th className="px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                    Fecha
                  </th>
                  <th className="px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                    Tipo
                  </th>
                  <th className="px-4 py-2.5 text-right font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                    Cant.
                  </th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => {
                  const meta =
                    TYPE_META[m.movement_type] ?? TYPE_META.adjustment;
                  const qty = Number(m.quantity ?? 0);
                  return (
                    <tr
                      key={m.id}
                      className="border-b border-steel-800 transition-colors hover:bg-steel-900/50"
                    >
                      <td className="px-4 py-3">
                        <div className="font-mono text-[11.5px] tabular-nums text-foreground">
                          {dateFmt.format(new Date(m.created_at))}
                        </div>
                        {m.reason ? (
                          <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                            {m.reason}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className={
                            "font-mono text-[14px] font-bold tabular-nums " +
                            (meta.sign === "+"
                              ? "text-emerald-300"
                              : meta.sign === "−"
                                ? "text-red-300"
                                : "text-foreground")
                          }
                        >
                          {meta.sign}
                          {qtyFmt.format(qty)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <p className="px-4 py-3 text-right font-mono text-[10px] text-muted-foreground">
              {movements.length} movimiento
              {movements.length !== 1 ? "s" : ""}
            </p>
          </div>
        )}
      </div>
    </Sheet>
  );
}
