"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sheet } from "@/components/ui/sheet";
import { DropdownMenu, DropdownItem } from "@/components/ui/dropdown-menu";
import {
  toggleProductActiveAction,
  bulkImportProductsAction,
  duplicateProductAction,
} from "@/actions/products";
import { ProductForm } from "./product-form";
import Big from "big.js";

export type ProductRow = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  cost_price: number | null;
  default_price: number | null;
  average_cost: number;
  last_purchase_cost: number | null;
  price_mayorista: number | null;
  price_distribuidor: number | null;
  product_kind: "item" | "service" | "kit";
  tax_rate: number | null;
  has_tax: boolean;
  is_active: boolean;
  created_at: string;
};

const PAGE_SIZE = 25;

const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

type StatusFilter = "all" | "active" | "inactive";
type PriceFilter = "all" | "with" | "without";

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = React.useState<T>(value);
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export function ProductsTable({
  initialRows,
  canManage,
}: {
  initialRows: ProductRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const debouncedQuery = useDebounce(query, 200);
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("active");
  const [priceFilter, setPriceFilter] = React.useState<PriceFilter>("all");
  const [page, setPage] = React.useState(1);

  const [editing, setEditing] = React.useState<ProductRow | null>(null);
  const [open, setOpen] = React.useState(false);
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [sessionKey, setSessionKey] = React.useState(0);
  const [isImporting, setIsImporting] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => { setPage(1); }, [debouncedQuery, statusFilter, priceFilter]);

  const filtered = React.useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    return initialRows.filter((r) => {
      if (statusFilter === "active" && !r.is_active) return false;
      if (statusFilter === "inactive" && r.is_active) return false;
      if (priceFilter === "with" && r.default_price == null) return false;
      if (priceFilter === "without" && r.default_price != null) return false;
      if (q) {
        return (
          r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [initialRows, debouncedQuery, statusFilter, priceFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  );
  const rangeStart = filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(safePage * PAGE_SIZE, filtered.length);

  const handleImportClick = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
      if (lines.length < 2) throw new Error("CSV vacío o sin datos");

      const parseLine = (line: string) => {
        const result = [];
        let cur = "";
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const c = line[i];
          if (c === '"') { inQuotes = !inQuotes; }
          else if (c === "," && !inQuotes) { result.push(cur.trim()); cur = ""; }
          else { cur += c; }
        }
        result.push(cur.trim());
        return result.map((s) => s.replace(/^"|"$/g, "").trim());
      };

      const headers = parseLine(lines[0] ?? "").map((h) => h.toLowerCase());
      const idxName = headers.indexOf("name");
      const idxCode = headers.indexOf("code");
      const idxUnit = headers.indexOf("unit");
      const idxCost = headers.indexOf("cost_price");
      const idxTax = headers.indexOf("has_tax");
      if (idxName === -1) throw new Error("Falta la columna 'name'");

      const itemsToImport: Array<{ name: string; sku: string; unit: string; cost_price: number }> = [];
      for (let i = 1; i < lines.length; i++) {
        const row = parseLine(lines[i] ?? "");
        if (row.length < headers.length && row.join("") === "") continue;
        const name = row[idxName] || "";
        if (!name) continue;
        const sku = idxCode !== -1 ? (row[idxCode] ?? "") : "";
        const unit = idxUnit !== -1 ? (row[idxUnit] ?? "unidad") : "unidad";
        const rawCost = idxCost !== -1 && row[idxCost] ? row[idxCost] : "0";
        const hasTax = idxTax !== -1 ? row[idxTax] === "true" || row[idxTax] === "1" : false;
        let finalCost = 0;
        try {
          let c = new Big(rawCost || "0");
          if (hasTax) c = c.div(1.15);
          finalCost = Number(c.round(4).toString());
        } catch { finalCost = 0; }
        itemsToImport.push({ name, sku, unit, cost_price: finalCost });
      }
      if (itemsToImport.length === 0) throw new Error("No hay productos para importar");
      const res = await bulkImportProductsAction(itemsToImport);
      if (res?.error) throw new Error(res.error);
      window.alert(`Se importaron ${itemsToImport.length} productos correctamente.`);
      router.refresh();
    } catch (err: unknown) {
      window.alert(
        "Error al importar: " +
          ((err instanceof Error ? err.message : null) ?? "Revisa el formato del CSV")
      );
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const onToggleActive = (row: ProductRow) => {
    const msg = row.is_active
      ? `¿Inactivar "${row.name}"? Desaparecerá del catálogo y de los selectores de compra.`
      : `¿Activar "${row.name}"?`;
    if (!window.confirm(msg)) return;
    setPendingId(row.id);
    void (async () => {
      const res = await toggleProductActiveAction(row.id, !row.is_active);
      setPendingId(null);
      if (res?.error) { window.alert(res.error); return; }
      router.refresh();
    })();
  };

  const onDuplicate = (row: ProductRow) => {
    setPendingId(row.id);
    void (async () => {
      const res = await duplicateProductAction(row.id);
      setPendingId(null);
      if (res?.error) { window.alert(res.error); return; }
      router.refresh();
    })();
  };

  const openNew = () => {
    setEditing(null);
    setSessionKey((k) => k + 1);
    setOpen(true);
  };
  const openEdit = (r: ProductRow) => {
    setEditing(r);
    setSessionKey((k) => k + 1);
    setOpen(true);
  };

  return (
    <div className="space-y-5">
      {/* ── Toolbar ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-md flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre o SKU"
            className="pl-10"
            aria-label="Buscar producto"
          />
        </div>
        {canManage ? (
          <div className="flex items-center gap-2">
            <input
              type="file"
              accept=".csv"
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileChange}
            />
            <Button
              variant="outline"
              size="md"
              onClick={handleImportClick}
              disabled={isImporting}
            >
              {isImporting ? "Importando..." : "Importar CSV"}
            </Button>
            <Button onClick={openNew} size="md" className="sm:min-w-[200px]">
              <PlusIcon className="h-4 w-4" />
              Nuevo producto
            </Button>
          </div>
        ) : null}
      </div>

      {/* ── Filters ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <FilterGroup label="Estado">
          <FilterBtn
            active={statusFilter === "active"}
            onClick={() => setStatusFilter("active")}
          >
            Activos
          </FilterBtn>
          <FilterBtn
            active={statusFilter === "inactive"}
            onClick={() => setStatusFilter("inactive")}
          >
            Inactivos
          </FilterBtn>
          <FilterBtn
            active={statusFilter === "all"}
            onClick={() => setStatusFilter("all")}
          >
            Todos
          </FilterBtn>
        </FilterGroup>
        <FilterGroup label="Precio">
          <FilterBtn
            active={priceFilter === "all"}
            onClick={() => setPriceFilter("all")}
          >
            Todos
          </FilterBtn>
          <FilterBtn
            active={priceFilter === "with"}
            onClick={() => setPriceFilter("with")}
          >
            Con precio
          </FilterBtn>
          <FilterBtn
            active={priceFilter === "without"}
            onClick={() => setPriceFilter("without")}
          >
            Sin precio
          </FilterBtn>
        </FilterGroup>
      </div>

      {/* ── Table ───────────────────────────────────────────────── */}
      <div className="panel overflow-hidden rounded-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-b-2 border-steel-700 bg-steel-900/70">
              <tr>
                <Th>Producto</Th>
                <Th className="hidden sm:table-cell">SKU</Th>
                <Th className="text-right">Precio público (Inc. IVA)</Th>
                <Th className="hidden sm:table-cell text-right">Costo prom.</Th>
                <Th>Estado</Th>
                {canManage ? <Th className="text-right">Acción</Th> : null}
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 ? (
                <tr>
                  <td
                    colSpan={canManage ? 6 : 5}
                    className="px-5 py-12 text-center text-[13px] text-muted-foreground"
                  >
                    {initialRows.length === 0 ? (
                      <EmptyState canManage={canManage} onNew={openNew} />
                    ) : (
                      "Sin resultados para los filtros seleccionados."
                    )}
                  </td>
                </tr>
              ) : (
                paginated.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-steel-800 transition-colors hover:bg-steel-900/50"
                  >
                    <Td>
                      <div className="font-semibold text-foreground">{r.name}</div>
                      <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                        {r.unit}
                      </div>
                    </Td>
                    <Td className="hidden sm:table-cell">
                      <span className="font-mono text-[12.5px] tabular-nums text-muted-foreground">
                        {r.sku}
                      </span>
                    </Td>
                    <Td className="text-right">
                      {r.default_price != null ? (
                        <span className="font-mono text-[13px] tabular-nums text-foreground">
                          {moneyFmt.format(Number(r.default_price))}
                        </span>
                      ) : (
                        <span className="font-mono text-[12px] text-muted-foreground">
                          —
                        </span>
                      )}
                    </Td>
                    <Td className="hidden sm:table-cell text-right">
                      <span className="font-mono text-[12.5px] tabular-nums text-muted-foreground">
                        {moneyFmt.format(Number(r.average_cost ?? 0))}
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={r.is_active ? "active" : "neutral"}>
                        {r.is_active ? "Activo" : "Inactivo"}
                      </Badge>
                    </Td>
                    {canManage ? (
                      <Td className="text-right">
                        <DropdownMenu
                          triggerAriaLabel={`Acciones para ${r.name}`}
                          disabled={pendingId === r.id}
                        >
                          {(close) => (
                            <>
                              <DropdownItem
                                onClick={() => { close(); openEdit(r); }}
                              >
                                <PencilIcon className="h-3.5 w-3.5" />
                                Editar
                              </DropdownItem>
                              <DropdownItem
                                onClick={() => { close(); onDuplicate(r); }}
                              >
                                <CopyIcon className="h-3.5 w-3.5" />
                                Duplicar
                              </DropdownItem>
                              <DropdownItem
                                destructive={r.is_active}
                                onClick={() => { close(); onToggleActive(r); }}
                              >
                                {r.is_active ? (
                                  <TrashIcon className="h-3.5 w-3.5" />
                                ) : (
                                  <CheckIcon className="h-3.5 w-3.5" />
                                )}
                                {r.is_active ? "Inactivar" : "Activar"}
                              </DropdownItem>
                            </>
                          )}
                        </DropdownMenu>
                      </Td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Pagination ──────────────────────────────────────────── */}
      {filtered.length > 0 ? (
        <div className="flex items-center justify-between text-[13px] text-muted-foreground">
          <span>
            Mostrando {rangeStart}–{rangeEnd} de {filtered.length} producto
            {filtered.length !== 1 ? "s" : ""}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="md"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Anterior
            </Button>
            <span className="font-mono text-[12px] tabular-nums">
              {safePage} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="md"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Siguiente
            </Button>
          </div>
        </div>
      ) : null}

      {canManage ? (
        <Sheet
          open={open}
          onClose={() => setOpen(false)}
          title={editing ? "Editar producto" : "Nuevo producto"}
          description="Define un ítem del catálogo. El SKU es opcional — se genera automáticamente si lo dejas vacío."
        >
          <ProductForm
            key={`${editing?.id ?? "new"}-${sessionKey}`}
            initial={editing}
            onSuccess={() => setOpen(false)}
          />
        </Sheet>
      ) : null}
    </div>
  );
}

// ── Sub-componentes ────────────────────────────────────────────────────────

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground/60">
        {label}:
      </span>
      <div className="flex items-center divide-x divide-steel-700 overflow-hidden rounded-sm border border-steel-700">
        {children}
      </div>
    </div>
  );
}

function FilterBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] transition-colors " +
        (active
          ? "bg-safety-500 text-steel-950"
          : "bg-transparent text-muted-foreground hover:bg-steel-800 hover:text-foreground")
      }
    >
      {children}
    </button>
  );
}

function EmptyState({
  canManage,
  onNew,
}: {
  canManage: boolean;
  onNew: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <p>
        Aún no has registrado productos. Crea el primero para empezar a recibir
        inventario.
      </p>
      {canManage ? (
        <Button onClick={onNew} size="md">
          <PlusIcon className="h-4 w-4" />
          Crear primer producto
        </Button>
      ) : null}
    </div>
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
        "px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground " +
        (className ?? "")
      }
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={"px-5 py-4 align-top " + (className ?? "")}>{children}</td>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
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
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" />
    </svg>
  );
}
