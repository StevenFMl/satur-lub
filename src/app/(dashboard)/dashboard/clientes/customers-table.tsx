"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sheet } from "@/components/ui/sheet";
import { FormDialog } from "@/components/ui/form-dialog";
import { DropdownMenu, DropdownItem } from "@/components/ui/dropdown-menu";
import { toggleCustomerActiveAction } from "@/actions/customers";
import { CONSUMIDOR_FINAL_DOC } from "@/lib/validations/customer";
import { CustomerForm } from "./customer-form";
import { CustomerDetail } from "./customer-detail";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type CustomerRow = {
  id: string;
  full_name: string;
  document_type: "CEDULA" | "RUC" | "CONSUMIDOR_FINAL" | "PASAPORTE";
  document_number: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  loyalty_points: number;
  is_active: boolean;
  created_at: string;
};

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const PAGE_SIZE = 20;

type StatusFilter = "all" | "active" | "inactive";
type DocFilter = "all" | "CEDULA" | "RUC" | "CONSUMIDOR_FINAL";

function isConsumidorFinal(row: CustomerRow): boolean {
  return (
    row.document_type === "CONSUMIDOR_FINAL" &&
    row.document_number === CONSUMIDOR_FINAL_DOC
  );
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = React.useState<T>(value);
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

const docLabel = (type: string) => {
  switch (type) {
    case "CEDULA": return "Cédula";
    case "RUC": return "RUC";
    case "PASAPORTE": return "Pasaporte";
    case "CONSUMIDOR_FINAL": return "C. Final";
    default: return type;
  }
};

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export function CustomersTable({ initialRows }: { initialRows: CustomerRow[] }) {
  const router = useRouter();

  // Search & filters
  const [query, setQuery] = React.useState("");
  const debouncedQuery = useDebounce(query, 200);
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("active");
  const [docFilter, setDocFilter] = React.useState<DocFilter>("all");
  const [page, setPage] = React.useState(1);

  // Sheets
  const [editing, setEditing] = React.useState<CustomerRow | null>(null);
  const [formOpen, setFormOpen] = React.useState(false);
  const [viewing, setViewing] = React.useState<CustomerRow | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);

  // Pending states
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  // Reset page on filter change
  React.useEffect(() => {
    setPage(1);
  }, [debouncedQuery, statusFilter, docFilter]);

  // ── Filtering ──
  const filtered = React.useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    return initialRows.filter((r) => {
      if (statusFilter === "active" && !r.is_active) return false;
      if (statusFilter === "inactive" && r.is_active) return false;
      if (docFilter !== "all" && r.document_type !== docFilter) return false;
      if (q) {
        const matchName = r.full_name.toLowerCase().includes(q);
        const matchDoc = r.document_number.includes(q);
        const matchPhone = r.phone?.toLowerCase().includes(q) ?? false;
        if (!matchName && !matchDoc && !matchPhone) return false;
      }
      return true;
    });
  }, [initialRows, debouncedQuery, statusFilter, docFilter]);

  // ── Pagination ──
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const rangeStart = filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(safePage * PAGE_SIZE, filtered.length);

  // ── Stats ──
  const stats = React.useMemo(() => {
    const active = initialRows.filter((r) => r.is_active).length;
    const withDoc = initialRows.filter(
      (r) => r.is_active && r.document_type !== "CONSUMIDOR_FINAL"
    ).length;
    return { active, withDoc };
  }, [initialRows]);

  // ── Actions ──
  const onToggleActive = (row: CustomerRow) => {
    if (isConsumidorFinal(row)) return;
    const next = !row.is_active;
    if (
      !next &&
      !window.confirm(
        `¿Inactivar al cliente "${row.full_name}"? Desaparecerá de la lista activa.`
      )
    )
      return;
    setPendingId(row.id);
    void (async () => {
      const res = await toggleCustomerActiveAction(row.id, next);
      setPendingId(null);
      if (res?.error) {
        window.alert(res.error);
        return;
      }
      router.refresh();
    })();
  };

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (r: CustomerRow) => {
    setDetailOpen(false);
    setEditing(r);
    setFormOpen(true);
  };

  const openDetail = (r: CustomerRow) => {
    setViewing(r);
    setDetailOpen(true);
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* ── Stats + CTA ── */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-[1fr_1fr_auto] sm:gap-3">
        <StatCard label="Clientes activos" value={String(stats.active)} />
        <StatCard label="Con doc. fiscal" value={String(stats.withDoc)} />
        <Button
          onClick={openNew}
          size="md"
          className="col-span-2 h-auto min-h-[56px] sm:col-span-1 sm:min-w-[180px]"
        >
          <PlusIcon className="h-4 w-4" />
          Nuevo cliente
        </Button>
      </div>

      {/* ── Search ── */}
      <div className="relative max-w-md">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nombre, cédula o teléfono"
          className="h-11 pl-10"
          aria-label="Buscar cliente"
        />
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-start gap-3">
        <FilterGroup label="Estado">
          <FilterBtn active={statusFilter === "active"} onClick={() => setStatusFilter("active")}>Activos</FilterBtn>
          <FilterBtn active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>Todos</FilterBtn>
          <FilterBtn active={statusFilter === "inactive"} onClick={() => setStatusFilter("inactive")}>Inactivos</FilterBtn>
        </FilterGroup>
        <FilterGroup label="Tipo">
          <FilterBtn active={docFilter === "all"} onClick={() => setDocFilter("all")}>Todos</FilterBtn>
          <FilterBtn active={docFilter === "CEDULA"} onClick={() => setDocFilter("CEDULA")}>Cédula</FilterBtn>
          <FilterBtn active={docFilter === "RUC"} onClick={() => setDocFilter("RUC")}>RUC</FilterBtn>
          <FilterBtn active={docFilter === "CONSUMIDOR_FINAL"} onClick={() => setDocFilter("CONSUMIDOR_FINAL")}>C.Final</FilterBtn>
        </FilterGroup>
      </div>

      {/* ── Desktop table ── */}
      <div className="hidden panel overflow-hidden rounded-sm sm:block">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-b-2 border-steel-700 bg-steel-900/70">
              <tr>
                <Th>Cliente</Th>
                <Th>Identificación</Th>
                <Th>Contacto</Th>
                <Th>Estado</Th>
                <Th className="w-[60px] text-right"> </Th>
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-[13px] text-muted-foreground">
                    {initialRows.length === 0 ? (
                      <EmptyState onNew={openNew} />
                    ) : (
                      "Sin resultados para los filtros seleccionados."
                    )}
                  </td>
                </tr>
              ) : (
                paginated.map((r) => {
                  const isCF = isConsumidorFinal(r);
                  return (
                    <tr
                      key={r.id}
                      onClick={() => openDetail(r)}
                      className="cursor-pointer border-b border-steel-800 transition-colors hover:bg-steel-900/50"
                    >
                      <Td>
                        <div className="font-semibold text-foreground">{r.full_name}</div>
                        {r.phone && (
                          <div className="mt-0.5 font-mono text-[12px] text-muted-foreground">
                            {r.phone}
                          </div>
                        )}
                      </Td>
                      <Td>
                        <span
                          className={
                            "font-mono text-[12.5px] tabular-nums " +
                            (isCF ? "text-muted-foreground/50" : "text-muted-foreground")
                          }
                        >
                          {docLabel(r.document_type)} · {r.document_number}
                        </span>
                      </Td>
                      <Td>
                        {r.email ? (
                          <div className="truncate text-[12.5px] text-foreground">{r.email}</div>
                        ) : (
                          <span className="text-[12.5px] text-muted-foreground">—</span>
                        )}
                      </Td>
                      <Td>
                        <Badge tone={r.is_active ? "active" : "neutral"}>
                          {r.is_active ? "Activo" : "Inactivo"}
                        </Badge>
                      </Td>
                      <Td className="text-right" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu
                          triggerAriaLabel={`Acciones para ${r.full_name}`}
                          disabled={pendingId === r.id}
                        >
                          {(close) => (
                            <>
                              <DropdownItem onClick={() => { close(); openDetail(r); }}>
                                <EyeIcon className="h-3.5 w-3.5" />
                                Ver detalle
                              </DropdownItem>
                              {!isCF && (
                                <DropdownItem onClick={() => { close(); openEdit(r); }}>
                                  <PencilIcon className="h-3.5 w-3.5" />
                                  Editar
                                </DropdownItem>
                              )}
                              {isCF ? (
                                <DropdownItem disabled>
                                  <LockIcon className="h-3.5 w-3.5" />
                                  Protegido (SRI)
                                </DropdownItem>
                              ) : (
                                <DropdownItem
                                  destructive={r.is_active}
                                  onClick={() => { close(); onToggleActive(r); }}
                                >
                                  {r.is_active ? (
                                    <><TrashIcon className="h-3.5 w-3.5" /> Inactivar</>
                                  ) : (
                                    <><RefreshIcon className="h-3.5 w-3.5" /> Reactivar</>
                                  )}
                                </DropdownItem>
                              )}
                            </>
                          )}
                        </DropdownMenu>
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Mobile cards ── */}
      <div className="space-y-3 sm:hidden">
        {paginated.length === 0 ? (
          <div className="panel rounded-sm px-5 py-10 text-center text-[13px] text-muted-foreground">
            {initialRows.length === 0 ? (
              <EmptyState onNew={openNew} />
            ) : (
              "Sin resultados para los filtros seleccionados."
            )}
          </div>
        ) : (
          paginated.map((r) => (
            <CustomerCard
              key={r.id}
              row={r}
              onView={() => openDetail(r)}
              onEdit={() => openEdit(r)}
              onToggle={() => onToggleActive(r)}
              pending={pendingId === r.id}
            />
          ))
        )}
      </div>

      {/* ── Pagination ── */}
      {filtered.length > 0 && (
        <div className="flex flex-col items-stretch gap-3 text-[12.5px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span className="text-center sm:text-left">
            Mostrando {rangeStart}–{rangeEnd} de {filtered.length} cliente
            {filtered.length !== 1 ? "s" : ""}
          </span>
          <div className="flex items-center justify-center gap-2 sm:gap-3">
            <Button variant="outline" size="md" disabled={safePage <= 1} onClick={() => setPage((p) => p - 1)}>
              Anterior
            </Button>
            <span className="px-1 font-mono text-[12px] tabular-nums">
              {safePage} / {totalPages}
            </span>
            <Button variant="outline" size="md" disabled={safePage >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Siguiente
            </Button>
          </div>
        </div>
      )}

      {/* ── Detail sheet ── */}
      <Sheet
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        title={viewing?.full_name ?? ""}
        description="Detalle del cliente"
      >
        {viewing && (
          <CustomerDetail
            customer={viewing}
            onEdit={() => openEdit(viewing)}
            onToggleActive={() => {
              onToggleActive(viewing);
              setDetailOpen(false);
            }}
            togglePending={pendingId === viewing.id}
          />
        )}
      </Sheet>

      {/* ── Form dialog ── */}
      <FormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Editar cliente" : "Nuevo cliente"}
        description="Registra nombre y teléfono. Los datos fiscales son opcionales."
      >
        <CustomerForm
          key={editing?.id ?? "new"}
          initial={editing}
          onSuccess={() => setFormOpen(false)}
        />
      </FormDialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function CustomerCard({
  row,
  onView,
  onEdit,
  onToggle,
  pending,
}: {
  row: CustomerRow;
  onView: () => void;
  onEdit: () => void;
  onToggle: () => void;
  pending: boolean;
}) {
  const isCF = isConsumidorFinal(row);
  return (
    <div
      onClick={onView}
      className={
        "panel cursor-pointer rounded-sm px-4 py-4 transition-colors active:bg-steel-800/60 " +
        (!row.is_active ? "opacity-70" : "")
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-foreground">{row.full_name}</div>
          <div className="mt-0.5 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
            <span>{docLabel(row.document_type)}</span>
            <span className="text-muted-foreground/40">•</span>
            <span>{row.document_number}</span>
          </div>
        </div>
        {row.phone && (
          <span className="shrink-0 font-mono text-[13px] tabular-nums text-muted-foreground">
            {row.phone}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge tone={row.is_active ? "active" : "neutral"}>
          {row.is_active ? "Activo" : "Inactivo"}
        </Badge>
        {isCF && <Badge tone="warning">SRI</Badge>}
        {row.email && (
          <span className="truncate rounded-sm border border-steel-700 bg-steel-900/60 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
            {row.email}
          </span>
        )}
      </div>

      {!isCF && (
        <div
          className="mt-3 flex justify-end gap-2 border-t border-steel-800/70 pt-2"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-1.5 rounded-sm border border-steel-700 bg-steel-800/60 px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-steel-500 hover:text-foreground"
          >
            <PencilIcon className="h-3 w-3" />
            Editar
          </button>
          <button
            type="button"
            onClick={onToggle}
            disabled={pending}
            className={
              "inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] transition-colors disabled:opacity-50 " +
              (row.is_active
                ? "border-hazard-500/30 bg-hazard-700/10 text-red-400 hover:border-hazard-500/60 hover:text-red-300"
                : "border-signal-500/30 bg-signal-700/10 text-emerald-400 hover:border-signal-500/60 hover:text-emerald-300")
            }
          >
            {row.is_active ? (
              <><TrashIcon className="h-3 w-3" /> Inactivar</>
            ) : (
              <><RefreshIcon className="h-3 w-3" /> Reactivar</>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel rounded-sm px-4 py-3">
      <div className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">
        {label}
      </div>
      <div className="mt-1.5 font-mono text-[20px] font-bold tabular-nums text-foreground sm:text-[22px]">
        {value}
      </div>
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
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
        "min-h-[36px] px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] transition-colors " +
        (active
          ? "bg-safety-500 text-steel-950"
          : "bg-transparent text-muted-foreground hover:bg-steel-800 hover:text-foreground")
      }
    >
      {children}
    </button>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <div className="grid h-14 w-14 place-items-center rounded-sm border-2 border-dashed border-steel-700 text-muted-foreground/60">
        <UsersIcon className="h-6 w-6" />
      </div>
      <div className="space-y-1">
        <p className="font-mono text-[13px] font-semibold uppercase tracking-[0.12em] text-foreground">
          Sin clientes registrados
        </p>
        <p className="text-[12.5px] text-muted-foreground">
          Crea tu primer cliente — solo necesitas su nombre y teléfono.
        </p>
      </div>
      <Button onClick={onNew} size="md">
        <PlusIcon className="h-4 w-4" />
        Crear primer cliente
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Table helpers                                                       */
/* ------------------------------------------------------------------ */

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={"px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground " + (className ?? "")}>
      {children}
    </th>
  );
}

function Td({
  children,
  className,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <td className={"px-5 py-4 align-middle " + (className ?? "")} onClick={onClick}>
      {children}
    </td>
  );
}

/* ------------------------------------------------------------------ */
/* Inline SVG icons                                                    */
/* ------------------------------------------------------------------ */

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 5v14" /><path d="M5 12h14" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" />
    </svg>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M3 21v-5h5" />
    </svg>
  );
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="9" cy="8" r="4" /><path d="M2 21c0-4 3-7 7-7s7 3 7 7" /><circle cx="17" cy="9" r="3" /><path d="M21 21c0-2.5-2-5-4.5-5" />
    </svg>
  );
}
