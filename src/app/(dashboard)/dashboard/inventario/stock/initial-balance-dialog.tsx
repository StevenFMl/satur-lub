"use client";

import * as React from "react";
import { useActionState, useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { FieldError } from "@/components/ui/field-error";
import { Select } from "@/components/ui/select";
import { createInitialBalanceAction, type InitialBalanceState } from "@/actions/inventory";

type LookupProduct = { id: string; name: string; sku: string; cost_price: number | null };
type LookupWarehouse = { id: string; name: string };

type Props = {
  open: boolean;
  onClose: () => void;
  products: LookupProduct[];
  warehouses: LookupWarehouse[];
};

export function InitialBalanceDialog({ open, onClose, products, warehouses }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  
  const [state, formAction, pending] = useActionState<InitialBalanceState, FormData>(
    createInitialBalanceAction,
    null
  );

  const [productId, setProductId] = useState("");
  const [unitCost, setUnitCost] = useState("");

  useEffect(() => {
    if (state?.ok) {
      onClose();
    }
  }, [state, onClose]);

  // Si se selecciona un producto y tiene cost_price, prellenarlo.
  useEffect(() => {
    if (productId) {
      const p = products.find(x => x.id === productId);
      if (p && p.cost_price != null) {
        setUnitCost(String(p.cost_price));
      } else {
        setUnitCost("");
      }
    }
  }, [productId, products]);

  // Focus inicial
  useEffect(() => {
    if (open) {
      setProductId("");
      setUnitCost("");
    }
  }, [open]);

  const errors = state?.fieldErrors ?? {};

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Ajuste / Saldo Inicial"
      description="Registra la entrada de inventario para establecer un saldo inicial."
    >
      <form ref={formRef} action={formAction} className="flex flex-col">
        <fieldset disabled={pending} className="space-y-4 px-6 py-6 border-0 m-0">
          
          <div className="space-y-2">
            <Label htmlFor="product_id" required>Producto</Label>
            <Select
              id="product_id"
              name="product_id"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className="w-full text-[13px] h-10"
            >
              <option value="">Seleccione un producto</option>
              {products.map(p => (
                <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
              ))}
            </Select>
            <FieldError message={errors.product_id} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="warehouse_id" required>Bodega</Label>
            <Select
              id="warehouse_id"
              name="warehouse_id"
              defaultValue={warehouses.length === 1 ? warehouses[0].id : ""}
              className="w-full text-[13px] h-10"
            >
              {warehouses.length !== 1 && <option value="">Seleccione una bodega</option>}
              {warehouses.map(w => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </Select>
            <FieldError message={errors.warehouse_id} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="quantity" required>Cantidad (Entrada)</Label>
              <Input
                id="quantity"
                name="quantity"
                type="number"
                min="0.01"
                step="0.01"
                placeholder="100"
                invalid={Boolean(errors.quantity)}
                mono
              />
              <FieldError message={errors.quantity} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="unit_cost" required>Costo Unitario ($)</Label>
              <Input
                id="unit_cost"
                name="unit_cost"
                type="number"
                min="0"
                step="0.0001"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                placeholder="0.00"
                invalid={Boolean(errors.unit_cost)}
                mono
              />
              <FieldError message={errors.unit_cost} />
            </div>
          </div>

          {state?.error && !state.fieldErrors && (
            <Alert tone="error">{state.error}</Alert>
          )}

        </fieldset>
        
        <div className="flex items-center justify-end gap-3 border-t-2 border-steel-700 bg-steel-900/60 px-6 py-4">
          <Button type="button" variant="outline" size="md" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button type="submit" size="md" loading={pending}>
            Guardar Ajuste
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
