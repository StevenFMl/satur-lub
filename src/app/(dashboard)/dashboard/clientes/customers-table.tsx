"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sheet } from "@/components/ui/sheet";
import { DropdownMenu, DropdownItem } from "@/components/ui/dropdown-menu";
import { toggleCustomerActiveAction } from "@/actions/customers";
import { CONSUMIDOR_FINAL_DOC } from "@/lib/validations/customer";
import { CustomerForm } from "./customer-form";

export type CustomerRow = {
  id: string;
  full_name: string;
  document_type: "CEDULA" | "RUC" | "CONSUMIDOR_FINAL" | "PASAPORTE";
  document_number: string;
  email: string | null;
  phone: string | null;
  loyalty_points: number;
  is_active: boolean;
  created_at: string;
};

function isConsumidorFinal(row: CustomerRow): boolean {
  return (
    row.document_type === "CONSUMIDOR_FINAL" &&
    row.document_number === CONSUMIDOR_FINAL_DOC
  );
}

export function CustomersTable({
  initialRows,
}: {
  initialRows: CustomerRow[];
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [editing, setEditing] = React.useState<CustomerRow | null>(null);
  const [open, setOpen] = React.useState(false);
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  const onInactivate = (row: CustomerRow) => {
    if (isConsumidorFinal(row)) return; // seguridad extra en UI
    if (
      !window.confirm(
        `¿Inactivar al cliente "${row.full_name}"? Desaparecerá de la lista pero podrás restaurarlo.`
      )
    )
      return;
    setPendingId(row.id);
    void (async () => {
      const res = await toggleCustomerActiveAction(row.id, false);
      setPendingId(null);
      if (res?.error) {
        window.alert(res.error);
        return;
      }
      router.refresh();
    })();
  };

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return initialRows;
    return initialRows.filter(
      (r) =>
        r.full_name.toLowerCase().includes(q) ||
        r.document_number.includes(q) ||
        (r.email?.toLowerCase().includes(q) ?? false) ||
        (r.phone?.toLowerCase().includes(q) ?? false)
    );
  }, [initialRows, query]);

  const openNew = () => {
    setEditing(null);
    setOpen(true);
  };

  const openEdit = (r: CustomerRow) => {
    setEditing(r);
    setOpen(true);
  };

  const docLabel = (type: string) => {
    switch (type) {
      case "CEDULA":
        return "Cédula";
      case "RUC":
        return "RUC";
      case "PASAPORTE":
        return "Pasaporte";
      case "CONSUMIDOR_FINAL":
        return "C. Final";
      default:
        return type;
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-md flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre, teléfono, email o cédula"
            className="pl-10"
            aria-label="Buscar cliente"
          />
        </div>
        <Button onClick={openNew} size="md" className="sm:min-w-[200px]">
          <PlusIcon className="h-4 w-4" />
          Nuevo cliente
        </Button>
      </div>

      <div className="panel overflow-hidden rounded-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-b-2 border-steel-700 bg-steel-900/70">
              <tr>
                <Th>Cliente</Th>
                <Th>Identificación</Th>
                <Th>Contacto</Th>
                <Th>Puntos</Th>
                <Th>Estado</Th>
                <Th className="text-right">Acción</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-5 py-12 text-center text-[13px] text-muted-foreground"
                  >
                    {initialRows.length === 0
                      ? "Aún no hay clientes registrados. Crea el primero — solo necesitas su nombre."
                      : "Sin resultados para tu búsqueda."}
                  </td>
                </tr>
              ) : (
                filtered.map((r) => {
                  const isCF = isConsumidorFinal(r);
                  return (
                    <tr
                      key={r.id}
                      className="border-b border-steel-800 transition-colors hover:bg-steel-900/50"
                    >
                      <Td>
                        <div className="font-semibold text-foreground">
                          {r.full_name}
                        </div>
                        {r.phone ? (
                          <div className="mt-0.5 font-mono text-[12px] text-muted-foreground">
                            {r.phone}
                          </div>
                        ) : null}
                      </Td>
                      <Td>
                        <span
                          className={
                            "font-mono text-[12.5px] tabular-nums " +
                            (isCF
                              ? "text-muted-foreground/50"
                              : "text-muted-foreground")
                          }
                        >
                          {docLabel(r.document_type)} · {r.document_number}
                        </span>
                      </Td>
                      <Td>
                        <div className="space-y-0.5 text-[12.5px]">
                          {r.email ? (
                            <div className="truncate text-foreground">
                              {r.email}
                            </div>
                          ) : null}
                          {!r.email ? (
                            <span className="text-muted-foreground">—</span>
                          ) : null}
                        </div>
                      </Td>
                      <Td>
                        <span className="font-mono text-[12.5px] tabular-nums text-foreground">
                          {r.loyalty_points > 0 ? (
                            <Badge tone="active">{r.loyalty_points} pts</Badge>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </span>
                      </Td>
                      <Td>
                        <Badge tone={r.is_active ? "active" : "neutral"}>
                          {r.is_active ? "Activo" : "Inactivo"}
                        </Badge>
                      </Td>
                      <Td className="text-right">
                        <DropdownMenu
                          triggerAriaLabel={`Acciones para ${r.full_name}`}
                          disabled={pendingId === r.id}
                        >
                          {(close) => (
                            <>
                              {!isCF && (
                                <DropdownItem
                                  onClick={() => {
                                    close();
                                    openEdit(r);
                                  }}
                                >
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
                                  destructive
                                  onClick={() => {
                                    close();
                                    onInactivate(r);
                                  }}
                                >
                                  <TrashIcon className="h-3.5 w-3.5" />
                                  Inactivar
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

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Editar cliente" : "Nuevo cliente"}
        description="Registra nombre y teléfono. Los datos fiscales son opcionales."
      >
        <CustomerForm
          key={editing?.id ?? "new"}
          initial={editing}
          onSuccess={() => setOpen(false)}
        />
      </Sheet>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Table helpers                                                       */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Inline SVG icons                                                    */
/* ------------------------------------------------------------------ */

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

function LockIcon({ className }: { className?: string }) {
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
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
