"use client";

// Shown at the top of the POS when opened with exchange_return_id params.

export function ExchangeBanner({ credit }: { credit: number }) {
  const fmt = new Intl.NumberFormat("es-EC", {
    style: "currency", currency: "USD", minimumFractionDigits: 2,
  });
  return (
    <div className="flex items-center gap-3 rounded-sm border-2 border-safety-500/40 bg-safety-500/5 px-4 py-3">
      <ExchangeIcon className="h-5 w-5 shrink-0 text-safety-500" />
      <div className="flex-1 min-w-0">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-safety-500">
          Cambio de producto
        </p>
        <p className="font-mono text-[10.5px] text-muted-foreground/80">
          Crédito disponible:{" "}
          <strong className="text-safety-500">{fmt.format(credit)}</strong>
          {" "}— agrega los productos de reemplazo y el cajero calculará la diferencia.
        </p>
      </div>
    </div>
  );
}

function ExchangeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 3 4 7l4 4" />
      <path d="M4 7h16" />
      <path d="m16 21 4-4-4-4" />
      <path d="M20 17H4" />
    </svg>
  );
}
