"use client";

import * as React from "react";
import { Sheet } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type ManualItem = {
  name:         string;
  unit_price:   number;
  quantity:     number;
  has_tax:      boolean;
  average_cost: number;
};

export function ManualItemModal({
  open,
  onClose,
  onAdd,
}: {
  open:    boolean;
  onClose: () => void;
  onAdd:   (item: ManualItem) => void;
}) {
  const [name,     setName]     = React.useState("");
  const [priceStr, setPriceStr] = React.useState("");
  const [qtyStr,   setQtyStr]   = React.useState("1");
  const [costStr,  setCostStr]  = React.useState("");
  const [hasTax,   setHasTax]   = React.useState(true);

  React.useEffect(() => {
    if (open) {
      setName("");
      setPriceStr("");
      setQtyStr("1");
      setCostStr("");
      setHasTax(true);
    }
  }, [open]);

  const price = parseFloat(priceStr.replace(",", "."));
  const qty   = parseFloat(qtyStr.replace(",", "."));
  const cost  = costStr.trim() ? parseFloat(costStr.replace(",", ".")) : 0;

  const isValid =
    name.trim().length > 0 &&
    isFinite(price) && price >= 0 &&
    isFinite(qty)   && qty   >  0 &&
    isFinite(cost)  && cost  >= 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    onAdd({
      name:         name.trim(),
      unit_price:   price,
      quantity:     qty,
      has_tax:      hasTax,
      average_cost: cost,
    });
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} side="right" title="Agregar Ítem Manual" className="w-full max-w-sm">
      <div className="p-5">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="space-y-1">
            <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/80">Descripción *</label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Filtro de aire especial..."
              className="font-sans text-sm"
              required
            />
          </div>

          <div className="flex gap-3">
            <div className="space-y-1 flex-1">
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/80">Cantidad *</label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={qtyStr}
                onChange={(e) => setQtyStr(e.target.value)}
                className="font-mono text-sm"
                required
              />
            </div>
            <div className="space-y-1 flex-1">
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/80">PVP (con IVA) *</label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={priceStr}
                onChange={(e) => setPriceStr(e.target.value)}
                placeholder="0.00"
                className="font-mono text-sm"
                required
              />
            </div>
          </div>

          <div className="flex gap-3 items-end">
            <div className="space-y-1 flex-1">
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/80">Costo (Rentabilidad)</label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={costStr}
                onChange={(e) => setCostStr(e.target.value)}
                placeholder="0.00 (Opcional)"
                className="font-mono text-sm text-amber-500/80 focus:text-amber-500"
              />
            </div>
            <div className="mb-2 flex items-center gap-2 flex-1 justify-center">
              <input
                type="checkbox"
                id="manual-tax"
                checked={hasTax}
                onChange={(e) => setHasTax(e.target.checked)}
                className="h-4 w-4 rounded border-steel-700 bg-steel-900 text-safety-500 focus:ring-safety-500 focus:ring-offset-steel-950"
              />
              <label htmlFor="manual-tax" className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground cursor-pointer select-none">
                Grava IVA (15%)
              </label>
            </div>
          </div>

          <div className="mt-2 flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancelar
            </Button>
            <Button type="submit" disabled={!isValid} className="flex-1 bg-safety-500 text-steel-950 hover:bg-safety-400">
              Añadir
            </Button>
          </div>
        </form>
      </div>
    </Sheet>
  );
}
