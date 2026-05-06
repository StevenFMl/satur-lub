"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import {
  cancelPurchaseAction,
  type CancelState,
} from "@/actions/purchases";

export type PurchaseRow = {
  id: string;
  created_at: string;
  supplier_name: string;
  payment_method: string | null;
  payment_status: string;
  status: string;
  total: number;
};

const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

const dateFmt = new Intl.DateTimeFormat("es-EC", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const PAYMENT_LABELS: Record<string, string> = {
  cash: "Contado",
  transfer: "Transferencia",
  credit: "Crédito",
};

export function PurchasesTable({
  initialRows,
  canManage,
}: {
  initialRows: PurchaseRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [cancelling, setCancelling] = React.useState<string | null>(null);
  const [confirmId, setConfirmId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return initialRows;
    return initialRows.filter(
      (r) =>
        r.supplier_name.toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q)
    );
  }, [initialRows, query]);

  const handleCancel = async (poId: string) => {
    setCancelling(poId);
    setError(null);
    try {
      const result: CancelState = await cancelPurchaseAction(poId);
      if (result?.error) {
        setError(result.error);
      } else {
        router.refresh();
      }
    } catch {
      setError("Error de conexión al anular.");
    } finally {
      setCancelling(null);
      setConfirmId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-md flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por proveedor o estado"
            className="pl-10"
            aria-label="Buscar compra"
          />
        </div>
        <Button
          variant="outline"
          size="md"
          onClick={() => router.push("/dashboard/compras/nueva")}
          className="sm:min-w-[200px]"
        >
          <PlusIcon className="h-4 w-4" />
          Nueva compra
        </Button>
      </div>

      {error ? (
        <Alert tone="error">{error}</Alert>
      ) : null}

      <div className="panel overflow-hidden rounded-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-b-2 border-steel-700 bg-steel-900/70">
              <tr>
                <Th>Fecha</Th>
                <Th>Proveedor</Th>
                <Th>Método Pago</Th>
                <Th>Estado</Th>
                <Th className="text-right">Total</Th>
                {canManage ? <Th className="text-right">Acción</Th> : null}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={canManage ? 6 : 5}
                    className="px-5 py-12 text-center text-[13px] text-muted-foreground"
                  >
                    {initialRows.length === 0
                      ? "Aún no hay compras registradas. Usa «Nueva compra» para recibir mercancía."
                      : "Sin resultados para tu búsqueda."}
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-steel-800 transition-colors hover:bg-steel-900/50"
                  >
                    <Td>
                      <span className="font-mono text-[12.5px] tabular-nums text-muted-foreground">
                        {dateFmt.format(new Date(r.created_at))}
                      </span>
                    </Td>
                    <Td>
                      <span className="font-semibold text-foreground">
                        {r.supplier_name}
                      </span>
                    </Td>
                    <Td>
                      <span className="font-mono text-[12px] uppercase tracking-[0.1em] text-muted-foreground">
                        {PAYMENT_LABELS[r.payment_method ?? ""] ?? r.payment_method ?? "—"}
                      </span>
                    </Td>
                    <Td>
                      <StatusBadge status={r.status} />
                    </Td>
                    <Td className="text-right">
                      <span className="font-mono text-[14px] font-bold tabular-nums text-foreground">
                        {moneyFmt.format(Number(r.total))}
                      </span>
                    </Td>
                    {canManage ? (
                      <Td className="text-right">
                        {r.status === "received" ? (
                          confirmId === r.id ? (
                            <div className="flex items-center justify-end gap-2">
                              <span className="text-[11px] text-red-300">
                                ¿Seguro?
                              </span>
                              <button
                                type="button"
                                disabled={cancelling === r.id}
                                onClick={() => handleCancel(r.id)}
                                className="inline-flex items-center gap-1 rounded-sm border border-hazard-500/60 bg-hazard-700/15 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-red-300 transition-colors hover:bg-hazard-700/30 disabled:opacity-50"
                              >
                                {cancelling === r.id ? "Anulando…" : "Confirmar"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmId(null)}
                                className="inline-flex items-center rounded-sm border border-steel-700 bg-steel-800 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmId(r.id);
                                setError(null);
                              }}
                              className="inline-flex items-center gap-1.5 rounded-sm border border-hazard-500/40 bg-steel-800 px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-red-400 transition-colors hover:border-hazard-500/60 hover:bg-hazard-700/15 hover:text-red-300"
                            >
                              <XIcon className="h-3.5 w-3.5" />
                              Anular
                            </button>
                          )
                        ) : (
                          <span className="font-mono text-[10px] text-muted-foreground/50">
                            —
                          </span>
                        )}
                      </Td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {initialRows.length > 0 ? (
        <p className="text-right font-mono text-[11px] text-muted-foreground">
          {filtered.length} de {initialRows.length} orden
          {initialRows.length !== 1 ? "es" : ""}
        </p>
      ) : null}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "received":
      return <Badge tone="active">Recibido</Badge>;
    case "cancelled":
      return <Badge tone="danger">Anulado</Badge>;
    case "draft":
      return <Badge tone="neutral">Borrador</Badge>;
    case "confirmed":
      return <Badge tone="info">Confirmado</Badge>;
    default:
      return <Badge tone="neutral">{status}</Badge>;
  }
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
    <td className={"px-5 py-4 align-middle " + (className ?? "")}>
      {children}
    </td>
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

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 6 6 18" />
      <path d="M6 6l12 12" />
    </svg>
  );
}
