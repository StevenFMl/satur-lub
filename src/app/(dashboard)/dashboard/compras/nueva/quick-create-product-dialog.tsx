"use client";

import * as React from "react";
import { useState, useMemo } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert } from "@/components/ui/alert";
import { FieldError } from "@/components/ui/field-error";
import {
  quickCreateProductAction,
  type QuickCreateProductState,
} from "@/actions/products";
import type { LookupProduct } from "./purchase-form";

const IVA_RATE = 15;
const IVA_MULT = 1 + IVA_RATE / 100;

/**
 * Preview del precio según modo de entrada.
 * includesIva=false → el número escrito es base → muestra "= $X.XX c/IVA"
 * includesIva=true  → el número ya lleva IVA   → muestra "sin IVA: $X.XX"
 */
function pricePreview(val: string, includesIva: boolean): string | null {
  const n = parseFloat(val.replace(",", "."));
  if (!isFinite(n) || n <= 0) return null;
  return includesIva
    ? "sin IVA: $" + (n / IVA_MULT).toFixed(2)
    : "= $" + (n * IVA_MULT).toFixed(2) + " c/IVA";
}

function toNet(val: string): string {
  const n = parseFloat(val.replace(",", "."));
  if (!isFinite(n) || n <= 0) return "";
  return (n / IVA_MULT).toFixed(2);
}

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (product: LookupProduct) => void;
  editProduct?: LookupProduct | null;
};

export function QuickCreateProductDialog({ open, onClose, onCreated, editProduct }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, string>>>({});

  // priceIncludesIva: el número que escribe el usuario ya incluye IVA.
  // Cuando true → mostramos "sin IVA: $X" y guardamos precio / 1.15.
  const [priceIncludesIva, setPriceIncludesIva] = useState(false);
  const [costPrice, setCostPrice] = useState(
    editProduct?.cost_price != null ? String(editProduct.cost_price) : ""
  );
  const [pricePublico, setPricePublico] = useState(
    editProduct?.default_price != null ? String(editProduct.default_price) : ""
  );

  const costPreview = useMemo(() => pricePreview(costPrice, priceIncludesIva), [costPrice, priceIncludesIva]);
  const publicoPreview = useMemo(() => pricePreview(pricePublico, priceIncludesIva), [pricePublico, priceIncludesIva]);

  // Valores netos que se envían al servidor
  const netCost = priceIncludesIva ? toNet(costPrice) : costPrice;
  const netPublico = priceIncludesIva ? toNet(pricePublico) : pricePublico;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});

    const formData = new FormData(e.currentTarget);
    const result: QuickCreateProductState = await quickCreateProductAction(null, formData);

    setPending(false);
    if (result?.ok && result.product) {
      if (typeof BroadcastChannel !== "undefined") {
        const ch = new BroadcastChannel("saturlub:products");
        ch.postMessage({ type: "product-updated" });
        ch.close();
      }
      onCreated(result.product);
      onClose();
    } else {
      setError(result?.error ?? null);
      setFieldErrors(result?.fieldErrors ?? {});
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editProduct ? "Editar producto" : "Nuevo producto"}
      description={
        editProduct
          ? "Modifica los datos del producto."
          : "Alta rápida desde compras. Precios adicionales en el catálogo."
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col">
        {editProduct ? <input type="hidden" name="id" value={editProduct.id} /> : null}
        {/* has_tax=true siempre. El toggle visible es el modo de entrada (bruto/neto). */}
        <input type="hidden" name="has_tax" value="on" />
        <input type="hidden" name="cost_price" value={netCost} />
        <input type="hidden" name="price_publico" value={netPublico} />

        <fieldset
          disabled={pending}
          className="m-0 min-w-0 space-y-4 border-0 px-6 py-5 disabled:opacity-95"
        >
          {/* ── Identificación ──────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="qc-name" required>Nombre</Label>
              <Input
                id="qc-name"
                name="name"
                defaultValue={editProduct?.name ?? ""}
                placeholder="Aceite 20W-50 mineral 1L"
                invalid={Boolean(fieldErrors.name)}
                autoFocus
                autoComplete="off"
              />
              <FieldError fieldId="qc-name" message={fieldErrors.name} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="qc-sku">
                SKU{" "}
                <span className="font-normal normal-case tracking-normal text-muted-foreground/70">
                  (opcional)
                </span>
              </Label>
              <Input
                id="qc-sku"
                name="sku"
                defaultValue={editProduct?.sku ?? ""}
                placeholder="Auto si vacío"
                invalid={Boolean(fieldErrors.sku)}
                autoComplete="off"
                mono
              />
              <FieldError fieldId="qc-sku" message={fieldErrors.sku} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="qc-unit">Unidad</Label>
              <select
                id="qc-unit"
                name="unit"
                defaultValue={editProduct?.unit ?? "unidad"}
                className="flex h-10 w-full rounded-sm border-2 border-steel-700 bg-steel-800 px-3 py-2 font-mono text-[13px] text-foreground outline-none transition-colors focus:border-safety-500/60 focus:ring-2 focus:ring-safety-500/20"
              >
                <option value="unidad">Unidad</option>
                <option value="galón">Galón</option>
                <option value="medio_galon">Medio Galón</option>
                <option value="cuarto">Cuarto</option>
                <option value="litro">Litro</option>
                <option value="media_caneca">Media Caneca</option>
                <option value="caneca">Caneca (5 gal)</option>
                <option value="tambor">Tambor (55 gal)</option>
                <option value="barril">Barril</option>
                <option value="caja">Caja</option>
                <option value="paquete">Paquete</option>
              </select>
            </div>
          </div>

          {/* ── Modo de entrada IVA ─────────────────────────────── */}
          <div className="flex items-center gap-3 rounded-sm border border-steel-700/50 bg-steel-900/30 px-3 py-2.5">
            <Switch
              id="qc-iva-mode"
              checked={priceIncludesIva}
              onCheckedChange={(val) => setPriceIncludesIva(val)}
            />
            <Label
              htmlFor="qc-iva-mode"
              className="cursor-pointer normal-case tracking-normal text-[13px] font-medium text-muted-foreground"
            >
              El precio ingresado ya incluye IVA ({IVA_RATE}%)
            </Label>
          </div>

          {/* ── Costo y precio público ─────────────────────────── */}
          <div className="space-y-3">
            <PriceField
              id="qc-cost"
              label="Costo unitario"
              value={costPrice}
              onChange={setCostPrice}
              preview={costPreview}
              error={fieldErrors.cost_price}
            />
            <PriceField
              id="qc-price"
              label="Precio público"
              value={pricePublico}
              onChange={setPricePublico}
              preview={publicoPreview}
              error={fieldErrors.price_publico}
              hint="Mayorista y Distribuidor se configuran desde el catálogo."
            />
          </div>

          {error && !Object.keys(fieldErrors).length ? (
            <Alert tone="error">{error}</Alert>
          ) : null}
        </fieldset>

        <div className="flex items-center justify-end gap-3 border-t-2 border-steel-700 bg-steel-900/60 px-6 py-4">
          <Button type="button" variant="outline" size="md" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button type="submit" size="md" loading={pending}>
            {editProduct ? "Guardar cambios" : "Crear producto"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ── Sub-componentes ────────────────────────────────────────────────────────

function PriceField({
  id,
  label,
  value,
  onChange,
  preview,
  error,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  preview: string | null;
  error?: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <Label htmlFor={id}>
          {label}{" "}
          <span className="font-normal normal-case tracking-normal text-muted-foreground/70">
            (opcional)
          </span>
        </Label>
        {preview ? (
          <span className="font-mono text-[12px] tabular-nums text-muted-foreground/60">
            {preview}
          </span>
        ) : null}
      </div>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          USD
        </span>
        <Input
          id={id}
          type="number"
          min="0"
          step="0.01"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="—"
          mono
          className="pl-14 text-right"
          invalid={Boolean(error)}
          onFocus={(e) => e.target.select()}
        />
      </div>
      {hint ? <p className="field-hint">{hint}</p> : null}
      {error ? <p className="text-[12px] text-red-400">{error}</p> : null}
    </div>
  );
}
