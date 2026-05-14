import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Conteo físico · Inventario | SaturLub" };
export const dynamic = "force-dynamic";

const dateFmt = new Intl.DateTimeFormat("es-EC", {
  day: "2-digit", month: "short", year: "numeric",
  hour: "2-digit", minute: "2-digit",
});

export default async function ConteoPage() {
  const { user, membership } = await getActiveMembership();
  if (!user)       redirect("/login");
  if (!membership) redirect("/onboarding");

  const supabase = await createClient();
  const tenantId = membership.tenant_id;

  // Load sessions with warehouse name and per-session line aggregates
  const { data: sessions } = await supabase
    .from("stock_count_sessions")
    .select(`
      id, status, notes, created_by, closed_by, closed_at, created_at,
      warehouses ( id, name )
    `)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(50);

  // Load line stats per session (counted, total, with_diff)
  const sessionIds = (sessions ?? []).map((s) => s.id as string);
  type LineStat = { session_id: string; qty_system: number; qty_counted: number | null };

  let lineStats: LineStat[] = [];
  if (sessionIds.length > 0) {
    const { data } = await supabase
      .from("stock_count_lines")
      .select("session_id, qty_system, qty_counted")
      .eq("tenant_id", tenantId)
      .in("session_id", sessionIds);
    lineStats = ((data ?? []) as unknown as LineStat[]);
  }

  // Group line stats by session
  const statsBySession = new Map<string, { total: number; counted: number; diffs: number }>();
  for (const l of lineStats) {
    const sid = l.session_id;
    if (!statsBySession.has(sid)) statsBySession.set(sid, { total: 0, counted: 0, diffs: 0 });
    const s = statsBySession.get(sid)!;
    s.total++;
    if (l.qty_counted !== null) {
      s.counted++;
      if (Math.round(Number(l.qty_counted) * 10000) !== Math.round(Number(l.qty_system) * 10000)) {
        s.diffs++;
      }
    }
  }

  const active = (sessions ?? []).filter((s) => s.status === "in_progress");
  const closed = (sessions ?? []).filter((s) => s.status === "closed");
  const canManage = membership.role === "owner" || membership.role === "admin";

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8">
      {/* Header */}
      <header className="space-y-2">
        <span className="hud-readout">Inventario · Auditoría</span>
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-[32px] leading-none tracking-[0.02em] text-foreground sm:text-[40px]">
              CONTEO FÍSICO
            </h1>
            <p className="mt-1 max-w-xl text-[13px] leading-5 text-muted-foreground">
              Sesiones de inventario por bodega. Al cerrar, los ajustes se aplican automáticamente
              y quedan registrados en el kárdex con trazabilidad completa.
            </p>
          </div>
          {canManage ? (
            <Link
              href="/dashboard/inventario/conteo/nueva"
              className="shrink-0 inline-flex items-center gap-2 rounded-sm border border-safety-500 bg-safety-500/10 px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-safety-500 transition-colors hover:bg-safety-500/20"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              Nueva sesión
            </Link>
          ) : null}
        </div>
      </header>

      {/* Active sessions */}
      {active.length > 0 ? (
        <section className="space-y-3">
          <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-safety-500/80">
            En progreso — {active.length}
          </h2>
          <div className="space-y-2">
            {active.map((s) => {
              const wh = s.warehouses as unknown as { id: string; name: string } | null;
              const st = statsBySession.get(s.id as string) ?? { total: 0, counted: 0, diffs: 0 };
              return (
                <Link
                  key={s.id as string}
                  href={`/dashboard/inventario/conteo/${s.id}`}
                  className="flex items-center justify-between gap-4 rounded-sm border border-safety-500/30 bg-safety-500/5 px-5 py-4 transition-colors hover:border-safety-500/50 hover:bg-safety-500/10"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge tone="warning">En progreso</Badge>
                      <span className="font-semibold text-foreground">{wh?.name ?? "Bodega"}</span>
                    </div>
                    <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/60">
                      Iniciado {dateFmt.format(new Date(s.created_at as string))}
                      {s.notes ? ` · ${s.notes}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-4 text-right">
                    <StatPill label="Total" value={st.total} />
                    <StatPill label="Contados" value={st.counted} tone="ok" />
                    <StatPill label="Diferencias" value={st.diffs} tone={st.diffs > 0 ? "warn" : "ok"} />
                    <ChevronIcon className="h-4 w-4 text-muted-foreground/40" />
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ) : (
        <div className="rounded-sm border border-dashed border-steel-700 px-6 py-8 text-center">
          <p className="font-mono text-[12px] text-muted-foreground/60">
            No hay sesiones de conteo en progreso.
          </p>
          {canManage ? (
            <Link
              href="/dashboard/inventario/conteo/nueva"
              className="mt-3 inline-flex items-center gap-1.5 font-mono text-[11px] text-safety-500 hover:underline"
            >
              <PlusIcon className="h-3 w-3" />
              Iniciar un conteo físico
            </Link>
          ) : null}
        </div>
      )}

      {/* Closed sessions */}
      {closed.length > 0 ? (
        <section className="space-y-3">
          <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground/60">
            Cerradas — {closed.length}
          </h2>
          <div className="panel overflow-hidden rounded-sm">
            <table className="w-full text-left">
              <thead className="border-b border-steel-800 bg-steel-900/50">
                <tr>
                  <Th>Bodega</Th>
                  <Th className="hidden sm:table-cell">Fecha cierre</Th>
                  <Th className="text-right">Productos</Th>
                  <Th className="text-right">Contados</Th>
                  <Th className="text-right">Ajustes</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {closed.map((s) => {
                  const wh = s.warehouses as unknown as { id: string; name: string } | null;
                  const st = statsBySession.get(s.id as string) ?? { total: 0, counted: 0, diffs: 0 };
                  return (
                    <tr key={s.id as string} className="border-b border-steel-800/60 last:border-b-0 hover:bg-steel-900/40">
                      <Td>
                        <div className="flex items-center gap-2">
                          <Badge tone="neutral">Cerrada</Badge>
                          <span className="font-medium text-foreground">{wh?.name ?? "—"}</span>
                        </div>
                        {s.notes ? (
                          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/60">{s.notes}</p>
                        ) : null}
                      </Td>
                      <Td className="hidden sm:table-cell">
                        <span className="font-mono text-[12px] text-muted-foreground">
                          {s.closed_at ? dateFmt.format(new Date(s.closed_at as string)) : "—"}
                        </span>
                      </Td>
                      <Td className="text-right">
                        <span className="font-mono text-[13px] tabular-nums text-foreground">{st.total}</span>
                      </Td>
                      <Td className="text-right">
                        <span className="font-mono text-[13px] tabular-nums text-muted-foreground">{st.counted}</span>
                      </Td>
                      <Td className="text-right">
                        <span className={`font-mono text-[13px] tabular-nums font-bold ${st.diffs > 0 ? "text-signal-400" : "text-muted-foreground/40"}`}>
                          {st.diffs > 0 ? st.diffs : "—"}
                        </span>
                      </Td>
                      <Td className="text-right">
                        <Link
                          href={`/dashboard/inventario/conteo/${s.id}`}
                          className="font-mono text-[10px] text-muted-foreground/60 hover:text-safety-500"
                        >
                          Ver →
                        </Link>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function StatPill({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" }) {
  return (
    <div className="text-right">
      <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground/50">{label}</p>
      <p className={`font-mono text-[15px] font-bold tabular-nums ${tone === "ok" && value > 0 ? "text-emerald-400" : tone === "warn" && value > 0 ? "text-signal-400" : "text-foreground"}`}>
        {value}
      </p>
    </div>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={"px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground " + (className ?? "")}>
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={"px-5 py-3.5 align-top " + (className ?? "")}>{children}</td>;
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

import * as React from "react";
