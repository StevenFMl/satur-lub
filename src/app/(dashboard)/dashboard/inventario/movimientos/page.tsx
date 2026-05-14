import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { MovementsTable, type MovementRow } from "./movements-table";

export const metadata: Metadata = { title: "Kárdex · Inventario | SaturLub" };
export const dynamic = "force-dynamic";

type SearchParams = {
  product_id?:   string;
  warehouse_id?: string;
  type?:         string;   // comma-separated list of movement_type values
  date_from?:    string;   // YYYY-MM-DD
  date_to?:      string;   // YYYY-MM-DD
};

type RawMovement = {
  id: string;
  created_at: string;
  movement_type: string;
  quantity: number | string;
  direction: number | null;
  unit_cost: number | string | null;
  reason: string;
  reference_type: string | null;
  reference_id: string | null;
  performed_by_user_id: string | null;
  products: { id: string; name: string; sku: string; unit: string } | null;
  warehouses: { id: string; name: string } | null;
};

export default async function MovimientosPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  const { user, membership } = await getActiveMembership();
  if (!user)       redirect("/login");
  if (!membership) redirect("/onboarding");

  const supabase = await createClient();
  const tenantId = membership.tenant_id;

  // ── Parallel fetch: filter lists + movements ────────────────────────────
  const types = (params.type ?? "").split(",").map((t) => t.trim()).filter(Boolean);

  let movQuery = supabase
    .from("inventory_movements")
    .select(
      `id, created_at, movement_type, quantity, direction, unit_cost, reason,
       reference_type, reference_id, performed_by_user_id,
       products ( id, name, sku, unit ),
       warehouses ( id, name )`
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(500);

  if (params.product_id)   movQuery = movQuery.eq("product_id",   params.product_id);
  if (params.warehouse_id) movQuery = movQuery.eq("warehouse_id", params.warehouse_id);
  if (types.length > 0)    movQuery = movQuery.in("movement_type", types);
  if (params.date_from)    movQuery = movQuery.gte("created_at", `${params.date_from}T00:00:00`);
  if (params.date_to)      movQuery = movQuery.lte("created_at", `${params.date_to}T23:59:59`);

  const [movResult, productsResult, warehousesResult] = await Promise.all([
    movQuery,
    supabase
      .from("products")
      .select("id, name, sku")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase
      .from("warehouses")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .order("name", { ascending: true }),
  ]);

  if (movResult.error) {
    console.error("MovimientosPage · query:", movResult.error);
  }

  const rawRows = ((movResult.data ?? []) as unknown) as RawMovement[];

  const rows: MovementRow[] = rawRows.map((r) => ({
    id:                    r.id,
    created_at:            r.created_at,
    movement_type:         r.movement_type,
    quantity:              Number(r.quantity ?? 0),
    direction:             r.direction ?? null,
    unit_cost:             r.unit_cost != null ? Number(r.unit_cost) : null,
    reason:                r.reason ?? "",
    reference_type:        r.reference_type,
    reference_id:          r.reference_id,
    performed_by_user_id:  r.performed_by_user_id,
    product:               r.products
      ? { id: r.products.id, name: r.products.name, sku: r.products.sku, unit: r.products.unit }
      : null,
    warehouse:             r.warehouses
      ? { id: r.warehouses.id, name: r.warehouses.name }
      : null,
  }));

  const products   = (productsResult.data   ?? []) as { id: string; name: string }[];
  const warehouses = (warehousesResult.data ?? []) as { id: string; name: string }[];

  const hasFilter = Boolean(
    params.product_id || params.warehouse_id || params.type ||
    params.date_from  || params.date_to
  );

  return (
    <div className="mx-auto w-full max-w-7xl space-y-7">
      {/* Header */}
      <header className="space-y-2">
        <span className="hud-readout">Inventario · Auditoría</span>
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-[32px] leading-none tracking-[0.02em] text-foreground sm:text-[40px]">
              KÁRDEX
            </h1>
            <p className="mt-1 max-w-xl text-[13px] leading-5 text-muted-foreground">
              Historial completo de entradas, salidas y ajustes — con producto, bodega,
              costo y usuario. Filtra por tipo o rango de fechas para auditoría.
            </p>
          </div>
          <div className="shrink-0 rounded-sm border border-steel-700 bg-steel-900/60 px-4 py-2.5 text-center">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/60">
              Total cargados
            </p>
            <p className="mt-0.5 font-mono text-[22px] font-bold tabular-nums text-foreground">
              {rows.length}
            </p>
          </div>
        </div>
      </header>

      {/* Table with built-in filter panel */}
      <MovementsTable
        rows={rows}
        products={products}
        warehouses={warehouses}
        totalFiltered={rows.length}
        hasFilter={hasFilter}
      />
    </div>
  );
}
