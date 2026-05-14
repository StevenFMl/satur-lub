"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Dialog } from "@/components/ui/dialog";
import { cancelPurchaseAction } from "@/actions/purchases";

// Print styles injected once — hides everything except .print-doc
const PRINT_STYLE = `
@media print {
  body > * { display: none !important; }
  .print-doc { display: block !important; }
  .print-doc * { display: revert; }
  .print-hide { display: none !important; }
  @page { margin: 18mm 15mm; }
}
`;

export type PurchaseFull = {
  id: string;
  created_at: string;
  purchase_date: string | null;
  subtotal: number;
  tax_total: number;
  total: number;
  tax_rate: number;
  is_tax_inclusive: boolean;
  status: string;
  payment_method: string | null;
  payment_status: string;
  payment_due_date: string | null;
  notes: string | null;
  document_number: string | null;
  supplier: { id: string; name: string; document_number: string } | null;
  warehouse: { id: string; name: string } | null;
};

export type LineItem = {
  id: string;
  quantity: number;
  quantity_bonus: number;
  unit_cost: number;
  line_total: number;
  is_taxable: boolean;
  base_qty: number;
  product: { id: string; name: string; sku: string; unit: string } | null;
};

const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

const unitCostFmt = new Intl.NumberFormat("es-EC", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

const dateFmt = new Intl.DateTimeFormat("es-EC", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});

const PAYMENT_LABELS: Record<string, string> = {
  cash: "Contado",
  transfer: "Transferencia",
  credit: "Crédito",
};

export function PurchaseDetail({
  purchase,
  items,
  canManage,
}: {
  purchase: PurchaseFull;
  items: LineItem[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleCancel = async () => {
    setCancelling(true);
    setError(null);
    try {
      const result = await cancelPurchaseAction(purchase.id);
      if (result?.error) {
        setError(result.error);
        setConfirmOpen(false);
      } else {
        router.push("/dashboard/compras");
      }
    } catch {
      setError("Error de conexión al anular.");
    } finally {
      setCancelling(false);
    }
  };

  const shortId = purchase.id.slice(0, 8).toUpperCase();
  const displayDate = purchase.purchase_date ?? purchase.created_at;
  const isCancelled = purchase.status === "cancelled";

  return (
    <>
      {/* Print styles */}
      <style dangerouslySetInnerHTML={{ __html: PRINT_STYLE }} />

    <div className="print-doc mx-auto w-full max-w-5xl space-y-5 sm:space-y-7">
      {/* ── Back link ──────────────────────────────────────────── */}
      <div className="print-hide">
        <Link
          href="/dashboard/compras"
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeftIcon className="h-3.5 w-3.5" />
          Volver a compras
        </Link>
      </div>

      {/* ── Header ─────────────────────────────────────────────── */}
      <header className={"space-y-3 " + (isCancelled ? "opacity-70" : "")}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <span className="hud-readout print-hide">Compra · {shortId}</span>
            {/* Print-only header */}
            <p className="hidden font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground print:block">
              ORDEN DE COMPRA · {shortId} · {dateFmt.format(new Date(displayDate))}
            </p>
            <h1 className="break-words font-display text-[28px] leading-[1.05] tracking-[0.02em] text-foreground sm:text-[36px]">
              {purchase.supplier?.name ?? "Sin proveedor"}
            </h1>
            <p className="font-mono text-[12px] uppercase tracking-[0.12em] text-muted-foreground">
              {dateFmt.format(new Date(displayDate))}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <StatusBadge status={purchase.status} />
            {purchase.payment_method === "credit" && purchase.payment_status === "pending" ? (
              <Badge tone="warning">Por pagar</Badge>
            ) : null}
            {/* Print button */}
            <button
              type="button"
              onClick={() => window.print()}
              className="print-hide inline-flex items-center gap-1.5 rounded-sm border border-steel-700 bg-steel-900 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-steel-600 hover:text-foreground"
            >
              <PrintIcon className="h-3.5 w-3.5" />
              Imprimir
            </button>
          </div>
        </div>
      </header>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {/* ── Summary cards ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
        <SummaryCard label="Total" value={moneyFmt.format(purchase.total)} sub="c/IVA" highlight />
        <SummaryCard label="Subtotal" value={moneyFmt.format(purchase.subtotal)} sub="sin IVA" />
        <SummaryCard label="IVA" value={moneyFmt.format(purchase.tax_total)} sub={`${purchase.tax_rate}%`} />
        <SummaryCard label="Ítems" value={String(items.length)} />
      </div>

      {/* ── Details panel ──────────────────────────────────────── */}
      <section className="panel rounded-sm">
        <header className="top-highlight border-b-2 border-steel-700 bg-steel-900/70 px-5 py-3 sm:px-6 sm:py-4">
          <h2 className="font-display text-[15px] tracking-[0.04em] sm:text-[18px]">
            DETALLES
          </h2>
        </header>
        <dl className="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-2 sm:gap-5 sm:px-6 sm:py-5">
          <MetaRow
            label="Proveedor"
            value={purchase.supplier?.name ?? "—"}
            sub={purchase.supplier?.document_number}
          />
          <MetaRow
            label="Bodega"
            value={purchase.warehouse?.name ?? "Sin asignar"}
            sub={
              purchase.warehouse
                ? "Inventario actualizado"
                : "No actualizó stock"
            }
          />
          <MetaRow
            label="Método de pago"
            value={PAYMENT_LABELS[purchase.payment_method ?? ""] ?? "—"}
            sub={
              purchase.payment_status === "paid" ? "Pagado al recibir" : "Por cobrar"
            }
          />
          {purchase.payment_method === "credit" ? (
            <MetaRow
              label="Vence"
              value={
                purchase.payment_due_date
                  ? dateFmt.format(new Date(purchase.payment_due_date))
                  : "—"
              }
            />
          ) : (
            <MetaRow
              label="Modalidad IVA"
              value={`${purchase.tax_rate}%`}
              sub={
                purchase.is_tax_inclusive
                  ? "Precios c/IVA en factura"
                  : "Precios netos + IVA"
              }
            />
          )}
          {purchase.document_number ? (
            <MetaRow label="N.° factura" value={purchase.document_number} />
          ) : null}
        </dl>
      </section>

      {/* ── Items panel ────────────────────────────────────────── */}
      <section className="panel rounded-sm">
        <header className="top-highlight flex items-center justify-between border-b-2 border-steel-700 bg-steel-900/70 px-5 py-3 sm:px-6 sm:py-4">
          <h2 className="font-display text-[15px] tracking-[0.04em] sm:text-[18px]">
            ÍTEMS RECIBIDOS
          </h2>
          <Badge tone="neutral">{items.length}</Badge>
        </header>

        {/* Desktop table */}
        <div className="hidden sm:block">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="border-b border-steel-800 bg-steel-950/40">
                <tr>
                  <Th>Producto</Th>
                  <Th className="text-right">Recibido</Th>
                  <Th className="text-right">Precio unitario</Th>
                  <Th className="text-right">Total línea</Th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-5 py-8 text-center text-[13px] text-muted-foreground"
                    >
                      Esta compra no tiene ítems registrados.
                    </td>
                  </tr>
                ) : (
                  items.map((item) => {
                    const hasBonus = item.quantity_bonus > 0;
                    const totalReceived = item.quantity + item.quantity_bonus;
                    const taxRate = purchase.tax_rate;
                    const hasTax = item.is_taxable && taxRate > 0;
                    const netCost = item.unit_cost;
                    const ivaPerUnit = hasTax
                      ? parseFloat((netCost * taxRate / 100).toFixed(4))
                      : 0;
                    const grossCost = parseFloat((netCost * (1 + taxRate / 100)).toFixed(4));
                    const netLineTotal = item.line_total;
                    const grossLineTotal = hasTax
                      ? parseFloat((netLineTotal * (1 + taxRate / 100)).toFixed(2))
                      : netLineTotal;
                    const effectiveCost = hasBonus && totalReceived > 0
                      ? netLineTotal / totalReceived
                      : netCost;
                    return (
                    <tr
                      key={item.id}
                      className={`border-b border-steel-800/60 last:border-b-0 ${hasBonus ? "bg-emerald-950/10" : ""}`}
                    >
                      <Td>
                        <div className="font-semibold text-foreground">
                          {item.product?.name ?? "Producto eliminado"}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                          <span>{item.product?.sku ?? "—"}</span>
                          {!item.is_taxable ? (
                            <span className="rounded-sm border border-steel-700 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em]">
                              Sin IVA
                            </span>
                          ) : null}
                          {hasBonus ? (
                            <span className="rounded-sm border border-emerald-700/60 bg-emerald-900/20 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] text-emerald-400">
                              +{item.quantity_bonus} bonif.
                            </span>
                          ) : null}
                        </div>
                      </Td>
                      <Td className="text-right">
                        {hasBonus ? (
                          <>
                            <span className="font-mono text-[13px] tabular-nums text-foreground">
                              {totalReceived}
                            </span>
                            <span className="ml-1 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/70">
                              {item.product?.unit ?? ""}
                            </span>
                            <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/60">
                              {item.quantity} pagadas + {item.quantity_bonus} bonif.
                            </div>
                          </>
                        ) : (
                          <>
                            <span className="font-mono text-[13px] tabular-nums text-foreground">
                              {item.quantity}
                            </span>
                            <span className="ml-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/70">
                              {item.product?.unit ?? ""}
                            </span>
                          </>
                        )}
                      </Td>
                      <Td className="text-right">
                        {hasTax ? (
                          <div className="space-y-0.5">
                            {purchase.is_tax_inclusive ? (
                              <div className="font-mono text-[10px] tabular-nums text-muted-foreground/55">
                                fact.&nbsp;{unitCostFmt.format(grossCost)}
                              </div>
                            ) : null}
                            <div>
                              <span className="font-mono text-[13px] tabular-nums text-foreground">
                                {unitCostFmt.format(netCost)}
                              </span>
                              <span className="ml-1 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground/60">
                                s/IVA
                              </span>
                            </div>
                            <div className="font-mono text-[11px] tabular-nums text-muted-foreground/70">
                              +{unitCostFmt.format(ivaPerUnit)}&nbsp;
                              <span className="text-[9px] uppercase tracking-[0.08em]">IVA&nbsp;{taxRate}%</span>
                            </div>
                            <div>
                              <span className="font-mono text-[12px] font-semibold tabular-nums text-safety-400">
                                {unitCostFmt.format(grossCost)}
                              </span>
                              <span className="ml-1 font-mono text-[9px] uppercase tracking-[0.1em] text-safety-400/70">
                                c/IVA
                              </span>
                            </div>
                            {item.base_qty > 1 ? (
                              <div className="mt-0.5 font-mono text-[10px] tabular-nums text-muted-foreground/55">
                                →&nbsp;{unitCostFmt.format(netCost / item.base_qty)}&nbsp;/u.base
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <div>
                            <span className="font-mono text-[13px] tabular-nums text-foreground">
                              {unitCostFmt.format(netCost)}
                            </span>
                            {item.base_qty > 1 ? (
                              <div className="mt-0.5 font-mono text-[10px] tabular-nums text-muted-foreground/55">
                                →&nbsp;{unitCostFmt.format(netCost / item.base_qty)}&nbsp;/u.base
                              </div>
                            ) : null}
                          </div>
                        )}
                        {hasBonus ? (
                          <div className="mt-1 font-mono text-[10px] tabular-nums text-emerald-400">
                            efect.: {unitCostFmt.format(effectiveCost)}
                          </div>
                        ) : null}
                      </Td>
                      <Td className="text-right">
                        {hasTax ? (
                          <div className="space-y-0.5">
                            <div>
                              <span className="font-mono text-[14px] font-bold tabular-nums text-foreground">
                                {moneyFmt.format(netLineTotal)}
                              </span>
                              <span className="ml-1 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground/60">
                                neto
                              </span>
                            </div>
                            <div className="font-mono text-[12px] tabular-nums text-safety-400/80">
                              {moneyFmt.format(grossLineTotal)}&nbsp;
                              <span className="text-[9px] uppercase tracking-[0.08em]">c/IVA</span>
                            </div>
                          </div>
                        ) : (
                          <span className="font-mono text-[14px] font-bold tabular-nums text-foreground">
                            {moneyFmt.format(netLineTotal)}
                          </span>
                        )}
                      </Td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Mobile cards */}
        <div className="sm:hidden">
          {items.length === 0 ? (
            <div className="px-5 py-8 text-center text-[13px] text-muted-foreground">
              Esta compra no tiene ítems registrados.
            </div>
          ) : (
            items.map((item) => {
              const hasBonus = item.quantity_bonus > 0;
              const totalReceived = item.quantity + item.quantity_bonus;
              const taxRate = purchase.tax_rate;
              const hasTax = item.is_taxable && taxRate > 0;
              const netCost = item.unit_cost;
              const ivaPerUnit = hasTax
                ? parseFloat((netCost * taxRate / 100).toFixed(4))
                : 0;
              const grossCost = parseFloat((netCost * (1 + taxRate / 100)).toFixed(4));
              const netLineTotal = item.line_total;
              const grossLineTotal = hasTax
                ? parseFloat((netLineTotal * (1 + taxRate / 100)).toFixed(2))
                : netLineTotal;
              const effectiveCost = hasBonus && totalReceived > 0
                ? netLineTotal / totalReceived
                : netCost;
              return (
              <div
                key={item.id}
                className={`border-b border-steel-800/60 px-4 py-4 last:border-b-0 ${hasBonus ? "bg-emerald-950/10" : ""}`}
              >
                {/* Product name + line total */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold leading-tight text-foreground">
                      {item.product?.name ?? "Producto eliminado"}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
                      <span>{item.product?.sku ?? "—"}</span>
                      {!item.is_taxable ? (
                        <span className="rounded-sm border border-steel-700 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em]">
                          Sin IVA
                        </span>
                      ) : null}
                      {hasBonus ? (
                        <span className="rounded-sm border border-emerald-700/60 bg-emerald-900/20 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] text-emerald-400">
                          +{item.quantity_bonus} bonif.
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-mono text-[15px] font-bold tabular-nums text-foreground">
                      {moneyFmt.format(netLineTotal)}
                    </div>
                    {hasTax ? (
                      <div className="font-mono text-[11px] tabular-nums text-safety-400/80">
                        {moneyFmt.format(grossLineTotal)}&nbsp;c/IVA
                      </div>
                    ) : null}
                  </div>
                </div>
                {/* Quantity + unit cost breakdown */}
                <div className="mt-2.5 grid grid-cols-2 gap-3 border-t border-steel-800/40 pt-2.5">
                  <div>
                    <div className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">
                      {hasBonus ? "Recibido" : "Cantidad"}
                    </div>
                    <div className="mt-0.5 font-mono text-[13px] tabular-nums text-foreground">
                      {hasBonus ? totalReceived : item.quantity}{" "}
                      <span className="text-[10px] text-muted-foreground/70">
                        {item.product?.unit ?? ""}
                      </span>
                    </div>
                    {hasBonus ? (
                      <div className="mt-0.5 font-mono text-[10px] text-emerald-400/80">
                        {item.quantity} pag. + {item.quantity_bonus} bonif.
                      </div>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">
                      Precio unitario
                    </div>
                    {hasTax ? (
                      <div className="mt-0.5 space-y-0.5">
                        {purchase.is_tax_inclusive ? (
                          <div className="font-mono text-[10px] tabular-nums text-muted-foreground/55">
                            fact.&nbsp;{unitCostFmt.format(grossCost)}
                          </div>
                        ) : null}
                        <div className="font-mono text-[12px] tabular-nums text-foreground">
                          {unitCostFmt.format(netCost)}&nbsp;
                          <span className="text-[9px] text-muted-foreground/60">s/IVA</span>
                        </div>
                        <div className="font-mono text-[11px] tabular-nums text-muted-foreground/70">
                          +{unitCostFmt.format(ivaPerUnit)}&nbsp;
                          <span className="text-[9px]">IVA&nbsp;{taxRate}%</span>
                        </div>
                        <div className="font-mono text-[12px] font-semibold tabular-nums text-safety-400">
                          {unitCostFmt.format(grossCost)}&nbsp;
                          <span className="text-[9px] font-normal text-safety-400/70">c/IVA</span>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-0.5 font-mono text-[13px] tabular-nums text-foreground">
                        {unitCostFmt.format(netCost)}
                      </div>
                    )}
                    {item.base_qty > 1 ? (
                      <div className="mt-0.5 font-mono text-[10px] tabular-nums text-muted-foreground/55">
                        →&nbsp;{unitCostFmt.format(netCost / item.base_qty)}&nbsp;/u.base
                      </div>
                    ) : null}
                    {hasBonus ? (
                      <div className="mt-0.5 font-mono text-[10px] tabular-nums text-emerald-400">
                        efect.: {unitCostFmt.format(effectiveCost)}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
              );
            })
          )}
        </div>

        {/* Totals footer */}
        {items.length > 0 ? (
          <div className="border-t-2 border-steel-700 bg-steel-950/40 px-5 py-4 sm:px-6">
            <div className="ml-auto w-full max-w-sm space-y-2">
              <TotalRow label="Subtotal (neto)" value={moneyFmt.format(purchase.subtotal)} />
              <TotalRow label={`IVA (${purchase.tax_rate}%)`} value={moneyFmt.format(purchase.tax_total)} />
              <div className="my-2 h-px bg-steel-700/70" />
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-foreground">
                  Total factura
                </span>
                <span className="font-display text-[26px] leading-none tracking-[0.02em] text-safety-500 sm:text-[30px]">
                  {moneyFmt.format(purchase.total)}
                </span>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {/* ── Notes ──────────────────────────────────────────────── */}
      {purchase.notes ? (
        <section className="panel rounded-sm">
          <header className="top-highlight border-b-2 border-steel-700 bg-steel-900/70 px-5 py-3 sm:px-6 sm:py-4">
            <h2 className="font-display text-[15px] tracking-[0.04em] sm:text-[18px]">
              NOTAS
            </h2>
          </header>
          <div className="whitespace-pre-wrap px-5 py-4 text-[13.5px] leading-6 text-foreground/90 sm:px-6 sm:py-5">
            {purchase.notes}
          </div>
        </section>
      ) : null}

      {/* ── Actions ────────────────────────────────────────────── */}
      {canManage && purchase.status === "received" ? (
        <div className="print-hide flex justify-end border-t border-steel-700 pt-5">
          <Button
            variant="outline"
            size="md"
            onClick={() => setConfirmOpen(true)}
            className="border-hazard-500/40 text-red-400 hover:border-hazard-500/60 hover:bg-hazard-700/15 hover:text-red-300"
          >
            <XIcon className="h-3.5 w-3.5" />
            Anular esta compra
          </Button>
        </div>
      ) : null}

      {/* ── Cancel confirm dialog ─────────────────────────────── */}
      <Dialog
        open={confirmOpen}
        onClose={() => !cancelling && setConfirmOpen(false)}
        title="¿Anular esta compra?"
        description="Se revertirá el inventario y el costo promedio. Esta acción no se puede deshacer."
      >
        <div className="space-y-3 px-6 py-5">
          <Alert tone="warning">
            Si parte de los productos ya se vendieron, el sistema no permitirá anularla por falta de stock.
          </Alert>
        </div>
        <div className="flex justify-end gap-3 border-t-2 border-steel-700 bg-steel-900/60 px-6 py-4">
          <Button
            variant="outline"
            size="md"
            onClick={() => setConfirmOpen(false)}
            disabled={cancelling}
          >
            Cancelar
          </Button>
          <Button
            size="md"
            loading={cancelling}
            onClick={handleCancel}
            className="border-hazard-500/60 bg-hazard-700/80 hover:bg-hazard-700"
          >
            Sí, anular
          </Button>
        </div>
      </Dialog>
    </div>
    </>
  );
}

// ── Sub-componentes ────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={
        "panel rounded-sm px-4 py-3 " +
        (highlight ? "border-safety-500/50" : "")
      }
    >
      <div className="font-mono text-[9.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70 sm:text-[10px]">
        {label}
      </div>
      <div
        className={
          "mt-1 font-mono text-[18px] font-bold tabular-nums sm:text-[20px] " +
          (highlight ? "text-safety-500" : "text-foreground")
        }
      >
        {value}
      </div>
      {sub ? (
        <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground/50">
          {sub}
        </div>
      ) : null}
    </div>
  );
}

function MetaRow({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string | null;
}) {
  return (
    <div className="space-y-0.5">
      <dt className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">
        {label}
      </dt>
      <dd className="text-[14px] font-semibold text-foreground">{value}</dd>
      {sub ? (
        <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground/60">
          {sub}
        </p>
      ) : null}
    </div>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-[14px] tabular-nums text-foreground">
        {value}
      </span>
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
    <td className={"px-5 py-4 align-middle " + (className ?? "")}>{children}</td>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────

function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m15 18-6-6 6-6" />
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

function PrintIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  );
}
