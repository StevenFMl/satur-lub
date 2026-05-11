"use client";

import * as React from "react";
import { useActionState, useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Big from "big.js";
import { Search, X, PlusCircle, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { FieldError } from "@/components/ui/field-error";
import { Switch } from "@/components/ui/switch";
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
  // Caché del precio público (mantenido por trigger desde product_prices).
  default_price?: number | null;
  // Costo promedio ponderado y último costo de compra.
  average_cost?: number | null;
  last_purchase_cost?: number | null;
  has_tax: boolean;
  best_cost?: number;
  best_supplier?: string;
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
  unit: "galón", // Changed default to galón to match the requirement for new products
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

// Costo sugerido al añadir o re-derivar una fila de compra. Prioridad:
//  1. last_purchase_cost — refleja la última compra real (más cercano a hoy).
//  2. cost_price          — fallback (costo referencial editable manualmente).
//  3. null                — sin sugerencia, usuario debe ingresar el costo.
function suggestedUnitCost(p: LookupProduct): number | null {
  if (p.last_purchase_cost != null) return Number(p.last_purchase_cost);
  if (p.cost_price != null) return Number(p.cost_price);
  return null;
}

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
  const [purchaseDate, setPurchaseDate] = useState<string>(
    () => new Date().toISOString().slice(0, 10) // YYYY-MM-DD, default hoy
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [dueDate, setDueDate] = useState("");
  const [rows, setRows] = useState<Row[]>([]);

  // Omni-Buscador state
  const [searchTerm, setSearchTerm] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Track filas cuyo costo total fue editado manualmente para evitar
  // sobrescribirlas al cambiar cantidad. Es la pieza clave del cálculo
  // bidireccional: si el usuario ajusta el total (ej. para cuadrar con la
  // factura del proveedor), respetamos ese valor y derivamos el unitario.
  const manualTotalEdited = useRef(new Set<string>());

  // IVA selector (15% default Ecuador 2024+).
  const [invoiceTaxRate, setInvoiceTaxRate] = useState(15);
  const [isTaxInclusive, setIsTaxInclusive] = useState(false);
  const [otherCharges, setOtherCharges] = useState("0");

  // Productos locales: se alimenta con la prop SSR pero se extiende con
  // productos creados inline. CRÍTICO: el useEffect de abajo re-sincroniza
  // este estado cuando llega una nueva versión de `products` (post
  // router.refresh()) — sin él la pantalla quedaría con datos viejos cuando
  // el catálogo cambia desde otra ventana / al editar un producto.
  const [localProducts, setLocalProducts] = useState<LookupProduct[]>(products);

  // Convierte un costo NET de la DB al valor a mostrar según el toggle.
  // toggle=false (neto): sin conversión; toggle=true (bruto): ×(1+rate).
  const netToDisplay = useCallback(
    (net: number): number =>
      isTaxInclusive
        ? Number(
            Big(net)
              .times(Big(1).plus(Big(invoiceTaxRate).div(100)))
              .round(4, Big.roundHalfUp)
              .toString()
          )
        : net,
    [isTaxInclusive, invoiceTaxRate]
  );

  // Al cambiar el toggle convierte los totales de todas las filas para que
  // el valor efectivo guardado no cambie (solo cambia la representación).
  // OFF→ON: × (1+rate)  — el mismo neto ahora se muestra como bruto.
  // ON→OFF: ÷ (1+rate)  — el mismo bruto ahora se muestra como neto.
  const handleToggleIvaInclusive = useCallback(
    (next: boolean) => {
      const factor = next
        ? Big(1).plus(Big(invoiceTaxRate).div(100))
        : Big(1).div(Big(1).plus(Big(invoiceTaxRate).div(100)));
      setRows((prev) =>
        prev.map((r) => {
          if (r.is_gift) return r;
          const n = parseFloat(r.total_cost);
          if (!isFinite(n) || n === 0) return r;
          return { ...r, total_cost: toFixedStr(Big(n).times(factor), 2) };
        })
      );
      setIsTaxInclusive(next);
    },
    [invoiceTaxRate]
  );

  useEffect(() => {
    setLocalProducts((prev) => {
      // Conservamos extensiones locales (productos creados inline que aún
      // no estén en la prop SSR — caso muy raro porque revalidatePath ya
      // los trajo, pero defensivo).
      const incomingIds = new Set(products.map((p) => p.id));
      const localOnly = prev.filter((p) => !incomingIds.has(p.id));
      return [...products, ...localOnly].sort((a, b) =>
        a.name.localeCompare(b.name)
      );
    });
  }, [products]);

  // Cross-tab sync: cuando otra pestaña edita / crea un producto, emite
  // por BroadcastChannel; aquí escuchamos y disparamos router.refresh()
  // para que el Server Component re-fetch y la prop `products` cambie
  // (el useEffect anterior se encarga del resto).
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel("saturlub:products");
    ch.onmessage = () => router.refresh();
    return () => ch.close();
  }, [router]);

  // Quick-create dialog state
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [productToEdit, setProductToEdit] = useState<LookupProduct | null>(null);

  useEffect(() => {
    if (state?.ok) router.push("/dashboard");
  }, [state, router]);

  const productById = useMemo(() => {
    const m = new Map<string, LookupProduct>();
    for (const p of localProducts) m.set(p.id, p);
    return m;
  }, [localProducts]);

  const searchResults = useMemo(() => {
    if (!searchTerm.trim()) return [];
    const term = searchTerm.toLowerCase();
    return localProducts.filter(
      p => p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term)
    ).slice(0, 5); // Limit to 5 results for speed
  }, [searchTerm, localProducts]);
  
  const exactSkuMatch = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return localProducts.find(p => p.sku.toLowerCase() === term);
  }, [searchTerm, localProducts]);

  const addToCart = useCallback((product: LookupProduct) => {
    setRows((prev) => {
      const existingIndex = prev.findIndex(r => r.product_id === product.id && !r.is_gift);
      const suggestedNet = suggestedUnitCost(product);
      // Convierte el costo sugerido (siempre NET en DB) al valor de display
      // según el toggle actual (bruto si isTaxInclusive=true, neto si false).
      const displayCost = suggestedNet != null ? netToDisplay(suggestedNet) : null;

      if (existingIndex >= 0) {
        const newRows = [...prev];
        const row = newRows[existingIndex] as Row;
        const newQtyNum = Number(row.quantity) + 1;
        const newQtyStr = String(newQtyNum);

        let newTotal = row.total_cost;
        if (!manualTotalEdited.current.has(row.uid) && displayCost != null) {
          newTotal = toFixedStr(lineTotal(newQtyStr, displayCost), 2);
        }

        newRows[existingIndex] = { ...row, quantity: newQtyStr, total_cost: newTotal };
        return newRows;
      } else {
        const totalCostStr =
          displayCost != null ? toFixedStr(lineTotal("1", displayCost), 2) : "0";
        return [
          ...prev,
          {
            uid: crypto.randomUUID(),
            product_id: product.id,
            quantity: "1",
            total_cost: totalCostStr,
            unit: product.unit,
            is_gift: false,
          },
        ];
      }
    });

    setSearchTerm("");
    setIsDropdownOpen(false);
    setTimeout(() => { searchInputRef.current?.focus(); }, 0);
  }, [netToDisplay]);

  // Re-derivación reactiva del costo de filas NO-manuales cuando cambia el
  // catálogo (precio nuevo desde otra ventana, edición inline, etc.). Este
  // es el corazón del fix al bug "edito precio y la fila no se actualiza":
  // antes el `total_cost` se copiaba al insertar y nunca volvía a recalcular.
  // Ahora, cualquier cambio en localProducts dispara un recálculo de las
  // filas que no han sido tocadas manualmente.
  useEffect(() => {
    setRows((prev) => {
      let changed = false;
      const next = prev.map((r) => {
        if (r.is_gift) return r;
        if (manualTotalEdited.current.has(r.uid)) return r;
        const product = productById.get(r.product_id);
        if (!product) return r;
        const suggestedNet = suggestedUnitCost(product);
        if (suggestedNet == null) return r;
        const displayCost = netToDisplay(suggestedNet);
        const newTotal = toFixedStr(lineTotal(r.quantity || "0", displayCost), 2);
        if (newTotal === r.total_cost) return r;
        changed = true;
        return { ...r, total_cost: newTotal };
      });
      return changed ? next : prev;
    });
  }, [productById, netToDisplay]);

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!searchTerm.trim()) return;
      
      if (exactSkuMatch) {
        addToCart(exactSkuMatch);
      } else if (searchResults.length === 1) {
        addToCart(searchResults[0] as LookupProduct);
      }
    } else if (e.key === "Escape") {
      setIsDropdownOpen(false);
    }
  };

  // Cálculo de Subtotal y Tax basado en isTaxInclusive
  const subtotalBig = useMemo(() => {
    let subtotal = Big(0);
    const taxRateBig = Big(invoiceTaxRate).div(100);
    for (const r of rows) {
      if (r.is_gift) continue;
      const product = productById.get(r.product_id);
      const isTaxable = product?.has_tax ?? true;
      const totalRow = Big(r.total_cost || 0);
      
      if (isTaxInclusive && isTaxable && invoiceTaxRate > 0) {
        subtotal = subtotal.plus(totalRow.div(Big(1).plus(taxRateBig)));
      } else {
        subtotal = subtotal.plus(totalRow);
      }
    }
    return toMoney(subtotal);
  }, [rows, productById, isTaxInclusive, invoiceTaxRate]);

  const taxBig = useMemo(() => {
    let totalTax = Big(0);
    const taxRateBig = Big(invoiceTaxRate).div(100);
    for (const r of rows) {
      if (r.is_gift) continue;
      const product = productById.get(r.product_id);
      if (!product) continue;
      const isTaxable = product.has_tax ?? true;
      
      if (isTaxable && invoiceTaxRate > 0) {
        const totalRow = Big(r.total_cost || 0);
        if (isTaxInclusive) {
          const base = totalRow.div(Big(1).plus(taxRateBig));
          totalTax = totalTax.plus(totalRow.minus(base));
        } else {
          totalTax = totalTax.plus(totalRow.times(taxRateBig));
        }
      }
    }
    return toMoney(totalTax);
  }, [rows, productById, invoiceTaxRate, isTaxInclusive]);

  const otherBig = useMemo(() => toMoney(otherCharges || "0"), [otherCharges]);
  const grandBig = useMemo(() => add(grandTotal(subtotalBig, taxBig), otherBig), [subtotalBig, taxBig, otherBig]);

  const itemsJson = useMemo(() => {
    return JSON.stringify(
      rows
        .filter((r) => r.product_id)
        .map((r) => {
          const qtyNum = Number(r.quantity) || 0;
          const totalBig = Big(r.total_cost || 0);
          // Send raw unit_cost (Gross or Net based on user input).
          // Server Action will extract tax using authoritative DB has_tax flag.
          const rawUnitCostBig = qtyNum > 0 ? totalBig.div(qtyNum) : Big(0);

          return {
            product_id: r.product_id,
            quantity: qtyNum,
            unit_cost: Number(toFixedStr(rawUnitCostBig, 4)),
          };
        })
    );
  }, [rows]);

  const updateRow = (uid: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));

  const removeRow = (uid: string) =>
    setRows((prev) => prev.filter((r) => r.uid !== uid));

  const onProductCreated = useCallback(
    (product: LookupProduct) => {
      setLocalProducts((prev) => {
        const exists = prev.find((p) => p.id === product.id);
        if (exists) {
          return prev.map((p) => (p.id === product.id ? product : p));
        }
        return [...prev, product].sort((a, b) => a.name.localeCompare(b.name));
      });
      if (!productToEdit) {
        addToCart(product);
      }
    },
    [addToCart, productToEdit]
  );

  // Cálculo A: usuario cambia cantidad → si NO ha tocado el total manualmente,
  // recalculamos total = qty × suggested(unit_cost). Si ya lo tocó, conservamos
  // el total y el costo unitario derivado se recalcula automáticamente al
  // renderizar.
  const onQuantityChange = (uid: string, qStr: string) => {
    updateRow(uid, { quantity: qStr });
    const row = rows.find((r) => r.uid === uid);
    if (!row) return;
    if (row.is_gift) return;
    const product = productById.get(row.product_id);
    if (!product) return;
    const suggestedNet = suggestedUnitCost(product);
    if (suggestedNet == null) return;
    if (manualTotalEdited.current.has(uid)) return;
    const displayCost = netToDisplay(suggestedNet);
    const tc = toFixedStr(lineTotal(qStr, displayCost), 2);
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
          const suggested = product ? suggestedUnitCost(product) : null;
          const tc =
            suggested != null
              ? toFixedStr(lineTotal(r.quantity, suggested), 2)
              : "0";
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
        <input type="hidden" name="purchase_date" value={purchaseDate} />
        <input type="hidden" name="payment_method" value={paymentMethod} />
        <input type="hidden" name="payment_due_date" value={paymentMethod === "credit" ? dueDate : ""} />
        <input type="hidden" name="subtotal" value={toFixedStr(subtotalBig, 2)} />
        <input type="hidden" name="tax_rate" value={invoiceTaxRate} />
        <input type="hidden" name="is_tax_inclusive" value={isTaxInclusive ? "on" : "off"} />
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
          <header className="top-highlight flex items-center justify-between border-b-2 border-steel-700 bg-steel-900/70 px-6 py-4">
            <h2 className="font-display text-[18px] tracking-[0.04em]">CABECERA</h2>
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-3">
                <Switch
                  id="is_tax_inclusive"
                  checked={isTaxInclusive}
                  onCheckedChange={handleToggleIvaInclusive}
                />
                <Label htmlFor="is_tax_inclusive" className="text-[13px] font-medium text-muted-foreground cursor-pointer normal-case tracking-normal">
                  Los montos de la factura ya incluyen IVA
                </Label>
              </div>
              <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/50">
                {isTaxInclusive
                  ? "Ingresando montos brutos (con IVA). El sistema extrae el neto para el kardex."
                  : "Ingresando montos netos (sin IVA). El IVA se calcula aparte en el resumen."}
              </p>
            </div>
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
              <Label htmlFor="purchase_date">Fecha de compra</Label>
              <Input
                id="purchase_date"
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                mono
                invalid={Boolean(errors.purchase_date)}
              />
              <FieldError fieldId="purchase_date" message={errors.purchase_date} />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="notes">Notas (opcional)</Label>
              <Input
                id="notes"
                name="notes"
                placeholder="N.° de factura del proveedor, referencias, etc."
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

          <div className="relative border-b border-steel-700 bg-steel-900/40 p-4">
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <Search className="h-5 w-5 text-muted-foreground" />
                </div>
                <Input
                  ref={searchInputRef}
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setIsDropdownOpen(e.target.value.trim().length > 0);
                  }}
                  onFocus={() => setIsDropdownOpen(searchTerm.trim().length > 0)}
                  onBlur={() => setTimeout(() => setIsDropdownOpen(false), 200)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Buscar por nombre o escanear código (SKU)..."
                  className="h-12 pl-10 text-[15px] shadow-inner"
                />
                {searchTerm && (
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setSearchTerm("");
                      searchInputRef.current?.focus();
                    }}
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}

                {/* Dropdown Omni-Buscador */}
                {isDropdownOpen && searchTerm.trim().length > 0 && searchResults.length > 0 && (
                  <div className="absolute left-0 right-0 top-[100%] mt-1 z-50 overflow-hidden rounded-md border border-steel-600 bg-steel-800 shadow-xl">
                    <ul className="max-h-[300px] overflow-y-auto py-1">
                      {searchResults.map((p) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            className="flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors hover:bg-steel-700 focus:bg-steel-700"
                            onClick={() => addToCart(p)}
                          >
                            <div className="flex flex-col">
                              <span className="font-semibold text-foreground">{p.name}</span>
                              <span className="font-mono text-[11px] text-muted-foreground">{p.sku}</span>
                            </div>
                            <Badge tone="neutral">Enter</Badge>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="w-[20%] shrink-0 min-w-[200px]">
                <Button
                  type="button"
                  className="h-12 w-full text-[14px]"
                  onClick={() => {
                    setProductToEdit(null);
                    setQuickCreateOpen(true);
                  }}
                >
                  <PlusCircle className="mr-2 h-5 w-5" />
                  Crear Producto
                </Button>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="border-b border-steel-800 bg-steel-950/60">
                <tr>
                  <Th>Producto</Th>
                  <Th className="w-[220px]">Cantidad / Unidad</Th>
                  <Th className="w-[160px] text-right">
                    Costo Unit. {isTaxInclusive ? "(bruto)" : "(neto)"}
                  </Th>
                  <Th className="w-[200px] text-right">
                    Costo Total {isTaxInclusive ? "(bruto)" : "(neto)"}
                  </Th>
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
                        <div className="flex flex-col items-start gap-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold leading-tight text-foreground">
                              {productById.get(r.product_id)?.name || "Desconocido"}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                const p = productById.get(r.product_id);
                                if (p) {
                                  setProductToEdit(p);
                                  setQuickCreateOpen(true);
                                }
                              }}
                              className="grid h-6 w-6 place-items-center rounded-sm text-muted-foreground hover:bg-steel-800 hover:text-foreground transition-colors"
                              title="Editar producto"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          
                          <Badge tone="neutral" className="text-[10px] mt-0.5">
                            {productById.get(r.product_id)?.sku || "-"}
                          </Badge>
                          
                          {(() => {
                            const product = productById.get(r.product_id);
                            if (!product || product.best_cost == null) return null;
                            const currentUnitCostBig = unitCostFromTotal(r.total_cost, r.quantity);
                            // unitCostBig is big.js instance
                            const isHigher = currentUnitCostBig.gt(product.best_cost);
                            return (
                              <div className={`mt-1.5 text-[10px] ${isHigher ? "text-red-500 font-semibold" : "text-muted-foreground"}`}>
                                Mejor histórico: ${product.best_cost.toFixed(2)}
                              </div>
                            );
                          })()}
                        </div>
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
                          {isTaxInclusive ? "bruto" : "neto"}/{r.unit}
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

          <div className="flex items-center justify-end border-t border-steel-800 bg-steel-950/40 px-6 py-4">
            <p className="industrial-label hidden sm:block text-right">
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
                  <div className="flex items-center">
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      value={invoiceTaxRate}
                      onChange={(e) => setInvoiceTaxRate(Number(e.target.value) || 0)}
                      className="h-8 w-16 text-right text-[13px] px-2 font-mono"
                      mono
                    />
                    <span className="ml-1 text-[13px] text-muted-foreground font-mono">%</span>
                  </div>
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

      {/* Dialog de creación rápida / edición de producto */}
      <QuickCreateProductDialog
        open={quickCreateOpen}
        onClose={() => {
          setQuickCreateOpen(false);
          setProductToEdit(null);
        }}
        onCreated={onProductCreated}
        editProduct={productToEdit}
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
