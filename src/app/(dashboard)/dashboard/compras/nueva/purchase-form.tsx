"use client";

import * as React from "react";
import { useActionState, useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { FieldError } from "@/components/ui/field-error";
import {
  receivePurchaseAction,
  type PurchaseState,
} from "@/actions/purchases";
import { QuickCreateProductDialog } from "./quick-create-product-dialog";

export type LookupSupplier = {
  id: string;
  full_name: string;
  document_number: string;
};
export type LookupProduct = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  cost_price: number | null;
};
export type LookupWarehouse = { id: string; name: string };

type PaymentMethod = "cash" | "transfer" | "credit";

type Row = {
  uid: string;
  product_id: string;
  quantity: string;
  total_cost: string;
  unit: string;
};

const newRow = (): Row => ({
  uid:
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2),
  product_id: "",
  quantity: "1",
  total_cost: "0",
  unit: "unidad",
});

const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

export function PurchaseForm({
  suppliers,
  products,
  warehouses,
}: {
  suppliers: LookupSupplier[];
  products: LookupProduct[];
  warehouses: LookupWarehouse[];
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<PurchaseState, FormData>(
    receivePurchaseAction,
    null
  );

  // UX: si el tenant tiene exactamente 1 bodega activa, la auto-seleccionamos
  // (caso típico de negocios con única ubicación). Con 0 o 2+ bodegas dejamos
  // la selección explícita al usuario para evitar errores silenciosos.
  const [warehouseId, setWarehouseId] = useState(
    warehouses.length === 1 ? warehouses[0]?.id ?? "" : ""
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [dueDate, setDueDate] = useState("");
  const [rows, setRows] = useState<Row[]>([newRow()]);

  // Productos locales: se alimenta con la prop SSR pero se extiende con
  // productos creados inline sin recargar la página.
  const [localProducts, setLocalProducts] = useState<LookupProduct[]>(products);

  // Quick-create dialog state
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [activeRowUid, setActiveRowUid] = useState<string | null>(null);

  useEffect(() => {
    if (state?.ok) router.push("/dashboard");
  }, [state, router]);

  const productById = useMemo(() => {
    const m = new Map<string, LookupProduct>();
    for (const p of localProducts) m.set(p.id, p);
    return m;
  }, [localProducts]);

  // Subtotal = suma directa de total_cost de cada fila
  const subtotal = useMemo(
    () =>
      rows.reduce((acc, r) => {
        const tc = Number(r.total_cost);
        if (!Number.isFinite(tc)) return acc;
        return acc + tc;
      }, 0),
    [rows]
  );

  // Serialización: el backend espera { product_id, quantity, unit_cost }
  // El front calcula unit_cost = total_cost / quantity
  const itemsJson = useMemo(
    () =>
      JSON.stringify(
        rows
          .filter((r) => r.product_id)
          .map((r) => {
            const q = Number(r.quantity);
            const tc = Number(r.total_cost);
            const unitCost =
              Number.isFinite(q) && Number.isFinite(tc) && q > 0
                ? tc / q
                : 0;
            return {
              product_id: r.product_id,
              quantity: q,
              unit_cost: Math.round(unitCost * 10000) / 10000,
            };
          })
      ),
    [rows]
  );

  const updateRow = (uid: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));

  const removeRow = (uid: string) =>
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((r) => r.uid !== uid)));

  const addRow = () => setRows((prev) => [...prev, newRow()]);

  const onProductChange = (uid: string, productId: string) => {
    const product = productById.get(productId);
    const row = rows.find((r) => r.uid === uid);
    const qty = row ? Number(row.quantity) : 1;
    // Pre-calcular total_cost basado en cost_price * quantity
    const costPrice = product?.cost_price ?? 0;
    const totalCost = Number.isFinite(qty) && qty > 0 ? costPrice * qty : costPrice;
    updateRow(uid, {
      product_id: productId,
      total_cost: String(totalCost),
      unit: product?.unit ?? "unidad",
    });
  };

  const openQuickCreate = useCallback((rowUid: string) => {
    setActiveRowUid(rowUid);
    setQuickCreateOpen(true);
  }, []);

  const onProductCreated = useCallback(
    (product: LookupProduct) => {
      // Agregar el producto a la lista local
      setLocalProducts((prev) => {
        // Evitar duplicados
        if (prev.some((p) => p.id === product.id)) return prev;
        return [...prev, product].sort((a, b) => a.name.localeCompare(b.name));
      });
      // Seleccionar el producto en la fila activa
      if (activeRowUid) {
        const row = rows.find((r) => r.uid === activeRowUid);
        const qty = row ? Number(row.quantity) : 1;
        const costPrice = product.cost_price ?? 0;
        const totalCost = Number.isFinite(qty) && qty > 0 ? costPrice * qty : costPrice;
        updateRow(activeRowUid, {
          product_id: product.id,
          total_cost: String(totalCost),
          unit: product.unit,
        });
      }
    },
    [activeRowUid, rows]
  );

  const errors = state?.fieldErrors ?? {};
  const noSuppliers = suppliers.length === 0;
  const noProducts = localProducts.length === 0;
  const noWarehouses = warehouses.length === 0;
  const noWarehouseSelected = !warehouseId;
  // Un ERP no permite transacciones huérfanas: si falta cualquier
  // dependencia maestra (proveedores o bodegas activas), bloqueamos
  // todo el formulario y enumeramos qué crear primero.
  // Nota: ya no bloqueamos por productos porque el usuario puede
  // crearlos inline con el botón "Crear Producto Rápido".
  const blocked = noSuppliers || noWarehouses;
  const missing: { label: string; href: string }[] = [];
  if (noSuppliers)
    missing.push({ label: "un Proveedor", href: "/dashboard/proveedores" });
  if (noProducts)
    missing.push({
      label: "un Producto",
      href: "/dashboard/inventario/productos",
    });
  if (noWarehouses)
    missing.push({
      label: "una Bodega",
      href: "/dashboard/inventario/bodegas",
    });

  return (
    <>
      <form action={formAction} className="space-y-8">
        <input type="hidden" name="items_json" value={itemsJson} />
        <input type="hidden" name="payment_method" value={paymentMethod} />
        <input
          type="hidden"
          name="payment_due_date"
          value={paymentMethod === "credit" ? dueDate : ""}
        />

        {blocked || (noProducts && localProducts.length === 0) ? (
          <Alert tone="error">
            <strong className="block font-semibold">
              No puedes registrar compras todavía.
            </strong>
            <span className="mt-1 block text-[12px] leading-5">
              Para recibir mercancía necesitas crear:
            </span>
            <ul className="mt-2 space-y-1 text-[12.5px] leading-5">
              {missing.map((m) => (
                <li key={m.href}>
                  <span className="mr-1">•</span>
                  <a href={m.href} className="underline hover:text-red-200">
                    Crear {m.label} →
                  </a>
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}

        {/* Cabecera */}
        <section className="panel rounded-sm">
          <header className="top-highlight border-b-2 border-steel-700 bg-steel-900/70 px-6 py-4">
            <h2 className="font-display text-[18px] tracking-[0.04em]">CABECERA</h2>
          </header>
          <div className="grid grid-cols-1 gap-5 px-6 py-6 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="supplier_id" required>
                Proveedor
              </Label>
              {noSuppliers ? (
                <Alert tone="warning">
                  Aún no tienes proveedores activos. Crea uno en{" "}
                  <a className="underline" href="/dashboard/proveedores">
                    Proveedores
                  </a>{" "}
                  antes de registrar una compra.
                </Alert>
              ) : (
                <Select
                  id="supplier_id"
                  name="supplier_id"
                  defaultValue=""
                  invalid={Boolean(errors.supplier_id)}
                >
                  <option value="">— Selecciona un proveedor —</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name} · {s.document_number}
                    </option>
                  ))}
                </Select>
              )}
              <FieldError fieldId="supplier_id" message={errors.supplier_id} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="warehouse_id">Bodega de recepción</Label>
              <Select
                id="warehouse_id"
                name="warehouse_id"
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                invalid={Boolean(errors.warehouse_id)}
              >
                <option value="">— Sin asignar (no actualiza stock) —</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
              <FieldError fieldId="warehouse_id" message={errors.warehouse_id} />
              {!noWarehouses && noWarehouseSelected ? (
                <p className="field-hint">
                  Selecciona una bodega para actualizar el stock al recibir.
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notas (opcional)</Label>
              <Input
                id="notes"
                name="notes"
                placeholder="Factura del proveedor, referencias, etc."
                maxLength={500}
                invalid={Boolean(errors.notes)}
              />
              <FieldError fieldId="notes" message={errors.notes} />
            </div>
          </div>
        </section>

        {/* Ítems */}
        <section className="panel rounded-sm">
          <header className="top-highlight flex items-center justify-between border-b-2 border-steel-700 bg-steel-900/70 px-6 py-4">
            <h2 className="font-display text-[18px] tracking-[0.04em]">ÍTEMS</h2>
            <Badge tone="warning">
              {rows.length} línea{rows.length === 1 ? "" : "s"}
            </Badge>
          </header>

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="border-b border-steel-800 bg-steel-950/60">
                <tr>
                  <Th>Producto</Th>
                  <Th className="w-[120px] text-right">Cantidad</Th>
                  <Th className="w-[150px] text-right">Costo Total</Th>
                  <Th className="w-[140px] text-right">Costo Unit.</Th>
                  <Th className="w-[60px]"> </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const q = Number(r.quantity);
                  const tc = Number(r.total_cost);
                  const unitCost =
                    Number.isFinite(q) &&
                    Number.isFinite(tc) &&
                    q > 0
                      ? tc / q
                      : 0;
                  return (
                    <tr key={r.uid} className="border-b border-steel-800">
                      <td className="px-4 py-3">
                        <Select
                          value={r.product_id}
                          onChange={(e) => onProductChange(r.uid, e.target.value)}
                          aria-label="Producto"
                        >
                          <option value="">— Selecciona producto —</option>
                          {localProducts.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} · {p.sku}
                            </option>
                          ))}
                        </Select>
                        <button
                          type="button"
                          onClick={() => openQuickCreate(r.uid)}
                          className="mt-1.5 inline-flex items-center gap-1 rounded-sm px-2 py-1 text-[11.5px] font-semibold uppercase tracking-[0.1em] text-safety-500 transition-colors hover:bg-safety-500/10 hover:text-safety-400"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            className="h-3 w-3"
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
                          Crear Producto Rápido
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min="0.01"
                            step="0.01"
                            mono
                            className="text-right"
                            value={r.quantity}
                            onChange={(e) =>
                              updateRow(r.uid, { quantity: e.target.value })
                            }
                            aria-label="Cantidad"
                          />
                          <span className="shrink-0 font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                            {r.unit}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          mono
                          className="text-right"
                          value={r.total_cost}
                          onChange={(e) =>
                            updateRow(r.uid, { total_cost: e.target.value })
                          }
                          aria-label="Costo total de la fila"
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-mono text-[14px] tabular-nums text-muted-foreground">
                          {moneyFmt.format(unitCost)}
                        </span>
                        <span className="block font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/60">
                          /unidad
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => removeRow(r.uid)}
                          disabled={rows.length === 1}
                          aria-label="Quitar ítem"
                          className="grid h-9 w-9 place-items-center rounded-sm border border-steel-700 bg-steel-800 text-muted-foreground transition-colors hover:border-hazard-500/60 hover:text-hazard-500 disabled:opacity-40"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            className="h-4 w-4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden
                          >
                            <path d="M3 6h18" />
                            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            <path d="M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-steel-800 bg-steel-950/40 px-6 py-4">
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={addRow}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
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
              Agregar ítem
            </Button>
            <div className="text-right">
              <p className="hud-readout !text-muted-foreground">Subtotal</p>
              <p className="font-display text-[28px] leading-none tracking-[0.02em] text-safety-500">
                {moneyFmt.format(subtotal)}
              </p>
            </div>
          </div>

          {errors.items ? (
            <div className="px-6 pb-4">
              <FieldError message={errors.items} />
            </div>
          ) : null}
        </section>

        {/* Pago */}
        <section className="panel rounded-sm">
          <header className="top-highlight border-b-2 border-steel-700 bg-steel-900/70 px-6 py-4">
            <h2 className="font-display text-[18px] tracking-[0.04em]">PAGO</h2>
          </header>
          <div className="space-y-5 px-6 py-6">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {(["cash", "transfer", "credit"] as const).map((m) => (
                <PaymentTile
                  key={m}
                  method={m}
                  selected={paymentMethod === m}
                  onSelect={() => setPaymentMethod(m)}
                />
              ))}
            </div>

            {paymentMethod === "credit" ? (
              <div className="max-w-xs space-y-2">
                <Label htmlFor="payment_due_date" required>
                  Fecha de vencimiento
                </Label>
                <Input
                  id="payment_due_date"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  invalid={Boolean(errors.payment_due_date)}
                  mono
                />
                <FieldError
                  fieldId="payment_due_date"
                  message={errors.payment_due_date}
                />
              </div>
            ) : null}
          </div>
        </section>

        {state?.error && !state.fieldErrors ? (
          <Alert tone="error">{state.error}</Alert>
        ) : null}

        <div className="flex flex-col-reverse items-stretch gap-3 border-t border-steel-700 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="industrial-label">
            Al enviar se registra la OC, los movimientos y se actualiza el stock en una transacción.
          </p>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <span className="hud-readout !text-muted-foreground">Total</span>
              <span className="block font-display text-[24px] tracking-[0.02em] text-foreground">
                {moneyFmt.format(subtotal)}
              </span>
            </div>
            <Button
              type="submit"
              size="xl"
              loading={pending}
              disabled={blocked || pending}
            >
              {pending ? "Registrando…" : "Recibir mercancía"}
            </Button>
          </div>
        </div>
      </form>

      {/* Dialog de creación rápida de producto — fuera del <form> para evitar submit conflicts */}
      <QuickCreateProductDialog
        open={quickCreateOpen}
        onClose={() => setQuickCreateOpen(false)}
        onCreated={onProductCreated}
      />
    </>
  );
}

function PaymentTile({
  method,
  selected,
  onSelect,
}: {
  method: PaymentMethod;
  selected: boolean;
  onSelect: () => void;
}) {
  const labels: Record<PaymentMethod, { title: string; sub: string }> = {
    cash: { title: "Contado", sub: "Pagado al recibir" },
    transfer: { title: "Transferencia", sub: "Pagado al recibir" },
    credit: { title: "Crédito", sub: "Por pagar" },
  };
  const l = labels[method];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={
        "flex flex-col items-start gap-1 rounded-sm border-2 px-4 py-3 text-left transition-all duration-150 " +
        (selected
          ? "border-safety-500 bg-safety-500/10 shadow-safety-glow"
          : "border-steel-700 bg-steel-950 hover:border-steel-500")
      }
    >
      <span
        className={
          "font-mono text-[12px] font-bold uppercase tracking-[0.14em] " +
          (selected ? "text-safety-500" : "text-foreground")
        }
      >
        {l.title}
      </span>
      <span className="text-[11.5px] text-muted-foreground">{l.sub}</span>
    </button>
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
        "px-4 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground " +
        (className ?? "")
      }
    >
      {children}
    </th>
  );
}
