"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sheet } from "@/components/ui/sheet";
import { ProductForm } from "./product-form";

export type ProductRow = {
  id: string;
  name: string;
  sku: string;
  cost_price: number | null;
  product_kind: "item" | "service" | "kit";
  is_active: boolean;
  created_at: string;
};

const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

export function ProductsTable({
  initialRows,
  canManage,
}: {
  initialRows: ProductRow[];
  canManage: boolean;
}) {
  const [query, setQuery] = React.useState("");
  const [editing, setEditing] = React.useState<ProductRow | null>(null);
  const [open, setOpen] = React.useState(false);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return initialRows;
    return initialRows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q)
    );
  }, [initialRows, query]);

  const openNew = () => {
    setEditing(null);
    setOpen(true);
  };
  const openEdit = (r: ProductRow) => {
    setEditing(r);
    setOpen(true);
  };

  return (
    <div className="space-y-5">
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
          <Button onClick={openNew} size="md" className="sm:min-w-[200px]">
            <PlusIcon className="h-4 w-4" />
            Nuevo producto
          </Button>
        ) : null}
      </div>

      <div className="panel overflow-hidden rounded-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-b-2 border-steel-700 bg-steel-900/70">
              <tr>
                <Th>Producto</Th>
                <Th>SKU</Th>
                <Th className="text-right">Costo base</Th>
                <Th>Estado</Th>
                {canManage ? <Th className="text-right">Acción</Th> : null}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={canManage ? 5 : 4}
                    className="px-5 py-12 text-center text-[13px] text-muted-foreground"
                  >
                    {initialRows.length === 0
                      ? "Aún no has registrado productos. Crea el primero para empezar a recibir inventario."
                      : "Sin resultados para tu búsqueda."}
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-steel-800 transition-colors hover:bg-steel-900/50"
                  >
                    <Td>
                      <div className="font-semibold text-foreground">
                        {r.name}
                      </div>
                    </Td>
                    <Td>
                      <span className="font-mono text-[12.5px] tabular-nums text-muted-foreground">
                        {r.sku}
                      </span>
                    </Td>
                    <Td className="text-right">
                      <span className="font-mono text-[13px] tabular-nums text-foreground">
                        {moneyFmt.format(Number(r.cost_price ?? 0))}
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={r.is_active ? "active" : "neutral"}>
                        {r.is_active ? "Activo" : "Inactivo"}
                      </Badge>
                    </Td>
                    {canManage ? (
                      <Td className="text-right">
                        <button
                          type="button"
                          onClick={() => openEdit(r)}
                          className="inline-flex items-center gap-1.5 rounded-sm border border-steel-700 bg-steel-800 px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-safety-500/60 hover:text-safety-500"
                        >
                          <PencilIcon className="h-3.5 w-3.5" />
                          Editar
                        </button>
                      </Td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {canManage ? (
        <Sheet
          open={open}
          onClose={() => setOpen(false)}
          title={editing ? "Editar producto" : "Nuevo producto"}
          description="Define un ítem del catálogo. El SKU es opcional — se genera automáticamente si lo dejas vacío."
        >
          <ProductForm
            key={editing?.id ?? "new"}
            initial={editing}
            onSuccess={() => setOpen(false)}
          />
        </Sheet>
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
