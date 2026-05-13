import { getActiveMembership } from "@/lib/supabase/membership";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ReceivableTable } from "./receivable-table";
import type { ReceivableRow } from "@/lib/validations/receivable";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Fiado — Cuentas por cobrar | SaturLub",
  description: "Gestiona las ventas fiadas y registra abonos de clientes.",
};

export const dynamic = "force-dynamic";

export default async function FiadoPage() {
  const { user, membership } = await getActiveMembership();
  if (!user || !membership) redirect("/auth/login");

  const supabase = await createClient();

  const [{ data: receivables }, { data: cashSessionData }] = await Promise.all([
    supabase
      .from("v_customer_receivables")
      .select("*")
      .eq("tenant_id", membership.tenant_id)
      .order("created_at", { ascending: false }),
    supabase
      .from("cash_sessions")
      .select("id")
      .eq("tenant_id", membership.tenant_id)
      .eq("status", "open")
      .limit(1)
      .maybeSingle(),
  ]);

  const rows = (receivables ?? []) as ReceivableRow[];
  const cashSessionId: string | null = cashSessionData?.id ?? null;

  // Summary stats
  const totalPending = rows
    .filter((r) => r.status !== "paid" && r.status !== "cancelled")
    .reduce((s, r) => s + r.balance_due, 0);
  const countOverdue = rows.filter((r) => r.is_overdue && r.status !== "paid").length;
  const countActive  = rows.filter((r) => r.status === "pending" || r.status === "partial").length;

  const moneyFmt = new Intl.NumberFormat("es-EC", {
    style: "currency", currency: "USD", minimumFractionDigits: 2,
  });

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="font-display text-[22px] font-bold tracking-tight text-foreground">
          Cuentas por cobrar
        </h1>
        <p className="mt-0.5 font-mono text-[12px] text-muted-foreground">
          Ventas fiadas con saldo pendiente — registra abonos y controla el historial.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="Saldo total por cobrar"
          value={moneyFmt.format(totalPending)}
          tone={totalPending > 0 ? "warning" : "neutral"}
        />
        <KpiCard
          label="Cuentas activas"
          value={String(countActive)}
          tone="neutral"
        />
        <KpiCard
          label="Vencidas"
          value={String(countOverdue)}
          tone={countOverdue > 0 ? "error" : "neutral"}
        />
      </div>

      {/* Table */}
      <ReceivableTable initialRows={rows} cashSessionId={cashSessionId} />
    </div>
  );
}

function KpiCard({
  label, value, tone,
}: {
  label: string;
  value: string;
  tone: "neutral" | "warning" | "error";
}) {
  const tones = {
    neutral: "border-steel-700 bg-steel-900/40",
    warning: "border-signal-600/40 bg-signal-700/10",
    error:   "border-red-500/30 bg-red-500/5",
  };
  const valueColors = {
    neutral: "text-foreground",
    warning: "text-signal-400",
    error:   "text-red-400",
  };
  return (
    <div className={["panel rounded-sm border px-5 py-4", tones[tone]].join(" ")}>
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground/60">{label}</p>
      <p className={["mt-1.5 font-display text-[28px] leading-none font-bold tabular-nums", valueColors[tone]].join(" ")}>
        {value}
      </p>
    </div>
  );
}
