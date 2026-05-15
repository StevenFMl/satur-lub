import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { getPosPermissions } from "@/lib/auth/permissions";
import { CashSessionPanel } from "./cash-session-panel";

export const metadata: Metadata = { title: "Caja · SaturLub" };
export const dynamic = "force-dynamic";

// ── Shared types ────────────────────────────────────────────────────────────

export type CashMovementRow = {
  id:             string;
  movement_type:  string;
  direction:      number;
  amount:         number;
  reason:         string;
  reference_type: string | null;
  reference_id:   string | null;
  created_at:     string;
};

export type CashSessionData = {
  id:             string;
  warehouse_id:   string | null;
  warehouse_name: string | null;
  status:         "open" | "closed";
  opened_at:      string;
  opening_amount: number;
  closed_at:      string | null;
  counted_cash:   number | null;
  expected_cash:  number | null;
  variance:       number | null;
  notes:          string | null;
  movements:      CashMovementRow[];
  // Computed
  running_expected: number;   // opening_amount + sum(direction * amount)
};

export type PosWarehouseForCaja = { id: string; name: string };

export type PastSessionRow = {
  id:             string;
  warehouse_name: string | null;
  status:         "open" | "closed";
  opened_at:      string;
  closed_at:      string | null;
  opening_amount: number;
  expected_cash:  number | null;
  counted_cash:   number | null;
  variance:       number | null;
  notes:          string | null;
};

export default async function CajaPage() {
  const { user, membership } = await getActiveMembership();
  if (!user) redirect("/login");
  if (!membership) redirect("/onboarding");

  const permissions = getPosPermissions(membership.role);
  if (!permissions.canUsePOS) redirect("/dashboard");

  const supabase   = await createClient();
  const tenantId   = membership.tenant_id;

  // ── Warehouses ──────────────────────────────────────────────
  const { data: rawWarehouses } = await supabase
    .from("warehouses")
    .select("id, name")
    .order("name");

  const warehouses: PosWarehouseForCaja[] = (rawWarehouses ?? []).map((w) => ({
    id:   w.id as string,
    name: w.name as string,
  }));

  // ── Most recent session (open or last closed) ──────────────
  const { data: rawSession } = await supabase
    .from("cash_sessions")
    .select(`
      id, warehouse_id, status, opened_at, opening_amount,
      closed_at, counted_cash, expected_cash, variance, notes,
      warehouses!warehouse_id(name)
    `)
    .eq("tenant_id", tenantId)
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let session: CashSessionData | null = null;

  if (rawSession) {
    const sid = rawSession.id as string;

    const { data: rawMoves } = await supabase
      .from("cash_movements")
      .select("id, movement_type, direction, amount, reason, reference_type, reference_id, created_at")
      .eq("cash_session_id", sid)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true });

    const movements: CashMovementRow[] = (rawMoves ?? []).map((m: any) => ({
      id:             m.id as string,
      movement_type:  m.movement_type as string,
      direction:      Number(m.direction ?? 1),
      amount:         Number(m.amount ?? 0),
      reason:         m.reason as string,
      reference_type: m.reference_type as string | null,
      reference_id:   m.reference_id as string | null,
      created_at:     m.created_at as string,
    }));

    const openingAmount = Number(rawSession.opening_amount ?? 0);
    const runningExpected = movements.reduce(
      (acc, m) => acc + m.direction * m.amount,
      openingAmount
    );

    session = {
      id:               rawSession.id as string,
      warehouse_id:     rawSession.warehouse_id as string | null,
      warehouse_name:   (rawSession.warehouses as any)?.name ?? null,
      status:           rawSession.status as "open" | "closed",
      opened_at:        rawSession.opened_at as string,
      opening_amount:   openingAmount,
      closed_at:        rawSession.closed_at as string | null,
      counted_cash:     rawSession.counted_cash != null ? Number(rawSession.counted_cash) : null,
      expected_cash:    rawSession.expected_cash != null ? Number(rawSession.expected_cash) : null,
      variance:         rawSession.variance != null ? Number(rawSession.variance) : null,
      notes:            rawSession.notes as string | null,
      movements,
      running_expected: runningExpected,
    };
  }

  // ── Past sessions (excluding the most recent) ────────────────
  let pastSessions: PastSessionRow[] = [];
  if (rawSession) {
    const { data: pastData } = await supabase
      .from("cash_sessions")
      .select(`
        id, status, opened_at, closed_at,
        opening_amount, expected_cash, counted_cash, variance, notes,
        warehouses!warehouse_id(name)
      `)
      .eq("tenant_id", tenantId)
      .neq("id", rawSession.id as string)
      .order("opened_at", { ascending: false })
      .limit(30);

    pastSessions = (pastData ?? []).map((s: any) => ({
      id:             s.id as string,
      warehouse_name: s.warehouses?.name ?? null,
      status:         s.status as "open" | "closed",
      opened_at:      s.opened_at as string,
      closed_at:      s.closed_at as string | null,
      opening_amount: Number(s.opening_amount ?? 0),
      expected_cash:  s.expected_cash  != null ? Number(s.expected_cash)  : null,
      counted_cash:   s.counted_cash   != null ? Number(s.counted_cash)   : null,
      variance:       s.variance       != null ? Number(s.variance)       : null,
      notes:          s.notes as string | null,
    }));
  }

  return (
    <CashSessionPanel
      session={session}
      warehouses={warehouses}
      permissions={permissions}
      pastSessions={pastSessions}
    />
  );
}
