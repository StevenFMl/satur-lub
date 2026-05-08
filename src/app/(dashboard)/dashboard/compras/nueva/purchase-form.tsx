"use client";

import * as React from "react";
import { useActionState, useEffect, useMemo, useState, useCallback, useRef } from "react";
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
import {
  lineTotal,
  unitCostFromTotal,
  sumAll,
  taxAmount,
  grandTotal,
  toFixedStr,
  toNum,
  toMoney,
  toUnitPrice,
  add,
} from "@/lib/math";
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
  is_gift?: boolean;
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
  is_gift: false,
});

// Totales (subtotal, IVA, total factura): 2 decimales fijos.
const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// Costos unitarios: hasta 4 decimales (tolera fracciones de centavo).
// minimumFractionDigits=4 mantiene la alineación visual columna a columna.
const unitCostFmt = new Intl.NumberFormat("es-EC", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
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

  // Track filas cuyo costo total fue editado manualmente para evitar
  // sobrescribirlas al cambiar cantidad. Es la pieza clave del cálculo
  // bidireccional: si el usuario ajusta el total (ej. para cuadrar con la
  // factura del proveedor), respetamos ese valor y derivamos el unitario.
  const manualTotalEdited = useRef(new Set<string>());

  // IVA selector (15% default Ecuador 2024+).
  const [taxRate, setTaxRate] = useState<number>(15);
  const [otherCharges, setOtherCharges] = useState("0");

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

  // Subtotal = suma segura de total_cost (big.js)
  const subtotalBig = useMemo(() => sumAll(rows.map((r) => r.total_cost)), [rows]);
  const taxBig = useMemo(() => taxAmount(subtotalBig, taxRate), [subtotalBig, taxRate]);
  const otherBig = useMemo(() => toMoney(otherCharges || "0"), [otherCharges]);
  const grandBig = useMemo(() => add(grandTotal(subtotalBig, taxBig), otherBig), [subtotalBig, taxBig, otherBig]);

  // Serialización: el backend espera { product_id, quantity, unit_cost }
  // unit_cost se calcula con precisión y redondeo a 4 decimales.
  const itemsJson = useMemo(() => {
    return JSON.stringify(
      rows
        .filter((r) => r.product_id)
        .map((r) => {
          const unitCostBig = unitCostFromTotal(r.total_cost, r.quantity);
          return {
            product_id: r.product_id,
            quantity: Number(r.quantity) || 0,
            unit_cost: Number(toFixedStr(unitCostBig, 4)),
          };
        })
    );
  }, [rows]);

  const updateRow = (uid: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));

  const removeRow = (uid: string) =>
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((r) => r.uid !== uid)));

  const addRow = () => setRows((prev) => [...prev, newRow()]);

  const onProductChange = (uid: string, productId: string) => {
    const product = productById.get(productId);
    const row = rows.find((r) => r.uid === uid);
    const qty = row ? row.quantity : "1";
    const costPrice = product?.cost_price ?? null;
    // Al seleccionar producto (o crearlo), reseteamos la marca de edición manual
    manualTotalEdited.current.delete(uid);
    const totalCostStr = costPrice != null ? toFixedStr(lineTotal(qty, costPrice), 2) : "0";
    updateRow(uid, {
      product_id: productId,
      total_cost: totalCostStr,
      unit: product?.unit ?? "unidad",
      is_gift: false,
    });
  };

  const openQuickCreate = useCallback((rowUid: string) => {
    setActiveRowUid(rowUid);
    setQuickCreateOpen(true);
  }, []);

  const onProductCreated = useCallback(
    (product: LookupProduct) => {
      setLocalProducts((prev) => {
        if (prev.some((p) => p.id === product.id)) return prev;
        return [...prev, product].sort((a, b) => a.name.localeCompare(b.name));
      });
      if (activeRowUid) {
        const row = rows.find((r) => r.uid === activeRowUid);
        const qty = row ? row.quantity : "1";
        const costPrice = product.cost_price ?? null;
        manualTotalEdited.current.delete(activeRowUid);
        const totalCostStr = costPrice != null ? toFixedStr(lineTotal(qty, costPrice), 2) : "0";
        updateRow(activeRowUid, {
          product_id: product.id,
          total_cost: totalCostStr,
          unit: product.unit,
          is_gift: false,
        });
      }
    },
    [activeRowUid, rows]
  );

  // Cálculo A: usuario cambia cantidad → si NO ha tocado el total manualmente,
  // recalculamos total = qty × precio_base. Si ya lo tocó, conservamos el total
  // y el costo unitario derivado se recalcula automáticamente al renderizar.
  const onQuantityChange = (uid: string, qStr: string) => {
    updateRow(uid, { quantity: qStr });
    const row = rows.find((r) => r.uid === uid);
    if (!row) return;
    if (row.is_gift) return; // Mantiene el costo total en 0.00
    const product = productById.get(row.product_id);
    if (!product || product.cost_price == null) return;
    if (manualTotalEdited.current.has(uid)) return;
    const tc = toFixedStr(lineTotal(qStr, product.cost_price), 2);
    updateRow(uid, { total_cost: tc });
  };

  const onTotalCostChange = (uid: string, value: string) => {
    const row = rows.find((r) => r.uid === uid);
    if (row?.is_gift) return;
    manualTotalEdited.current.add(uid);
    updateRow(uid, { total_cost: value });
  };

  const toggleGift = (uid: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.uid !== uid) return r;
        if (r.is_gift) {
          const product = productById.get(r.product_id);
          const costPrice = product?.cost_price ?? null;
          const tc = costPrice != null ? toFixedStr(lineTotal(r.quantity, costPrice), 2) : "0";
          return { ...r, is_gift: false, total_cost: tc };
        } else {
          return { ...r, is_gift: true, total_cost: "0.00" };
        }
      })
    );
    manualTotalEdited.current.delete(uid);
  };

  const errors = state?.fieldErrors ?? {};
  const noSuppliers = suppliers.length === 0;
  const noProducts = localProducts.length === 0;
  const noWarehouses = warehouses.length === 0;
  const noWarehouseSelected = !warehouseId;
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
      href: "/dashboard/inventario/infraestructura",
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
        <input type="hidden" name="tax_rate" value={String(taxRate)} />
        <input type="hidden" name="subtotal" value={toFixedStr(subtotalBig, 2)} />
        <input type="hidden" name="tax_amount" value={toFixedStr(taxBig, 2)} />
        <input type="hidden" name="other_charges" value={toFixedStr(otherBig, 2)} />
        <input type="hidden" name="grand_total" value={toFixedStr(grandBig, 2)} />

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
                  <Th className="w-[220px]">Cantidad / Unidad</Th>
                  <Th className="w-[160px] text-right">Costo Unitario</Th>
                  <Th className="w-[200px] text-right">Costo Total</Th>
                  <Th className="w-[60px]"> </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  // Costo unitario derivado: 4 decimales. Es READ-ONLY en la
                  // UI — la fuente de verdad editable es total_cost.
                  const unitCostBig = unitCostFromTotal(r.total_cost, r.quantity);
                  const isManual = manualTotalEdited.current.has(r.uid);
                  return (
                    <tr key={r.uid} className="border-b border-steel-800">
                      <td className="px-4 py-3 align-top">
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
                      <td className="px-4 py-3 align-top">
                        <div className="flex items-center gap-2">
                          <Input
                            type="text"
                            inputMode="decimal"
                            mono
                            className="w-[80px] shrink-0 text-right"
                            value={r.quantity}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => onQuantityChange(r.uid, e.target.value)}
                            aria-label="Cantidad"
                          />
                          <Select
                            value={r.unit}
                            onChange={(e) =>
                              updateRow(r.uid, { unit: e.target.value })
                            }
                            aria-label="Unidad de medida"
                            className="min-w-[100px] text-[11px]"
                          >
                            <option value="unidad">Unidad</option>
                            <option value="galón">Galón</option>
                            <option value="medio_galon">Medio Galón</option>
                            <option value="cuarto">Cuarto</option>
                            <option value="litro">Litro</option>
                            <option value="media_caneca">Media Caneca</option>
                            <option value="caneca">Caneca</option>
                            <option value="tambor">Tambor</option>
                            <option value="barril">Barril</option>
                            <option value="caja">Caja</option>
                            <option value="paquete">Paquete</option>
                          </Select>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top text-right">
                        <span className="block font-mono text-[14px] tabular-nums text-foreground">
                          {unitCostFmt.format(toNum(toUnitPrice(unitCostBig)))}
                        </span>
                        <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/70">
                          /{r.unit}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex items-start gap-2">
                          <button
                            type="button"
                            onClick={() => toggleGift(r.uid)}
                            title={r.is_gift ? "Quitar bonificación" : "Marcar como bonificación"}
                            className={`mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-sm border transition-colors ${
                              r.is_gift 
                                ? "border-emerald-500 bg-emerald-500/10 text-emerald-400" 
                                : "border-steel-700 bg-steel-900 text-muted-foreground hover:border-emerald-500/50 hover:text-emerald-400"
                            }`}
                          >
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 12 20 22 4 22 4 12" />
                              <rect x="2" y="7" width="20" height="5" />
                              <line x1="12" y1="22" x2="12" y2="7" />
                              <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
                              <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
                            </svg>
                          </button>
                          <div className="w-full">
                            <Input
                              type="text"
                              inputMode="decimal"
                              mono
                              className="text-right"
                              value={r.total_cost}
                              disabled={r.is_gift}
                              onFocus={(e) => e.target.select()}
                              onChange={(e) => onTotalCostChange(r.uid, e.target.value)}
                              aria-label="Costo total de la fila"
                            />
                            {isManual ? (
                              <span className="mt-1 block text-right font-mono text-[10px] uppercase tracking-[0.1em] text-safety-500/80">
                                ajuste manual
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top text-right">
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
            <p className="industrial-label hidden sm:block">
              Edita el costo total para cuadrar con la factura del proveedor.
            </p>
          </div>

          {errors.items ? (
            <div className="px-6 pb-4">
              <FieldError message={errors.items} />
            </div>
          ) : null}
        </section>

        {/* Resumen de factura — Card dedicada con jerarquía clara */}
        <section className="panel rounded-sm">
          <header className="top-highlight border-b-2 border-steel-700 bg-steel-900/70 px-6 py-4">
            <h2 className="font-display text-[18px] tracking-[0.04em]">
              RESUMEN DE FACTURA
            </h2>
          </header>
          <div className="px-6 py-6">
            <div className="ml-auto w-full max-w-md space-y-3">
              <SummaryRow
                label="Subtotal"
                value={moneyFmt.format(toNum(toMoney(subtotalBig)))}
              />

              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    IVA
                  </span>
                  <Select
                    value={String(taxRate)}
                    onChange={(e) => setTaxRate(Number(e.target.value))}
                    aria-label="Tasa de IVA"
                    className="h-9 min-w-[90px] text-[13px]"
                  >
                    <option value="15">15%</option>
                    <option value="12">12%</option>
                    <option value="0">0%</option>
                  </Select>
                </div>
                <span className="font-mono text-[15px] tabular-nums text-foreground">
                  {moneyFmt.format(toNum(toMoney(taxBig)))}
                </span>
              </div>

              <div className="my-2 h-px bg-steel-700" />
              
              <div className="flex items-center justify-between gap-4">
                <span className="font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Otros Cargos (Ecovalor, Fletes)
                </span>
                <Input
                  type="text"
                  inputMode="decimal"
                  mono
                  className="h-9 w-[120px] text-right text-[15px]"
                  value={otherCharges}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setOtherCharges(e.target.value)}
                />
              </div>

              <div className="my-2 h-px bg-steel-700" />

              <div className="flex items-baseline justify-between gap-4 pt-1">
                <span className="font-mono text-[13px] font-bold uppercase tracking-[0.16em] text-foreground">
                  Total Factura
                </span>
                <span className="font-display text-[32px] leading-none tracking-[0.02em] text-safety-500">
                  {moneyFmt.format(toNum(toMoney(grandBig)))}
                </span>
              </div>
            </div>
          </div>
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
          <Button
            type="submit"
            size="xl"
            loading={pending}
            disabled={blocked || pending}
          >
            {pending ? "Registrando…" : "Recibir mercancía"}
          </Button>
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

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-[15px] tabular-nums text-foreground">
        {value}
      </span>
    </div>
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
