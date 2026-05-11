"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import {
  searchCustomersAction,
  type PickedCustomer,
} from "@/actions/customers";
import { CONSUMIDOR_FINAL_DOC } from "@/lib/validations/customer";

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export type { PickedCustomer };

export type CustomerPickerProps = {
  /** Called when a customer is selected */
  onSelect: (customer: PickedCustomer) => void;
  /** Currently selected customer */
  selected?: PickedCustomer | null;
  /** Called when user clicks "Crear cliente rápido" */
  onQuickCreate?: () => void;
  /** Pre-loaded customers (skips first server call) */
  preloaded?: PickedCustomer[];
  /** Auto-focus the search input */
  autoFocus?: boolean;
};

function isCF(c: PickedCustomer): boolean {
  return (
    c.document_type === "CONSUMIDOR_FINAL" &&
    c.document_number === CONSUMIDOR_FINAL_DOC
  );
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function CustomerPicker({
  onSelect,
  selected,
  onQuickCreate,
  preloaded,
  autoFocus,
}: CustomerPickerProps) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<PickedCustomer[]>(
    preloaded ?? []
  );
  const [loading, setLoading] = React.useState(false);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load initial results
  React.useEffect(() => {
    if (preloaded && preloaded.length > 0) return;
    let cancelled = false;
    setLoading(true);
    searchCustomersAction("").then((res) => {
      if (!cancelled) {
        setResults(res.data);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [preloaded]);

  // Debounced search
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      searchCustomersAction(val).then((res) => {
        setResults(res.data);
        setLoading(false);
      });
    }, 150);
  };

  // Ensure Consumidor Final is always first
  const consumidorFinal = results.find(isCF);
  const others = results.filter((c) => !isCF(c));

  return (
    <div className="flex flex-col overflow-hidden rounded-sm border-2 border-steel-700 bg-steel-950">
      {/* Search input */}
      <div className="relative border-b border-steel-700">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={handleChange}
          placeholder="Buscar cliente..."
          autoFocus={autoFocus}
          className="h-11 w-full border-0 bg-transparent pl-10 pr-4 text-[14px] font-medium text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-[2px] border-steel-500 border-t-transparent" />
          </span>
        )}
      </div>

      {/* Results */}
      <div className="max-h-[280px] overflow-y-auto">
        {/* Consumidor Final — always pinned at top */}
        {consumidorFinal && (
          <PickerRow
            customer={consumidorFinal}
            isSelected={selected?.id === consumidorFinal.id}
            onClick={() => onSelect(consumidorFinal)}
            pinned
          />
        )}

        {/* Separator */}
        {consumidorFinal && others.length > 0 && (
          <div className="border-t border-steel-800" />
        )}

        {/* Other customers */}
        {others.map((c) => (
          <PickerRow
            key={c.id}
            customer={c}
            isSelected={selected?.id === c.id}
            onClick={() => onSelect(c)}
          />
        ))}

        {/* Empty state */}
        {!loading && others.length === 0 && !consumidorFinal && (
          <div className="px-4 py-6 text-center text-[12px] text-muted-foreground">
            No se encontraron clientes.
          </div>
        )}
      </div>

      {/* Quick create button */}
      {onQuickCreate && (
        <button
          type="button"
          onClick={onQuickCreate}
          className="flex items-center gap-2 border-t border-steel-700 px-4 py-3 text-[12px] font-semibold uppercase tracking-[0.12em] text-safety-500 transition-colors hover:bg-steel-900"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          Crear cliente rápido
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Picker row                                                          */
/* ------------------------------------------------------------------ */

function PickerRow({
  customer,
  isSelected,
  onClick,
  pinned,
}: {
  customer: PickedCustomer;
  isSelected: boolean;
  onClick: () => void;
  pinned?: boolean;
}) {
  const cf = isCF(customer);
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors " +
        (isSelected
          ? "bg-safety-500/10 border-l-2 border-safety-500"
          : "border-l-2 border-transparent hover:bg-steel-900") +
        (pinned ? " bg-steel-900/50" : "")
      }
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-semibold text-foreground">
            {customer.full_name}
          </span>
          {cf && <Badge tone="warning">SRI</Badge>}
          {isSelected && <Badge tone="active">✓</Badge>}
        </div>
        {!cf && (
          <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
            {customer.phone && <span>{customer.phone}</span>}
            {customer.phone && customer.document_number !== CONSUMIDOR_FINAL_DOC && (
              <span className="text-muted-foreground/40">•</span>
            )}
            {customer.document_number !== CONSUMIDOR_FINAL_DOC && (
              <span>{customer.document_number}</span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 5v14" /><path d="M5 12h14" />
    </svg>
  );
}
