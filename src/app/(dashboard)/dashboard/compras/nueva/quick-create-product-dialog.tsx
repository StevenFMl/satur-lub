"use client";

import * as React from "react";
import { useActionState, useEffect, useRef } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
};

export function QuickCreateProductDialog({ open, onClose, onCreated }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const [state, formAction, pending] =
    useActionState<QuickCreateProductState, FormData>(
      quickCreateProductAction,
      null
    );

  // Cuando el producto se crea OK, notificar al parent y cerrar
  useEffect(() => {
    if (state?.ok && state.product) {
      onCreated(state.product);
      onClose();
    }
  }, [state, onCreated, onClose]);

  // Auto-focus al abrir
  useEffect(() => {
    if (open) {
      // Pequeño delay para que el portal monte
      const t = setTimeout(() => nameRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  const errors = state?.fieldErrors ?? {};

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Crear Producto Rápido"
      description="Registra un producto con los datos mínimos. Podrás completar la información después."
    >
      <form ref={formRef} action={formAction} className="flex flex-col">
        <fieldset
          disabled={pending}
          className="m-0 min-w-0 space-y-5 border-0 px-6 py-6 disabled:opacity-95"
        >
          <div className="space-y-2">
            <Label htmlFor="qc-name" required>
              Nombre del producto
            </Label>
            <Input
              ref={nameRef}
              id="qc-name"
              name="name"
              placeholder="Aceite 20W-50 mineral 1L"
              invalid={Boolean(errors.name)}
              autoComplete="off"
            />
            <FieldError fieldId="qc-name" message={errors.name} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="qc-unit">Unidad</Label>
              <select
                id="qc-unit"
                name="unit"
                defaultValue="unidad"
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
              <Label htmlFor="qc-cost">Costo base</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  USD
                </span>
                <Input
                  id="qc-cost"
                  name="cost_price"
                  type="number"
                  min="0"
                  step="0.0001"
                  defaultValue="0"
                  placeholder="0.00"
                  mono
                  className="pl-14 text-right"
                  invalid={Boolean(errors.cost_price)}
                  onFocus={(e) => e.target.select()}
                />
              </div>
              <FieldError fieldId="qc-cost" message={errors.cost_price} />
            </div>
          </div>

          {state?.error && !state.fieldErrors ? (
            <Alert tone="error">{state.error}</Alert>
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
            Crear producto
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
