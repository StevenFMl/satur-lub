"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Dialog } from "@/components/ui/dialog";
import { DropdownMenu, DropdownItem } from "@/components/ui/dropdown-menu";
import { cancelPurchaseAction } from "@/actions/purchases";

export type PurchaseListRow = {
  id: string;
  date: string;
  created_at: string;
  supplier_id: string | null;
  supplier_name: string;
  warehouse_name: string | null;
  total: number;
  subtotal: number;
  tax_total: number;
  status: string;
  payment_method: string | null;
  payment_status: string;
  payment_due_date: string | null;
  item_count: number;
  notes: string | null;
};

const PAGE_SIZE = 20;

type StatusFilter = "all" | "received" | "cancelled";
type PaymentFilter = "all" | "cash" | "transfer" | "credit";
type DateFilter = "all" | "7days" | "30days";

const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

const dateFmt = new Intl.DateTimeFormat("es-EC", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const PAYMENT_LABELS: Record<string, string> = {
  cash: "Contado",
  transfer: "Transf.",
  credit: "Crédito",
};

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = React.useState<T>(value);
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export function PurchasesList({
  initialRows,
  canManage,
}: {
  initialRows: PurchaseListRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const debouncedQuery = useDebounce(query, 200);
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all");
  const [paymentFilter, setPaymentFilter] = React.useState<PaymentFilter>("all");
  const [dateFilter, setDateFilter] = React.useState<DateFilter>("all");
  const [page, setPage] = React.useState(1);

  const [confirmId, setConfirmId] = React.useState<string | null>(null);
  const [cancelling, setCancelling] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setPage(1);
  }, [debouncedQuery, statusFilter, paymentFilter, dateFilter]);

  const filtered = React.useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    const now = Date.now();
    const cutoff =
      dateFilter === "7days"
        ? now - 7 * 24 * 60 * 60 * 1000
        : dateFilter === "30days"
          ? now - 30 * 24 * 60 * 60 * 1000
          : 0;
    return initialRows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (paymentFilter !== "all" && r.payment_method !== paymentFilter) return false;
      if (cutoff > 0 && new Date(r.date).getTime() < cutoff) return false;
      if (q && !r.supplier_name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [initialRows, debouncedQuery, statusFilter, paymentFilter, dateFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const rangeStart = filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(safePage * PAGE_SIZE, filtered.length);

  const stats = React.useMemo(() => {
    const received = initialRows.filter((r) => r.status === "received");
    const total = received.reduce((sum, r) => sum + r.total, 0);
    const pendingCredit = received.filter(
      (r) => r.payment_method === "credit" && r.payment_status === "pending"
    ).length;
    return { count: received.length, total, pendingCredit };
  }, [initialRows]);

  const handleCancel = async (poId: string) => {
    setCancelling(true);
    setError(null);
    try {
      const result = await cancelPurchaseAction(poId);
      if (result?.error) setError(result.error);
      else router.refresh();
    } catch {
      setError("Error de conexión al anular.");
    } finally {
      setCancelling(false);
      setConfirmId(null);
    }
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* ── Stats + CTA ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-[1fr_1fr_1fr_auto] sm:gap-3">
        <StatCard label="Compras recibidas" value={String(stats.count)} />
        <StatCard label="Valor acumulado" value={moneyFmt.format(stats.total)} />
        <StatCard
          label="Crédito pendiente"
          value={String(stats.pendingCredit)}
          tone={stats.pendingCredit > 0 ? "warning" : "neutral"}
        />
        <Button
          onClick={() => router.push("/dashboard/compras/nueva")}
          size="md"
          className="col-span-2 h-auto min-h-[56px] sm:col-span-1 sm:min-w-[180px]"
        >
          <PlusIcon className="h-4 w-4" />
          Nueva compra
        </Button>
      </div>

      {/* ── Search ──────────────────────────────────────────────── */}
      <div className="relative max-w-md">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por proveedor"
          className="pl-10 h-11"
          aria-label="Buscar compra"
        />
      </div>

      {/* ── Filters ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start gap-3">
        <FilterGroup label="Estado">
          <FilterBtn active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>Todas</FilterBtn>
          <FilterBtn active={statusFilter === "received"} onClick={() => setStatusFilter("received")}>Recibidas</FilterBtn>
          <FilterBtn active={statusFilter === "cancelled"} onClick={() => setStatusFilter("cancelled")}>Anuladas</FilterBtn>
        </FilterGroup>
        <FilterGroup label="Pago">
          <FilterBtn active={paymentFilter === "all"} onClick={() => setPaymentFilter("all")}>Todo</FilterBtn>
          <FilterBtn active={paymentFilter === "cash"} onClick={() => setPaymentFilter("cash")}>Contado</FilterBtn>
          <FilterBtn active={paymentFilter === "transfer"} onClick={() => setPaymentFilter("transfer")}>Transf.</FilterBtn>
          <FilterBtn active={paymentFilter === "credit"} onClick={() => setPaymentFilter("credit")}>Crédito</FilterBtn>
        </FilterGroup>
        <FilterGroup label="Periodo">
          <FilterBtn active={dateFilter === "all"} onClick={() => setDateFilter("all")}>Todo</FilterBtn>
          <FilterBtn active={dateFilter === "7days"} onClick={() => setDateFilter("7days")}>7d</FilterBtn>
          <FilterBtn active={dateFilter === "30days"} onClick={() => setDateFilter("30days")}>30d</FilterBtn>
        </FilterGroup>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {/* ── Desktop table ───────────────────────────────────────── */}
      <div className="hidden panel overflow-hidden rounded-sm sm:block">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-b-2 border-steel-700 bg-steel-900/70">
              <tr>
                <Th>Fecha</Th>
                <Th>Proveedor</Th>
                <Th className="text-right">Ítems</Th>
                <Th>Pago</Th>
                <Th>Estado</Th>
                <Th className="text-right">Total</Th>
                <Th className="w-[60px] text-right"> </Th>
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-5 py-12 text-center text-[13px] text-muted-foreground"
                  >
                    {initialRows.length === 0 ? (
                      <EmptyState
                        canManage={canManage}
                        onNew={() => router.push("/dashboard/compras/nueva")}
                      />
                    ) : (
                      "Sin resultados para los filtros seleccionados."
                    )}
                  </td>
                </tr>
              ) : (
                paginated.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => router.push(`/dashboard/compras/${r.id}`)}
                    className="cursor-pointer border-b border-steel-800 transition-colors hover:bg-steel-900/50"
                  >
                    <Td>
                      <span className="font-mono text-[12.5px] tabular-nums text-muted-foreground">
                        {dateFmt.format(new Date(r.date))}
                      </span>
                    </Td>
                    <Td>
                      <div className="font-semibold text-foreground">{r.supplier_name}</div>
                      {r.warehouse_name ? (
                        <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
                          {r.warehouse_name}
                        </div>
                      ) : null}
                    </Td>
                    <Td className="text-right">
                      <span className="font-mono text-[12.5px] tabular-nums text-muted-foreground">
                        {r.item_count}
                      </span>
                    </Td>
                    <Td>
                      <PaymentBadge method={r.payment_method} status={r.payment_status} />
                    </Td>
                    <Td>
                      <StatusBadge status={r.status} />
                    </Td>
                    <Td className="text-right">
                      <span className="font-mono text-[14px] font-bold tabular-nums text-foreground">
                        {moneyFmt.format(r.total)}
                      </span>
                    </Td>
                    <Td
                      className="text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <DropdownMenu triggerAriaLabel={`Acciones para compra ${r.supplier_name}`}>
                        {(close) => (
                          <>
                            <DropdownItem
                              onClick={() => {
                                close();
                                router.push(`/dashboard/compras/${r.id}`);
                              }}
                            >
                              <EyeIcon className="h-3.5 w-3.5" />
                              Ver detalle
                            </DropdownItem>
                            {canManage && r.status === "received" ? (
                              <DropdownItem
                                destructive
                                onClick={() => {
                                  close();
                                  setConfirmId(r.id);
                                }}
                              >
                                <XIcon className="h-3.5 w-3.5" />
                                Anular
                              </DropdownItem>
                            ) : null}
                          </>
                        )}
                      </DropdownMenu>
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Mobile cards ────────────────────────────────────────── */}
      <div className="space-y-3 sm:hidden">
        {paginated.length === 0 ? (
          <div className="panel rounded-sm px-5 py-10 text-center text-[13px] text-muted-foreground">
            {initialRows.length === 0 ? (
              <EmptyState
                canManage={canManage}
                onNew={() => router.push("/dashboard/compras/nueva")}
              />
            ) : (
              "Sin resultados para los filtros seleccionados."
            )}
          </div>
        ) : (
          paginated.map((r) => (
            <PurchaseCard
              key={r.id}
              row={r}
              canManage={canManage}
              onView={() => router.push(`/dashboard/compras/${r.id}`)}
              onCancel={() => setConfirmId(r.id)}
            />
          ))
        )}
      </div>

      {/* ── Pagination ──────────────────────────────────────────── */}
      {filtered.length > 0 ? (
        <div className="flex flex-col items-stretch gap-3 text-[12.5px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span className="text-center sm:text-left">
            Mostrando {rangeStart}–{rangeEnd} de {filtered.length} compra
            {filtered.length !== 1 ? "s" : ""}
          </span>
          <div className="flex items-center justify-center gap-2 sm:gap-3">
            <Button
              variant="outline"
              size="md"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Anterior
            </Button>
            <span className="font-mono text-[12px] tabular-nums px-1">
              {safePage} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="md"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Siguiente
            </Button>
          </div>
        </div>
      ) : null}

      {/* ── Cancel confirm dialog ───────────────────────────────── */}
      <Dialog
        open={Boolean(confirmId)}
        onClose={() => !cancelling && setConfirmId(null)}
        title="¿Anular esta compra?"
        description="Se revertirá el inventario y el costo promedio. Esta acción no se puede deshacer."
      >
        <div className="space-y-3 px-6 py-5">
          <Alert tone="warning">
            Si los productos de esta compra ya se vendieron, el sistema no permitirá anularla por falta de stock.
          </Alert>
        </div>
        <div className="flex justify-end gap-3 border-t-2 border-steel-700 bg-steel-900/60 px-6 py-4">
          <Button
            variant="outline"
            size="md"
            onClick={() => setConfirmId(null)}
            disabled={cancelling}
          >
            Cancelar
          </Button>
          <Button
            size="md"
            loading={cancelling}
            onClick={() => confirmId && handleCancel(confirmId)}
            className="border-hazard-500/60 bg-hazard-700/80 hover:bg-hazard-700"
          >
            Sí, anular
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

// ── Sub-componentes ────────────────────────────────────────────────────────

function PurchaseCard({
  row,
  canManage,
  onView,
  onCancel,
}: {
  row: PurchaseListRow;
  canManage: boolean;
  onView: () => void;
  onCancel: () => void;
}) {
  const isCancelled = row.status === "cancelled";
  return (
    <div
      onClick={onView}
      className={
        "panel cursor-pointer rounded-sm px-4 py-4 transition-colors active:bg-steel-800/60 " +
        (isCancelled ? "opacity-70" : "")
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-foreground">
            {row.supplier_name}
          </div>
          <div className="mt-0.5 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
            <span>{dateFmt.format(new Date(row.date))}</span>
            <span className="text-muted-foreground/40">•</span>
            <span>{row.item_count} ítem{row.item_count !== 1 ? "s" : ""}</span>
          </div>
        </div>
        <span className="shrink-0 font-mono text-[16px] font-bold tabular-nums text-foreground">
          {moneyFmt.format(row.total)}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <StatusBadge status={row.status} />
        <PaymentBadge method={row.payment_method} status={row.payment_status} />
        {row.warehouse_name ? (
          <span className="rounded-sm border border-steel-700 bg-steel-900/60 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {row.warehouse_name}
          </span>
        ) : null}
      </div>

      {canManage && row.status === "received" ? (
        <div
          className="mt-3 flex justify-end border-t border-steel-800/70 pt-2"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 rounded-sm border border-hazard-500/30 bg-hazard-700/10 px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-red-400 transition-colors hover:border-hazard-500/60 hover:bg-hazard-700/20 hover:text-red-300"
          >
            <XIcon className="h-3 w-3" />
            Anular
          </button>
        </div>
      ) : null}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "warning";
}) {
  return (
    <div
      className={
        "panel rounded-sm px-4 py-3 " +
        (tone === "warning" ? "border-safety-500/40" : "")
      }
    >
      <div className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">
        {label}
      </div>
      <div
        className={
          "mt-1.5 font-mono text-[20px] font-bold tabular-nums sm:text-[22px] " +
          (tone === "warning" ? "text-safety-500" : "text-foreground")
        }
      >
        {value}
      </div>
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground/60">
        {label}:
      </span>
      <div className="flex items-center divide-x divide-steel-700 overflow-hidden rounded-sm border border-steel-700">
        {children}
      </div>
    </div>
  );
}

function FilterBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "min-h-[36px] px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] transition-colors " +
        (active
          ? "bg-safety-500 text-steel-950"
          : "bg-transparent text-muted-foreground hover:bg-steel-800 hover:text-foreground")
      }
    >
      {children}
    </button>
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

function PaymentBadge({
  method,
  status,
}: {
  method: string | null;
  status: string;
}) {
  const label = PAYMENT_LABELS[method ?? ""] ?? "—";
  if (method === "credit" && status === "pending") {
    return <Badge tone="warning">{label} · Pdte</Badge>;
  }
  return <Badge tone="neutral">{label}</Badge>;
}

function EmptyState({
  canManage,
  onNew,
}: {
  canManage: boolean;
  onNew: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <div className="grid h-14 w-14 place-items-center rounded-sm border-2 border-dashed border-steel-700 text-muted-foreground/60">
        <BoxIcon className="h-6 w-6" />
      </div>
      <div className="space-y-1">
        <p className="font-mono text-[13px] font-semibold uppercase tracking-[0.12em] text-foreground">
          Sin compras registradas
        </p>
        <p className="text-[12.5px] text-muted-foreground">
          Cuando recibas mercancía de un proveedor, aparecerá aquí con su histórico completo.
        </p>
      </div>
      {canManage ? (
        <Button onClick={onNew} size="md">
          <PlusIcon className="h-4 w-4" />
          Registrar primera compra
        </Button>
      ) : null}
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
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <td className={"px-5 py-4 align-middle " + (className ?? "")} onClick={onClick}>
      {children}
    </td>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 6 6 18" />
      <path d="M6 6l12 12" />
    </svg>
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function BoxIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <path d="M3.27 6.96 12 12.01l8.73-5.05" />
      <path d="M12 22.08V12" />
    </svg>
  );
}
