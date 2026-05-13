"use client";

import * as React from "react";
import Big from "big.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Sheet } from "@/components/ui/sheet";
import {
  addReceivablePaymentAction,
  getReceivablePaymentsAction,
} from "@/actions/sales";
import {
  RECEIVABLE_STATUS_LABELS,
  type ReceivableRow,
  type ReceivablePaymentRow,
} from "@/lib/validations/receivable";

const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency", currency: "USD", minimumFractionDigits: 2,
});
const dateFmt = (s: string | null) =>
  s ? new Date(s + "T00:00:00").toLocaleDateString("es-EC", { day: "2-digit", month: "short", year: "numeric" }) : "—";

type StatusFilter = "all" | "pending" | "partial" | "overdue" | "paid";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all",     label: "Todas"     },
  { value: "pending", label: "Pendiente" },
  { value: "partial", label: "Parcial"   },
  { value: "overdue", label: "Vencidas"  },
  { value: "paid",    label: "Pagadas"   },
];

function statusTone(row: ReceivableRow): "neutral" | "active" | "warning" | "danger" {
  if (row.status === "paid")    return "active";
  if (row.is_overdue || row.status === "overdue") return "danger";
  if (row.status === "partial") return "warning";
  return "neutral";
}

function useDebounce<T>(value: T, delay: number): T {
  const [d, setD] = React.useState<T>(value);
  React.useEffect(() => { const id = setTimeout(() => setD(value), delay); return () => clearTimeout(id); }, [value, delay]);
  return d;
}

// ── AddPaymentDrawer ────────────────────────────────────────────────────────

function AddPaymentDrawer({
  row,
  open,
  onClose,
  onSuccess,
  cashSessionId,
}: {
  row: ReceivableRow;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  cashSessionId: string | null;
}) {
  const [payments, setPayments]   = React.useState<ReceivablePaymentRow[]>([]);
  const [loading, setLoading]     = React.useState(false);
  const [amount, setAmount]       = React.useState("");
  const [method, setMethod]       = React.useState<"cash"|"card"|"transfer">("cash");
  const [reference, setReference] = React.useState("");
  const [notes, setNotes]         = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError]         = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setAmount(""); setReference(""); setNotes(""); setError(null); setMethod("cash");
    setLoading(true);
    getReceivablePaymentsAction(row.id).then((res) => {
      setPayments(res?.rows ?? []);
      setLoading(false);
    });
  }, [open, row.id]);

  const amountNum = React.useMemo(() => {
    const n = parseFloat(amount.replace(",", "."));
    return isFinite(n) && n > 0 ? n : 0;
  }, [amount]);

  const remaining = Number(Big(row.balance_due).round(2));

  const handleSubmit = async () => {
    if (amountNum <= 0)           { setError("Ingresa un monto válido.");                           return; }
    if (amountNum > remaining + 0.001) { setError(`El abono ($${amountNum.toFixed(2)}) supera el saldo ($${remaining.toFixed(2)}).`); return; }

    setSubmitting(true); setError(null);
    const res = await addReceivablePaymentAction({
      receivable_id:  row.id,
      amount:         amountNum,
      payment_method: method,
      reference:      reference || null,
      notes:          notes || null,
    }, cashSessionId);
    setSubmitting(false);

    if (res?.error) { setError(res.error); return; }
    onSuccess();
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Abono — ${row.customer_name}`}
      description={`Venta · ${moneyFmt.format(row.total_amount)} · Saldo: ${moneyFmt.format(remaining)}`}
    >
      <div className="flex h-full flex-col gap-5 overflow-y-auto px-6 py-5">
        {/* Resumen */}
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Total venta"     value={moneyFmt.format(row.total_amount)} />
          <StatCard label="Total abonado"   value={moneyFmt.format(row.paid_amount)} />
          <StatCard label="Saldo pendiente" value={moneyFmt.format(remaining)} highlight={remaining > 0} />
        </div>

        {row.due_date ? (
          <div className={[
            "rounded-sm border px-3 py-2 font-mono text-[11px]",
            row.is_overdue
              ? "border-red-500/30 bg-red-500/10 text-red-400"
              : "border-steel-700 text-muted-foreground",
          ].join(" ")}>
            Vencimiento: {dateFmt(row.due_date)}
            {row.is_overdue ? " · VENCIDA" : ""}
          </div>
        ) : null}

        {/* Historial */}
        <div>
          <SectionHeader label="Historial de abonos" />
          {loading ? (
            <p className="py-4 text-center font-mono text-[12px] text-muted-foreground">Cargando…</p>
          ) : payments.length === 0 ? (
            <p className="py-4 text-center font-mono text-[12px] text-muted-foreground">Sin abonos registrados.</p>
          ) : (
            <div className="space-y-2">
              {payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-sm border border-steel-700 px-3 py-2">
                  <div>
                    <p className="font-mono text-[12px] font-semibold text-foreground">
                      {moneyFmt.format(p.amount)}
                    </p>
                    <p className="font-mono text-[10px] text-muted-foreground">
                      {dateFmt(p.payment_date)} · {PAYMENT_METHOD_LABELS[p.payment_method as "cash"|"card"|"transfer"] ?? p.payment_method}
                      {p.reference ? ` · ${p.reference}` : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Registrar abono */}
        {row.status !== "paid" && row.status !== "cancelled" ? (
          <div className="space-y-4">
            <SectionHeader label="Registrar abono" />

            <div className="space-y-1.5">
              <Label htmlFor="abono-amount">Monto del abono</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                  USD
                </span>
                <Input
                  id="abono-amount" type="number" min={0.01} step="0.01" max={remaining}
                  value={amount}
                  onChange={(e) => { setAmount(e.target.value); setError(null); }}
                  placeholder={remaining.toFixed(2)}
                  mono className="h-11 pl-14 text-right text-[15px]"
                  onFocus={(e) => e.target.select()} autoFocus
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                Método de pago
              </Label>
              <div className="grid grid-cols-3 gap-2">
                {(["cash","card","transfer"] as const).map((m) => (
                  <button
                    key={m} type="button" onClick={() => setMethod(m)}
                    className={[
                      "rounded-sm border-2 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.1em] transition-all",
                      method === m
                        ? "border-safety-500 bg-safety-500/10 text-safety-500"
                        : "border-steel-700 bg-steel-900 text-muted-foreground hover:border-steel-600",
                    ].join(" ")}
                  >
                    {PAYMENT_METHOD_LABELS[m]}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="abono-ref">
                Referencia <span className="font-normal normal-case tracking-normal text-muted-foreground/60">(opcional)</span>
              </Label>
              <Input id="abono-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="abono-notes">
                Nota <span className="font-normal normal-case tracking-normal text-muted-foreground/60">(opcional)</span>
              </Label>
              <Input id="abono-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} />
            </div>

            {error ? <Alert tone="error">{error}</Alert> : null}

            <Button
              size="md" className="w-full" loading={submitting}
              disabled={submitting || amountNum <= 0}
              onClick={handleSubmit}
            >
              Registrar abono
            </Button>
          </div>
        ) : (
          <div className="rounded-sm border border-signal-600/30 bg-signal-700/15 px-4 py-3 text-center font-mono text-[12px] text-signal-400">
            {row.status === "paid" ? "✅ Esta cuenta está completamente pagada." : "Esta cuenta ha sido cancelada."}
          </div>
        )}
      </div>
    </Sheet>
  );
}

// ── ReceivableTable (main export) ───────────────────────────────────────────

export function ReceivableTable({
  initialRows,
  cashSessionId,
}: {
  initialRows: ReceivableRow[];
  cashSessionId: string | null;
}) {
  const [rows, setRows]               = React.useState<ReceivableRow[]>(initialRows);
  const [query, setQuery]             = React.useState("");
  const debouncedQuery                = useDebounce(query, 200);
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("pending");
  const [selected, setSelected]       = React.useState<ReceivableRow | null>(null);
  const [drawerOpen, setDrawerOpen]   = React.useState(false);

  // Sync if parent re-fetches
  React.useEffect(() => { setRows(initialRows); }, [initialRows]);

  const filtered = React.useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter === "overdue" && !r.is_overdue && r.status !== "overdue") return false;
      if (statusFilter === "pending" && r.status !== "pending") return false;
      if (statusFilter === "partial" && r.status !== "partial") return false;
      if (statusFilter === "paid"    && r.status !== "paid")    return false;
      if (q) {
        return (
          r.customer_name.toLowerCase().includes(q) ||
          (r.customer_document ?? "").toLowerCase().includes(q) ||
          r.sale_id.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [rows, debouncedQuery, statusFilter]);

  const totalBalance = React.useMemo(
    () => filtered.filter((r) => r.status !== "paid").reduce((s, r) => s + r.balance_due, 0),
    [filtered]
  );

  const openDrawer = (row: ReceivableRow) => { setSelected(row); setDrawerOpen(true); };

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-md flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por cliente, documento o venta"
            className="pl-10"
          />
        </div>
        {filtered.some((r) => r.status !== "paid") ? (
          <div className="rounded-sm border border-signal-600/30 bg-signal-700/10 px-3 py-1.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-signal-400/80">Saldo total por cobrar: </span>
            <span className="font-mono text-[13px] font-bold tabular-nums text-signal-400">{moneyFmt.format(totalBalance)}</span>
          </div>
        ) : null}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground/60">Estado:</span>
        <div className="flex items-center divide-x divide-steel-700 overflow-hidden rounded-sm border border-steel-700">
          {STATUS_FILTERS.map(({ value, label }) => (
            <button
              key={value} type="button"
              onClick={() => setStatusFilter(value)}
              className={[
                "px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] transition-colors",
                statusFilter === value
                  ? "bg-safety-500 text-steel-950"
                  : "bg-transparent text-muted-foreground hover:bg-steel-800 hover:text-foreground",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="panel overflow-hidden rounded-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-b-2 border-steel-700 bg-steel-900/70">
              <tr>
                <Th>Cliente</Th>
                <Th className="hidden sm:table-cell">Fecha</Th>
                <Th className="text-right">Total</Th>
                <Th className="text-right">Abonado</Th>
                <Th className="text-right">Saldo</Th>
                <Th>Estado</Th>
                <Th className="text-right">Acción</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-[13px] text-muted-foreground">
                    {rows.length === 0
                      ? "No hay cuentas por cobrar registradas."
                      : "Sin resultados para los filtros seleccionados."}
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.id} className="border-b border-steel-800 transition-colors hover:bg-steel-900/50">
                    <Td>
                      <p className="font-semibold text-foreground">{row.customer_name}</p>
                      {row.customer_document ? (
                        <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{row.customer_document}</p>
                      ) : null}
                    </Td>
                    <Td className="hidden sm:table-cell">
                      <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
                        {dateFmt(row.sale_date)}
                      </span>
                      {row.due_date ? (
                        <p className={[
                          "mt-0.5 font-mono text-[10px]",
                          row.is_overdue ? "text-red-400" : "text-muted-foreground/60",
                        ].join(" ")}>
                          Vence: {dateFmt(row.due_date)}
                        </p>
                      ) : null}
                    </Td>
                    <Td className="text-right">
                      <span className="font-mono text-[13px] tabular-nums text-foreground">
                        {moneyFmt.format(row.total_amount)}
                      </span>
                    </Td>
                    <Td className="text-right">
                      <span className="font-mono text-[13px] tabular-nums text-muted-foreground">
                        {moneyFmt.format(row.paid_amount)}
                      </span>
                    </Td>
                    <Td className="text-right">
                      <span className={[
                        "font-mono text-[13px] font-bold tabular-nums",
                        row.balance_due > 0 ? "text-signal-400" : "text-muted-foreground",
                      ].join(" ")}>
                        {moneyFmt.format(row.balance_due)}
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={statusTone(row)}>
                        {row.is_overdue && row.status !== "paid"
                          ? "Vencida"
                          : RECEIVABLE_STATUS_LABELS[row.status] ?? row.status}
                      </Badge>
                    </Td>
                    <Td className="text-right">
                      <Button
                        variant="outline" size="md"
                        onClick={() => openDrawer(row)}
                      >
                        {row.status === "paid" ? "Ver" : "Abonar"}
                      </Button>
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected ? (
        <AddPaymentDrawer
          row={selected}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          cashSessionId={cashSessionId}
          onSuccess={() => {
            // Optimistically update the row
            setRows((prev) =>
              prev.map((r) =>
                r.id === selected.id
                  ? { ...r, status: "partial" as const }
                  : r
              )
            );
          }}
        />
      ) : null}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const PAYMENT_METHOD_LABELS: Record<"cash"|"card"|"transfer", string> = {
  cash:     "Efectivo",
  card:     "Tarjeta",
  transfer: "Transferencia",
};

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 pb-2 pt-1">
      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60">{label}</span>
      <div className="h-px flex-1 bg-steel-700/60" />
    </div>
  );
}

function StatCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-sm border border-steel-700 bg-steel-900/40 px-3 py-2 text-center">
      <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground/60">{label}</p>
      <p className={["font-mono text-[14px] font-bold tabular-nums mt-0.5", highlight ? "text-signal-400" : "text-foreground"].join(" ")}>
        {value}
      </p>
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
  return <td className={"px-5 py-4 align-top " + (className ?? "")}>{children}</td>;
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
    </svg>
  );
}
