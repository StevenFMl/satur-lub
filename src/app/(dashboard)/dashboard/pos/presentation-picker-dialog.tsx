"use client";

// Opens when the user taps a product card that has presentations configured.
// Lives OUTSIDE the product <button>, so there are no nested interactive elements.

import { Dialog } from "@/components/ui/dialog";
import {
  stockForPresentation,
  type CartLine,
  type PosProduct,
  type PosPresentation,
} from "@/lib/domain/pos-math";

const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency", currency: "USD", minimumFractionDigits: 2,
});

const numFmtPres = new Intl.NumberFormat("es-EC", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 4,
});

export function PresentationPickerDialog({
  product,
  warehouseId,
  cart,
  onPick,
  onClose,
}: {
  product:     PosProduct;
  warehouseId: string | null;
  cart:        CartLine[];
  onPick:      (product: PosProduct, pres: PosPresentation) => void;
  onClose:     () => void;
}) {
  return (
    <Dialog
      open
      onClose={onClose}
      title={product.name}
      description={`SKU ${product.sku} · Selecciona la presentación a vender`}
      className="max-w-[460px]"
    >
      <div className="space-y-2 px-6 pb-6 pt-4">
        {product.presentations.map((pres) => {
          const presStock   = stockForPresentation(product.stock, pres.base_qty);
          const presNoStock = warehouseId != null && product.track_inventory && presStock <= 0;
          const presPrice   = pres.unit_price ?? product.price;
          const inCart      = cart.find(
            (l) => l.product_id === product.id && l.presentation_id === pres.id
          );

          return (
            <button
              key={pres.id}
              type="button"
              disabled={presNoStock}
              onClick={() => { onPick(product, pres); onClose(); }}
              className={[
                "flex w-full items-center justify-between rounded-sm border-2 px-5 py-4 text-left transition-all active:scale-[0.99]",
                presNoStock
                  ? "cursor-not-allowed border-steel-800 opacity-40"
                  : inCart
                    ? "border-safety-500 bg-safety-500/8"
                    : "border-steel-700 bg-steel-800/40 hover:border-safety-500/60 hover:bg-safety-500/5",
              ].join(" ")}
            >
              {/* Left: label + equivalence */}
              <div className="min-w-0">
                <p className={[
                  "text-[17px] font-bold leading-tight",
                  inCart ? "text-safety-400" : "text-foreground",
                ].join(" ")}>
                  {pres.unit_label}
                  {pres.is_default ? (
                    <span className="ml-2 font-mono text-[9px] font-normal uppercase tracking-[0.1em] text-muted-foreground/40">
                      predeterminada
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/50">
                  = {numFmtPres.format(pres.base_qty)} {product.unit} del inventario
                </p>
                {inCart ? (
                  <p className="mt-0.5 font-mono text-[9.5px] text-safety-500/70">
                    {inCart.quantity} en carrito → toca para sumar 1 más
                  </p>
                ) : null}
              </div>

              {/* Right: stock + price */}
              <div className="flex shrink-0 items-center gap-5 pl-4">
                {product.track_inventory ? (
                  <div className="text-right">
                    <p className={[
                      "font-mono text-[15px] font-bold tabular-nums",
                      presNoStock   ? "text-red-400"
                      : presStock <= 3 ? "text-signal-400"
                      : "text-muted-foreground/60",
                    ].join(" ")}>
                      {presNoStock ? "0" : presStock}
                    </p>
                    <p className="font-mono text-[8.5px] text-muted-foreground/35">disp.</p>
                  </div>
                ) : null}
                <div className="text-right">
                  <p className={[
                    "font-display text-[22px] leading-none tabular-nums",
                    inCart ? "text-safety-400" : "text-safety-500",
                  ].join(" ")}>
                    {moneyFmt.format(presPrice)}
                  </p>
                  <p className="mt-0.5 font-mono text-[8.5px] text-muted-foreground/35">
                    precio sugerido
                  </p>
                </div>
              </div>
            </button>
          );
        })}

        <button
          type="button"
          onClick={onClose}
          className="mt-1 w-full rounded-sm border border-steel-700/60 py-2.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/50 transition-colors hover:border-steel-600 hover:text-muted-foreground/80"
        >
          Cancelar
        </button>
      </div>
    </Dialog>
  );
}
