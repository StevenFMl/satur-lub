import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getActiveMembership } from "@/lib/supabase/membership";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { todayEC, todayLabelEC } from "@/lib/date-ec";

export const metadata: Metadata = { title: "Inicio · SaturLub" };
export const dynamic = "force-dynamic";

// ── Formatters ─────────────────────────────────────────────────────────────

const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

const LOW_STOCK_THRESHOLD = 5;

// ── Page ───────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const { user, membership } = await getActiveMembership();
  if (!user) redirect("/login");
  if (!membership) redirect("/onboarding");

  const supabase   = await createClient();
  const tenantId   = membership.tenant_id;
  const todayStr   = todayEC(); // YYYY-MM-DD pinned to America/Guayaquil

  // ── Parallel queries ───────────────────────────────────────────────────
  const [
    { data: cashSessionRaw },
    { data: salesTodayRaw },
    { data: receivablesRaw },
    { data: purchasesPendingRaw },
    { data: lowStockRaw },
  ] = await Promise.all([
    // Open cash session (any warehouse)
    supabase
      .from("cash_sessions")
      .select("id, opening_amount, opened_at")
      .eq("tenant_id", tenantId)
      .eq("status", "open")
      .limit(1)
      .maybeSingle(),

    // Confirmed sales today
    supabase
      .from("sales")
      .select("id, total")
      .eq("tenant_id", tenantId)
      .eq("sale_date", todayStr)
      .eq("status", "confirmed"),

    // Non-paid receivables (v9 — graceful fallback if table missing)
    supabase
      .from("customer_receivables")
      .select("id, status, balance_due, due_date")
      .eq("tenant_id", tenantId)
      .in("status", ["pending", "partial", "overdue"]),

    // Purchase orders with pending payment
    supabase
      .from("purchase_orders")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("payment_status", "pending")
      .neq("status", "cancelled"),

    // Low-stock products (over-fetch, filter actives in JS)
    supabase
      .from("inventory_balances")
      .select("id, quantity_on_hand, product:products(is_active)")
      .eq("tenant_id", tenantId)
      .lte("quantity_on_hand", LOW_STOCK_THRESHOLD)
      .limit(100),
  ]);

  // ── Derived values ─────────────────────────────────────────────────────
  const hasOpenSession = !!cashSessionRaw;
  const openingAmount  = Number((cashSessionRaw as any)?.opening_amount ?? 0);

  const salesToday  = (salesTodayRaw ?? []) as { id: string; total: number }[];
  const todayCount  = salesToday.length;
  const todayTotal  = salesToday.reduce((s, r) => s + Number(r.total ?? 0), 0);

  const receivables    = (receivablesRaw ?? []) as { id: string; status: string; balance_due: number | null; due_date: string | null }[];
  const fiadoCount     = receivables.length;
  const fiadoBalance   = receivables.reduce((s, r) => s + Number(r.balance_due ?? 0), 0);
  const overdueCount   = receivables.filter(
    r => r.status === "overdue" ||
         (r.due_date != null && r.due_date < todayStr && r.status !== "paid" && r.status !== "cancelled")
  ).length;

  const purchasesPending = (purchasesPendingRaw ?? []).length;

  const lowStockCount = (lowStockRaw ?? []).filter(
    (r: any) => r.product?.is_active !== false
  ).length;

  // ── Date label ─────────────────────────────────────────────────────────
  const dateLabel = todayLabelEC();

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-end justify-between">
        <div>
          <p className="hud-readout">Centro operativo</p>
          <h1 className="mt-0.5 font-display text-[28px] leading-none tracking-[0.02em] text-foreground sm:text-[32px]">
            {dateLabel}
          </h1>
        </div>
        <p className="hidden font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:block">
          {membership.tenants?.business_name ?? "SaturLub"}
        </p>
      </div>

      {/* ── Quick actions ────────────────────────────────────────────────── */}
      <section>
        <p className="hud-readout mb-3">Acciones rápidas</p>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <QuickAction
            href="/dashboard/pos"
            label="Nueva venta"
            accent
            icon={
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
                <path d="M3 6h18" />
                <path d="M16 10a4 4 0 0 1-8 0" />
              </svg>
            }
          />
          <QuickAction
            href="/dashboard/pos/caja"
            label={hasOpenSession ? "Cerrar caja" : "Abrir caja"}
            icon={
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 7l1-4h14l1 4" />
                <rect x="2" y="7" width="20" height="13" rx="1" />
                <path d="M16 12h.01M12 12h.01M8 12h.01" />
                <path d="M6 7v13" />
              </svg>
            }
          />
          <QuickAction
            href="/dashboard/pos/fiado"
            label="Registrar abono"
            icon={
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="5" width="20" height="14" rx="2" />
                <path d="M2 10h20" />
                <path d="M6 15h4" />
              </svg>
            }
          />
          <QuickAction
            href="/dashboard/compras/nueva"
            label="Nueva compra"
            icon={
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                <rect x="9" y="3" width="6" height="4" rx="1" />
                <path d="M9 12h6M9 16h4" />
              </svg>
            }
          />
        </div>
      </section>

      {/* ── Estado del día ───────────────────────────────────────────────── */}
      <section>
        <p className="hud-readout mb-3">Estado del día</p>
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <StatTile
            label="Caja"
            value={hasOpenSession ? "Abierta" : "Cerrada"}
            sub={
              hasOpenSession
                ? `Apertura ${moneyFmt.format(openingAmount)}`
                : "Sin sesión activa"
            }
            valueClass={hasOpenSession ? "text-emerald-400" : "text-muted-foreground"}
            href="/dashboard/pos/caja"
          />
          <StatTile
            label="Ventas hoy"
            value={moneyFmt.format(todayTotal)}
            sub={`${todayCount} venta${todayCount !== 1 ? "s" : ""} confirmada${todayCount !== 1 ? "s" : ""}`}
            href="/dashboard/pos/ventas"
          />
          <StatTile
            label="Fiados"
            value={fiadoCount > 0 ? moneyFmt.format(fiadoBalance) : "—"}
            sub={
              fiadoCount > 0
                ? `${fiadoCount} cuenta${fiadoCount !== 1 ? "s" : ""} pendiente${fiadoCount !== 1 ? "s" : ""}`
                : "Sin saldos abiertos"
            }
            valueClass={fiadoCount > 0 ? "text-amber-400" : undefined}
            href="/dashboard/pos/fiado"
          />
          <StatTile
            label="Stock bajo"
            value={lowStockCount > 0 ? String(lowStockCount) : "—"}
            sub={
              lowStockCount > 0
                ? `producto${lowStockCount !== 1 ? "s" : ""} por reponer`
                : "Stock normal"
            }
            valueClass={lowStockCount > 0 ? "text-red-400" : undefined}
            href="/dashboard/inventario/stock"
          />
        </div>
      </section>

      {/* ── Pendientes + Atajos ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-3">

        {/* Pendientes */}
        <section className="panel rounded-sm lg:col-span-2">
          <header className="top-highlight border-b border-steel-700 bg-steel-900/70 px-5 py-3">
            <h2 className="font-display text-[16px] leading-none tracking-[0.04em] text-foreground">
              PENDIENTES
            </h2>
          </header>
          <div className="divide-y divide-steel-800">
            <PendingRow
              href="/dashboard/pos/fiado"
              label="Cuentas vencidas"
              count={overdueCount}
              alert={overdueCount > 0}
            />
            <PendingRow
              href="/dashboard/compras"
              label="Compras por pagar"
              count={purchasesPending}
              alert={purchasesPending > 0}
            />
            <PendingRow
              href="/dashboard/orders"
              label="Órdenes activas"
              count={null}
            />
          </div>
        </section>

        {/* Atajos secundarios */}
        <section className="panel rounded-sm">
          <header className="top-highlight border-b border-steel-700 bg-steel-900/70 px-5 py-3">
            <h2 className="font-display text-[16px] leading-none tracking-[0.04em] text-foreground">
              ATAJOS
            </h2>
          </header>
          <div className="divide-y divide-steel-800">
            <ShortcutRow
              href="/dashboard/clientes"
              label="Clientes"
              icon={
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
                </svg>
              }
            />
            <ShortcutRow
              href="/dashboard/inventario/productos"
              label="Productos"
              icon={
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  <path d="M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12" />
                </svg>
              }
            />
            <ShortcutRow
              href="/dashboard/inventario/stock"
              label="Existencias"
              icon={
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 3v18h18" />
                  <rect x="7" y="10" width="3" height="8" rx="0.5" />
                  <rect x="12" y="6" width="3" height="12" rx="0.5" />
                  <rect x="17" y="3" width="3" height="15" rx="0.5" />
                </svg>
              }
            />
          </div>
        </section>

      </div>
    </div>
  );
}

// ── Components ─────────────────────────────────────────────────────────────

function QuickAction({
  href,
  label,
  icon,
  accent = false,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex min-h-[72px] flex-col justify-between rounded-sm border-l-2 p-4 transition-all duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-offset-2 focus-visible:ring-offset-steel-950",
        accent
          ? "border-safety-500 bg-steel-800 hover:bg-steel-700"
          : "border-steel-700 bg-steel-900 hover:border-steel-500 hover:bg-steel-800/60"
      )}
    >
      <span className={cn(accent ? "text-safety-500" : "text-muted-foreground group-hover:text-foreground")}>
        {icon}
      </span>
      <span
        className={cn(
          "font-mono text-[11px] font-bold uppercase tracking-[0.14em]",
          accent ? "text-safety-500" : "text-foreground"
        )}
      >
        {label}
      </span>
    </Link>
  );
}

function StatTile({
  label,
  value,
  sub,
  valueClass,
  href,
}: {
  label: string;
  value: string;
  sub: string;
  valueClass?: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="panel group rounded-sm p-5 transition-colors duration-150 hover:border-steel-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-offset-2 focus-visible:ring-offset-steel-950"
    >
      <p className="hud-readout">{label}</p>
      <p
        className={cn(
          "mt-2 truncate font-display text-[22px] leading-none tracking-[0.02em]",
          valueClass ?? "text-foreground"
        )}
      >
        {value}
      </p>
      <p className="mt-1.5 truncate font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {sub}
      </p>
    </Link>
  );
}

function PendingRow({
  href,
  label,
  count,
  alert = false,
}: {
  href: string;
  label: string;
  count: number | null;
  alert?: boolean;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-[52px] items-center justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-steel-900/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-inset"
    >
      <span className="font-mono text-[12px] font-semibold uppercase tracking-[0.12em] text-foreground">
        {label}
      </span>
      <span
        className={cn(
          "min-w-[28px] rounded-sm px-2 py-0.5 text-center font-mono text-[12px] font-bold tabular-nums",
          count === null
            ? "bg-steel-800 text-muted-foreground"
            : alert && count > 0
              ? "bg-red-900/50 text-red-300"
              : count > 0
                ? "bg-steel-800 text-foreground"
                : "bg-steel-800 text-muted-foreground"
        )}
      >
        {count === null ? "—" : count}
      </span>
    </Link>
  );
}

function ShortcutRow({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-[52px] items-center gap-3 px-5 py-3.5 text-muted-foreground transition-colors hover:bg-steel-900/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-inset"
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 font-mono text-[12px] font-semibold uppercase tracking-[0.12em]">
        {label}
      </span>
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18l6-6-6-6" />
      </svg>
    </Link>
  );
}
