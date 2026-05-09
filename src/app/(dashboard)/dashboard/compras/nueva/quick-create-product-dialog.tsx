"use client";

import * as React from "react";
import { useState, useEffect, useRef } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import Big from "big.js";
import { Alert } from "@/components/ui/alert";
import { FieldError } from "@/components/ui/field-error";
import {
  quickCreateProductAction,
  type QuickCreateProductState,
} from "@/actions/products";
import type { LookupProduct } from "./purchase-form";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (product: LookupProduct) => void;
  editProduct?: LookupProduct | null;
};

export function QuickCreateProductDialog({ open, onClose, onCreated, editProduct }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<any>({});

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});
    
    const formData = new FormData(e.currentTarget);
    const result = await quickCreateProductAction(null, formData);
    
    setPending(false);
    if (result?.ok && result.product) {
      onCreated(result.product);
      onClose();
    } else {
      setError(result?.error || null);
      setFieldErrors(result?.fieldErrors || {});
    }
  }

  // Auto-focus al abrir
  const [displayPrice, setDisplayPrice] = useState("");

  useEffect(() => {
    if (open) {
      if (editProduct) {
        setDisplayPrice(editProduct.cost_price != null ? String(editProduct.cost_price) : "");
      } else {
        setDisplayPrice("");
      }
      // Pequeño delay para que el portal monte
      const t = setTimeout(() => nameRef.current?.focus(), 50);
      return () => clearTimeout(t);
    } else {
      setError(null);
      setFieldErrors({});
    }
  }, [open, editProduct]);

  const errors = fieldErrors;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editProduct ? "Editar Producto" : "Crear Producto Rápido"}
      description={editProduct ? "Modifica los datos base del producto seleccionado." : "Registra un producto con los datos mínimos. Podrás completar la información después."}
    >
      <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col">
        {editProduct ? <input type="hidden" name="id" value={editProduct.id} /> : null}
        <fieldset
          disabled={pending}
          className="m-0 min-w-0 space-y-5 border-0 px-6 py-6 disabled:opacity-95"
        >
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="qc-name" required>
                Nombre del producto
              </Label>
              <Input
                ref={nameRef}
                id="qc-name"
                name="name"
                defaultValue={editProduct?.name ?? ""}
                placeholder="Aceite 20W-50 mineral 1L"
                invalid={Boolean(errors.name)}
                autoComplete="off"
              />
              <FieldError fieldId="qc-name" message={errors.name} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="qc-sku" required>
                SKU (Código)
              </Label>
              <Input
                id="qc-sku"
                name="sku"
                defaultValue={editProduct?.sku ?? ""}
                placeholder="ACE-20W50-1L"
                invalid={Boolean(errors.sku)}
                autoComplete="off"
                mono
              />
              <FieldError fieldId="qc-sku" message={errors.sku} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="qc-unit">Unidad</Label>
              <select
                id="qc-unit"
                name="unit"
                defaultValue={editProduct?.unit ?? "unidad"}
                className="flex h-12 w-full rounded-sm border-2 border-steel-700 bg-steel-950 px-3 py-2 font-mono text-[13px] text-foreground outline-none transition-colors focus:border-safety-500/60 focus:ring-2 focus:ring-safety-500/20"
              >
                <option value="unidad">Unidad</option>
                <option value="galón">Galón</option>
                <option value="medio_galon">Medio Galón</option>
                <option value="cuarto">Cuarto</option>
                <option value="litro">Litro</option>
                <option value="caneca">Caneca (5 Gal)</option>
                <option value="tambor">Tambor (55 Gal)</option>
                <option value="barril">Barril</option>
                <option value="caja">Caja</option>
                <option value="paquete">Paquete</option>
              </select>
              <FieldError fieldId="qc-unit" message={errors.unit} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="qc-cost">Costo base (Neto)</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  USD
                </span>
                <input
                  type="hidden"
                  name="cost_price"
                  value={displayPrice}
                />
                <Input
                  id="qc-cost"
                  type="number"
                  min="0"
                  step="0.0001"
                  value={displayPrice}
                  onChange={(e) => setDisplayPrice(e.target.value)}
                  placeholder="0.00"
                  mono
                  className="pl-14 text-right"
                  invalid={Boolean(errors.cost_price)}
                  onFocus={(e) => e.target.select()}
                />
              </div>
              <div className="mt-3 flex items-center gap-3">
                <Switch
                  id="qc-tax"
                  name="has_tax"
                  value="true"
                  defaultChecked={editProduct ? (editProduct as any).has_tax ?? true : true}
                />
                <Label htmlFor="qc-tax" className="text-[13px] font-medium text-muted-foreground cursor-pointer normal-case tracking-normal">
                  Este producto lleva IVA
                </Label>
              </div>
              <FieldError fieldId="qc-cost" message={errors.cost_price} />
            </div>
            

          </div>

          {error && !Object.keys(fieldErrors).length ? (
            <Alert tone="error">{error}</Alert>
          ) : null}
        </fieldset>

        <div className="flex items-center justify-end gap-3 border-t-2 border-steel-700 bg-steel-900/60 px-6 py-4">
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={onClose}
            disabled={pending}
          >
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
