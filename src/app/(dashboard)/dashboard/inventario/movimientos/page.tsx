import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Kárdex · Inventario" };
export const dynamic = "force-dynamic";

type MovementType =
  | "in"
  | "out"
  | "adjustment"
  | "sale"
  | "purchase"
  | "transfer";

type Row = {
  id: string;
  created_at: string;
  movement_type: MovementType;
  quantity: number | string;
  unit_cost: number | string | null;
  reason: string;
  reference_type: string | null;
  product: { id: string; name: string; sku: string } | null;
  warehouse: { id: string; name: string } | null;
};

const TYPE_META: Record<
  MovementType,
  { label: string; tone: "active" | "danger" | "warning" | "info" | "rust"; sign: "+" | "−" | "±" }
> = {
  in: { label: "Entrada", tone: "active", sign: "+" },
  purchase: { label: "Compra", tone: "active", sign: "+" },
  out: { label: "Salida", tone: "danger", sign: "−" },
  sale: { label: "Venta", tone: "rust", sign: "−" },
  transfer: { label: "Traspaso", tone: "info", sign: "±" },
  adjustment: { label: "Ajuste", tone: "warning", sign: "±" },
};

const dateFmt = new Intl.DateTimeFormat("es-EC", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const qtyFmt = new Intl.NumberFormat("es-EC", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

type SearchParams = {
  product_id?: string;
  warehouse_id?: string;
  type?: MovementType;
};

export default async function MovimientosPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  const { user, membership } = await getActiveMembership();
  if (!user) redirect("/login");
  if (!membership) redirect("/onboarding");

  const supabase = await createClient();

  let query = supabase
    .from("inventory_movements")
    .select(
      `id, created_at, movement_type, quantity, unit_cost, reason, reference_type,
       product:products(id, name, sku),
       warehouse:warehouses(id, name)`
    )
    .order("created_at", { ascending: false })
    .limit(500);

  if (params.product_id) query = query.eq("product_id", params.product_id);
  if (params.warehouse_id) query = query.eq("warehouse_id", params.warehouse_id);
  if (params.type) query = query.eq("movement_type", params.type);

  const { data, error } = await query;

  if (error) {
    console.error("MovimientosPage · query:", error);
  }

  const rows = ((data ?? []) as unknown) as Row[];

  const filterContext = await resolveFilterContext(supabase, params);
  const hasFilter = Boolean(
    params.product_id || params.warehouse_id || params.type
  );

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      <header className="space-y-2">
        <span className="hud-readout">Inventario · Auditoría</span>
        <h1 className="font-display text-[36px] leading-none tracking-[0.02em] text-foreground sm:text-[42px]">
          KÁRDEX
        </h1>
        <p className="max-w-2xl text-[14px] leading-6 text-muted-foreground">
          Cada entrada y salida del inventario, registrada con timestamp,
          producto, bodega y referencia. Trazabilidad completa, lectura de los
          últimos 500 movimientos.
        </p>
      </header>

      {hasFilter ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="industrial-label">Filtros:</span>
          {filterContext.product ? (
            <FilterChip>
              Producto: <strong>{filterContext.product.name}</strong>
            </FilterChip>
          ) : null}
          {filterContext.warehouse ? (
            <FilterChip>
              Bodega: <strong>{filterContext.warehouse.name}</strong>
            </FilterChip>
          ) : null}
          {params.type ? (
            <FilterChip>
              Tipo: <strong>{TYPE_META[params.type].label}</strong>
            </FilterChip>
          ) : null}
          <Link
            href="/dashboard/inventario/movimientos"
            className="ml-1 inline-flex items-center gap-1 rounded-sm border border-steel-700 bg-steel-800 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:border-safety-500/60 hover:text-safety-500"
          >
            Limpiar
          </Link>
        </div>
      ) : null}

      <div className="panel overflow-hidden rounded-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-b-2 border-steel-700 bg-steel-900/70">
              <tr>
                <Th>Fecha</Th>
                <Th>Producto</Th>
                <Th>Tipo</Th>
                <Th className="text-right">Cantidad</Th>
                <Th>Bodega</Th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-5 py-12 text-center text-[13px] text-muted-foreground"
                  >
                    {hasFilter
                      ? "Sin movimientos para los filtros aplicados."
                      : "Aún no hay movimientos registrados. Recibe una compra o ajusta inventario para empezar el kárdex."}
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const meta =
                    TYPE_META[r.movement_type] ?? TYPE_META.adjustment;
                  const qty = Number(r.quantity ?? 0);
                  return (
                    <tr
                      key={r.id}
                      className="border-b border-steel-800 transition-colors hover:bg-steel-900/50"
                    >
                      <Td>
                        <div className="font-mono text-[12.5px] tabular-nums text-foreground">
                          {dateFmt.format(new Date(r.created_at))}
                        </div>
                        {r.reason ? (
                          <div className="mt-0.5 text-[11.5px] leading-4 text-muted-foreground">
                            {r.reason}
                          </div>
                        ) : null}
                      </Td>
                      <Td>
                        {r.product ? (
                          <>
                            <div className="font-semibold text-foreground">
                              {r.product.name}
                            </div>
                            <div className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                              {r.product.sku}
                            </div>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </Td>
                      <Td>
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </Td>
                      <Td className="text-right">
                        <span
                          className={
                            "font-mono text-[14px] font-bold tabular-nums " +
                            (meta.sign === "+"
                              ? "text-emerald-300"
                              : meta.sign === "−"
                              ? "text-red-300"
                              : "text-foreground")
                          }
                        >
                          {meta.sign}
                          {qtyFmt.format(qty)}
                        </span>
                      </Td>
                      <Td>
                        <span className="text-[12.5px] text-muted-foreground">
                          {r.warehouse?.name ?? "—"}
                        </span>
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

type SupabaseLike = Awaited<ReturnType<typeof createClient>>;

async function resolveFilterContext(
  supabase: SupabaseLike,
  params: SearchParams
) {
  const [productRes, warehouseRes] = await Promise.all([
    params.product_id
      ? supabase
          .from("products")
          .select("name")
          .eq("id", params.product_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    params.warehouse_id
      ? supabase
          .from("warehouses")
          .select("name")
          .eq("id", params.warehouse_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    product: (productRes.data as { name: string } | null) ?? null,
    warehouse: (warehouseRes.data as { name: string } | null) ?? null,
  };
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

function FilterChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-sm border border-steel-700 bg-steel-900 px-3 py-1 font-mono text-[11px] tracking-[0.04em] text-muted-foreground">
      {children}
    </span>
  );
}
