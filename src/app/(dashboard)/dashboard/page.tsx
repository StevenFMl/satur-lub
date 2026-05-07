import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  getActiveMembership,
  getPlanDisplayName,
} from "@/lib/supabase/membership";
import { createClient } from "@/lib/supabase/server";
import { daysBetween, formatDate } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Panel de control",
};
export const dynamic = "force-dynamic";

type LowStockRow = {
  id: string;
  product_id: string;
  warehouse_id: string;
  quantity_on_hand: number | string | null;
  product: { id: string; name: string; sku: string; unit: string; is_active: boolean } | null;
  warehouse: { id: string; name: string } | null;
};

const qtyFmt = new Intl.NumberFormat("es-EC", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const LOW_STOCK_THRESHOLD = 5;

export default async function DashboardPage() {
  const { user, membership } = await getActiveMembership();
  if (!user) redirect("/login");
  if (!membership) redirect("/onboarding");

  const supabase = await createClient();
  // Top-5 productos con menor stock — apunta a la decisión más urgente del
  // dueño al entrar al sistema: "¿qué tengo que volver a comprar hoy?".
  // Sobre-fetcheamos para descartar productos inactivos client-side (filtrar
  // sobre el embed en PostgREST es frágil con FKs compuestas).
  const { data: lowRaw } = await supabase
    .from("inventory_balances")
    .select(
      `id, product_id, warehouse_id, quantity_on_hand,
       product:products(id, name, sku, unit, is_active),
       warehouse:warehouses(id, name)`
    )
    .order("quantity_on_hand", { ascending: true })
    .limit(20);

  const lowStock = ((lowRaw ?? []) as unknown as LowStockRow[])
    .filter((r) => r.product?.is_active !== false)
    .slice(0, 5);

  const tenant = membership.tenants;

  const fullName =
    (user.user_metadata?.full_name as string | undefined) ?? user.email ?? "—";

  const planName = getPlanDisplayName(tenant?.subscription_plan_code);
  // Fuente autoritativa del periodo: tabla `subscriptions`. `tenants.trial_ends_at`
  // queda como fallback únicamente si la suscripción no se ha sincronizado todavía.
  const periodEnd =
    membership.subscription?.current_period_end ??
    tenant?.trial_ends_at ??
    null;
  const trialDaysLeft = periodEnd
    ? daysBetween(new Date(), new Date(periodEnd))
    : null;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      {/* Hero */}
      <section className="space-y-3">
        <span className="hud-readout">Centro de operación</span>
        <h2 className="font-display text-[40px] leading-[0.95] tracking-[0.02em] text-foreground sm:text-[48px]">
          HOLA,{" "}
          <span className="text-safety-500">
            {fullName.split(" ")[0]?.toUpperCase()}
          </span>
          .
        </h2>
        <p className="max-w-2xl text-[14px] leading-7 text-muted-foreground">
          Este es el panel operativo de{" "}
          <span className="font-semibold text-foreground">
            {tenant?.business_name ?? "tu negocio"}
          </span>
          . Desde aquí gestionas órdenes, vehículos, inventario y cobranza.
        </p>
      </section>

      {/* KPIs principales */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Tile
          label="Negocio"
          value={tenant?.business_name ?? "—"}
          hint={`saturnlub.app/${tenant?.slug ?? "tu-negocio"}`}
        />
        <Tile
          label="Plan"
          value={planName}
          hint={`Estado · ${tenant?.subscription_status ?? "trial"}`}
        />
        <Tile
          label="Periodo de prueba"
          value={
            trialDaysLeft !== null
              ? `${trialDaysLeft} día${trialDaysLeft === 1 ? "" : "s"}`
              : "Sin prueba"
          }
          hint={
            periodEnd ? `Vence ${formatDate(periodEnd)}` : "Sin vencimiento"
          }
        />
      </section>

      {/* Stock bajo · Top 5 */}
      <section className="panel rounded-sm">
        <header className="top-highlight flex items-center justify-between border-b-2 border-steel-700 bg-steel-900/70 px-5 py-4">
          <div className="flex items-center gap-3">
            <span aria-hidden className="hazard-stripe h-3 w-3" />
            <h3 className="font-display text-[18px] leading-none tracking-[0.04em] text-foreground">
              STOCK BAJO · TOP 5
            </h3>
          </div>
          <Link
            href="/dashboard/inventario/stock"
            className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-safety-500"
          >
            Ver todo →
          </Link>
        </header>
        {lowStock.length === 0 ? (
          <div className="px-5 py-8 text-center text-[13px] text-muted-foreground">
            Sin existencias registradas. Recibe una compra para empezar a
            monitorear el stock.
          </div>
        ) : (
          <ul className="divide-y divide-steel-800">
            {lowStock.map((r) => {
              const qty = Number(r.quantity_on_hand ?? 0);
              const isCritical = qty <= LOW_STOCK_THRESHOLD;
              return (
                <li
                  key={r.id}
                  className="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-steel-900/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-foreground">
                      {r.product?.name ?? "—"}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[11px] tabular-nums text-muted-foreground">
                      {r.product?.sku ?? "—"}
                      {r.warehouse?.name ? ` · ${r.warehouse.name}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className={
                        "font-mono text-[18px] font-bold leading-none tabular-nums " +
                        (isCritical ? "text-red-300" : "text-foreground")
                      }
                    >
                      {qtyFmt.format(qty)}
                    </p>
                    <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {r.product?.unit ?? "u."}
                    </p>
                  </div>
                  {r.product_id ? (
                    <Link
                      href={`/dashboard/inventario/stock?productId=${r.product_id}&warehouseId=${r.warehouse_id}`}
                      className="shrink-0 rounded-sm border border-steel-700 bg-steel-800 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:border-safety-500/60 hover:text-safety-500"
                    >
                      Historial
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Próximos pasos + cuenta */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="panel rounded-sm lg:col-span-2">
          <div className="top-highlight flex items-center justify-between border-b border-steel-700 bg-steel-900/70 px-5 py-4">
            <h3 className="font-display text-[18px] leading-none tracking-[0.04em] text-foreground">
              PRÓXIMOS PASOS
            </h3>
            <span className="hud-readout">Configuración · 4 pasos</span>
          </div>
          <div className="space-y-2 px-5 py-5">
            <Step
              done
              title="Crear cuenta y negocio"
              description="Listo. Tu workspace en SaturnLub está activo."
            />
            <Step
              title="Invita a tu equipo"
              description="Agrega mecánicos, cobradores y administradores."
            />
            <Step
              title="Carga tu inventario inicial"
              description="Registra aceites, filtros y servicios frecuentes."
            />
            <Step
              title="Crea tu primera orden"
              description="Atiende un vehículo y emite el comprobante asociado."
            />
          </div>
        </div>

        <div className="panel rounded-sm">
          <div className="top-highlight flex items-center justify-between border-b border-steel-700 bg-steel-900/70 px-5 py-4">
            <h3 className="font-display text-[18px] leading-none tracking-[0.04em] text-foreground">
              TU CUENTA
            </h3>
            <span className="hud-readout">{membership.role ?? "owner"}</span>
          </div>
          <div className="space-y-3 px-5 py-5">
            <Row label="Nombre" value={fullName} />
            <Row label="Correo" value={user.email ?? "—"} mono />
            <Row
              label="Rol"
              value={(membership.role ?? "owner").toUpperCase()}
              mono
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="panel rounded-sm p-5 transition-colors duration-150 hover:border-steel-500">
      <p className="hud-readout">{label}</p>
      <p className="mt-2 truncate font-display text-[24px] leading-none tracking-[0.02em] text-foreground">
        {value}
      </p>
      <p className="mt-2 truncate font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {hint}
      </p>
    </div>
  );
}

function Step({
  title,
  description,
  done,
}: {
  title: string;
  description: string;
  done?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 border border-steel-700 bg-steel-950 p-3">
      <span
        className={
          done
            ? "mt-0.5 grid h-5 w-5 place-items-center rounded-sm bg-safety-500 text-steel-950"
            : "mt-0.5 grid h-5 w-5 place-items-center rounded-sm border border-steel-700 bg-steel-800 font-mono text-[10px] text-muted-foreground"
        }
        aria-hidden
      >
        {done ? (
          <svg
            viewBox="0 0 24 24"
            className="h-3 w-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          "·"
        )}
      </span>
      <div className="min-w-0">
        <p className="font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-foreground">
          {title}
        </p>
        <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-steel-700/60 pb-2 last:border-0 last:pb-0">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </span>
      <span
        className={
          mono
            ? "truncate font-mono text-[12.5px] font-semibold tracking-[0.02em] text-foreground"
            : "truncate text-[13px] font-semibold text-foreground"
        }
      >
        {value}
      </span>
    </div>
  );
}
