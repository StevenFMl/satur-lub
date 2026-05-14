"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { updateCountLinesAction, closeCountSessionAction } from "@/actions/inventory";

// ── Types ───────────────────────────────────────────────────────────────────

export type CountLine = {
  id:           string;
  product_id:   string;
  product_name: string;
  product_sku:  string;
  product_unit: string;
  qty_system:   number;
  qty_counted:  number | null;
  note:         string | null;
};

type LineState = CountLine & {
  input:     string;  // controlled input value (string)
  noteInput: string;
  dirty:     boolean; // modified but not yet saved
};

// ── Formatters ──────────────────────────────────────────────────────────────

const numFmt = new Intl.NumberFormat("es-EC", {
  minimumFractionDigits: 0, maximumFractionDigits: 4,
});
const dateFmt = new Intl.DateTimeFormat("es-EC", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
});

function fmtDelta(delta: number): string {
  return (delta >= 0 ? "+" : "") + numFmt.format(delta);
}

// ── Component ───────────────────────────────────────────────────────────────

type Filter = "all" | "uncounted" | "diff" | "ok";

export function CountSheet({
  sessionId, warehouseName, sessionStatus, sessionNotes,
  createdAt, closedAt, initialLines, canManage,
}: {
  sessionId:     string;
  warehouseName: string;
  sessionStatus: "in_progress" | "closed";
  sessionNotes:  string | null;
  createdAt:     string;
  closedAt:      string | null;
  initialLines:  CountLine[];
  canManage:     boolean;
}) {
  const router = useRouter();

  const initLineStates = (): LineState[] =>
    initialLines.map((l) => ({
      ...l,
      input:     l.qty_counted !== null ? String(l.qty_counted) : "",
      noteInput: l.note ?? "",
      dirty:     false,
    }));

  const [lines, setLines] = React.useState<LineState[]>(initLineStates);
  const [filter, setFilter] = React.useState<Filter>("all");
  const [query, setQuery]   = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [closing, setClosing] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [error, setError]   = React.useState<string | null>(null);
  const [closeResult, setCloseResult] = React.useState<{
    adjustmentsApplied: number; linesTotal: number; linesCounted: number;
  } | null>(null);

  const isClosed = sessionStatus === "closed";

  // ── Derived stats ─────────────────────────────────────────────────────
  const stats = React.useMemo(() => {
    let total = 0, counted = 0, diffs = 0, uncounted = 0;
    for (const l of lines) {
      total++;
      const counted_val = l.input !== "" ? parseFloat(l.input) : null;
      if (counted_val !== null && isFinite(counted_val)) {
        counted++;
        if (Math.round(counted_val * 10000) !== Math.round(l.qty_system * 10000)) diffs++;
      } else {
        uncounted++;
      }
    }
    return { total, counted, diffs, uncounted };
  }, [lines]);

  const hasDirty = lines.some((l) => l.dirty);

  // ── Filter + search ──────────────────────────────────────────────────
  const displayed = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return lines.filter((l) => {
      if (q && !l.product_name.toLowerCase().includes(q) && !l.product_sku.toLowerCase().includes(q)) {
        return false;
      }
      const qc = l.input !== "" ? parseFloat(l.input) : null;
      const isDiff = qc !== null && isFinite(qc)
        && Math.round(qc * 10000) !== Math.round(l.qty_system * 10000);
      if (filter === "uncounted") return qc === null || !isFinite(qc);
      if (filter === "diff")      return isDiff;
      if (filter === "ok")        return qc !== null && isFinite(qc) && !isDiff;
      return true;
    });
  }, [lines, filter, query]);

  // ── Line updates ──────────────────────────────────────────────────────
  const updateInput = (id: string, val: string) => {
    setLines((prev) => prev.map((l) => l.id === id ? { ...l, input: val, dirty: true } : l));
  };
  const updateNote = (id: string, val: string) => {
    setLines((prev) => prev.map((l) => l.id === id ? { ...l, noteInput: val, dirty: true } : l));
  };

  // ── Save progress ──────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true); setError(null);
    const toSave = lines
      .filter((l) => l.dirty)
      .map((l) => {
        const n = parseFloat(l.input);
        return {
          id:          l.id,
          qty_counted: l.input !== "" && isFinite(n) ? n : null,
          note:        l.noteInput.trim() || null,
        };
      });

    if (toSave.length === 0) { setSaving(false); return; }

    const res = await updateCountLinesAction(sessionId, toSave);
    setSaving(false);
    if (res?.error) { setError(res.error); return; }
    setLines((prev) => prev.map((l) => ({ ...l, dirty: false })));
  };

  // ── Close session ─────────────────────────────────────────────────────
  const handleClose = async () => {
    // Save dirty lines first
    if (hasDirty) await handleSave();
    setClosing(true); setError(null);
    const res = await closeCountSessionAction(sessionId);
    setClosing(false);
    if (res?.error) { setError(res.error); setConfirmOpen(false); return; }
    setCloseResult({
      adjustmentsApplied: res?.adjustmentsApplied ?? 0,
      linesTotal:          res?.linesTotal          ?? 0,
      linesCounted:        res?.linesCounted         ?? 0,
    });
    setConfirmOpen(false);
    router.refresh();
  };

  // ── Close result success screen ───────────────────────────────────────
  if (closeResult) {
    return (
      <div className="mx-auto w-full max-w-lg space-y-6 py-12 text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full border-2 border-emerald-500/50 bg-emerald-500/10">
          <span className="font-mono text-[22px] font-bold text-emerald-400">✓</span>
        </div>
        <div>
          <p className="font-display text-[20px] font-bold text-foreground">Conteo cerrado</p>
          <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{warehouseName}</p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <ResultCard label="Productos" value={closeResult.linesTotal} />
          <ResultCard label="Contados"  value={closeResult.linesCounted} tone="ok" />
          <ResultCard label="Ajustes"   value={closeResult.adjustmentsApplied} tone={closeResult.adjustmentsApplied > 0 ? "warn" : "ok"} />
        </div>
        <p className="font-mono text-[11px] text-muted-foreground/60">
          Cada ajuste quedó registrado en el kárdex con motivo "Conteo físico".
        </p>
        <div className="flex justify-center gap-3">
          <Link
            href="/dashboard/inventario/movimientos?type=adjustment"
            className="font-mono text-[10px] text-safety-500 hover:underline uppercase tracking-[0.12em]"
          >
            Ver ajustes en kárdex →
          </Link>
          <Link
            href="/dashboard/inventario/conteo"
            className="font-mono text-[10px] text-muted-foreground/60 hover:text-muted-foreground uppercase tracking-[0.12em]"
          >
            Volver a sesiones
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div>
        <Link
          href="/dashboard/inventario/conteo"
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
        >
          ← Sesiones de conteo
        </Link>
      </div>

      <header className="space-y-1.5">
        <div className="flex items-center gap-3">
          {isClosed
            ? <Badge tone="neutral">Cerrada</Badge>
            : <Badge tone="warning">En progreso</Badge>}
          <span className="hud-readout">Conteo físico · {warehouseName}</span>
        </div>
        <h1 className="font-display text-[28px] leading-none tracking-[0.02em] text-foreground sm:text-[34px]">
          {warehouseName.toUpperCase()}
        </h1>
        <p className="font-mono text-[11px] text-muted-foreground/60">
          Iniciado {dateFmt.format(new Date(createdAt))}
          {closedAt ? ` · Cerrado ${dateFmt.format(new Date(closedAt))}` : ""}
          {sessionNotes ? ` · ${sessionNotes}` : ""}
        </p>
      </header>

      {/* ── Summary bar ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryTile label="Total productos" value={stats.total} />
        <SummaryTile label="Contados"        value={stats.counted} accent={stats.counted === stats.total ? "green" : undefined} />
        <SummaryTile label="Con diferencia"  value={stats.diffs}   accent={stats.diffs > 0 ? "orange" : "green"} />
        <SummaryTile label="Sin contar"      value={stats.uncounted} accent={stats.uncounted > 0 ? "yellow" : "green"} />
      </div>

      {/* ── Progress bar ─────────────────────────────────────────────────── */}
      {stats.total > 0 ? (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-steel-800">
          <div
            className="h-full rounded-full bg-safety-500 transition-all duration-300"
            style={{ width: `${Math.round((stats.counted / stats.total) * 100)}%` }}
          />
        </div>
      ) : null}

      {error ? <Alert tone="error">{error}</Alert> : null}

      {/* ── Filters + search ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {([
            { key: "all",       label: "Todos",         count: stats.total     },
            { key: "uncounted", label: "Sin contar",    count: stats.uncounted },
            { key: "diff",      label: "Con diferencia",count: stats.diffs     },
            { key: "ok",        label: "Iguales",       count: stats.counted - stats.diffs },
          ] as { key: Filter; label: string; count: number }[]).map(({ key, label, count }) => (
            <button
              key={key} type="button"
              onClick={() => setFilter(key)}
              className={[
                "flex items-center gap-1.5 rounded-sm border px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.1em] transition-colors",
                filter === key
                  ? "border-safety-500 bg-safety-500/10 text-safety-500"
                  : "border-steel-700 text-muted-foreground hover:border-steel-600 hover:text-foreground",
              ].join(" ")}
            >
              {label}
              <span className={`rounded-full px-1 font-mono text-[9px] ${filter === key ? "bg-safety-500/20 text-safety-500" : "bg-steel-700 text-muted-foreground"}`}>
                {count}
              </span>
            </button>
          ))}
        </div>
        <div className="relative max-w-xs">
          <input
            type="text"
            value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar producto o SKU…"
            className="h-9 w-full rounded-sm border border-steel-700 bg-steel-900 pl-3 pr-3 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/40 focus:border-safety-500 focus:outline-none"
          />
        </div>
      </div>

      {/* ── Count table ──────────────────────────────────────────────────── */}
      <div className="panel overflow-hidden rounded-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-b-2 border-steel-700 bg-steel-900/70">
              <tr>
                <Th>Producto</Th>
                <Th className="text-right">Stock sistema</Th>
                <Th className="text-right min-w-[130px]">Conteo físico</Th>
                <Th className="text-right">Diferencia</Th>
                <Th className="hidden lg:table-cell">Comentario</Th>
              </tr>
            </thead>
            <tbody>
              {displayed.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-[13px] text-muted-foreground">
                    Sin productos para los filtros seleccionados.
                  </td>
                </tr>
              ) : (
                displayed.map((l) => {
                  const counted = l.input !== "" ? parseFloat(l.input) : null;
                  const validCounted = counted !== null && isFinite(counted);
                  const delta = validCounted ? counted - l.qty_system : null;
                  const hasDiff = delta !== null && Math.round(delta * 10000) !== 0;
                  return (
                    <tr
                      key={l.id}
                      className={[
                        "border-b border-steel-800/60 last:border-b-0",
                        hasDiff ? "bg-signal-900/10" : "",
                      ].join(" ")}
                    >
                      {/* Product */}
                      <Td>
                        <div className="font-semibold text-foreground">{l.product_name}</div>
                        <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/60">
                          {l.product_sku} · {l.product_unit}
                        </div>
                      </Td>

                      {/* System qty */}
                      <Td className="text-right">
                        <span className="font-mono text-[14px] tabular-nums text-muted-foreground">
                          {numFmt.format(l.qty_system)}
                        </span>
                        <div className="font-mono text-[9px] text-muted-foreground/40">{l.product_unit}</div>
                      </Td>

                      {/* Count input */}
                      <Td className="text-right">
                        {isClosed ? (
                          <span className={`font-mono text-[14px] font-bold tabular-nums ${validCounted ? "text-foreground" : "text-muted-foreground/30"}`}>
                            {validCounted ? numFmt.format(counted!) : "—"}
                          </span>
                        ) : (
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            value={l.input}
                            onChange={(e) => updateInput(l.id, e.target.value)}
                            onFocus={(e) => e.target.select()}
                            placeholder={numFmt.format(l.qty_system)}
                            mono
                            className={[
                              "w-[110px] text-right text-[13px]",
                              l.dirty ? "border-safety-500/60" : "",
                            ].join(" ")}
                          />
                        )}
                      </Td>

                      {/* Delta */}
                      <Td className="text-right">
                        {delta !== null ? (
                          <span className={[
                            "font-mono text-[13px] font-bold tabular-nums",
                            !hasDiff ? "text-emerald-400/70"
                              : delta > 0 ? "text-emerald-400"
                              : "text-red-400",
                          ].join(" ")}>
                            {hasDiff ? fmtDelta(delta) : "="}
                          </span>
                        ) : (
                          <span className="font-mono text-[11px] text-muted-foreground/30">—</span>
                        )}
                      </Td>

                      {/* Note */}
                      <Td className="hidden lg:table-cell">
                        {isClosed ? (
                          <span className="text-[11px] text-muted-foreground/60">{l.note ?? "—"}</span>
                        ) : (
                          <input
                            type="text"
                            value={l.noteInput}
                            onChange={(e) => updateNote(l.id, e.target.value)}
                            maxLength={120}
                            placeholder="Comentario…"
                            className="h-7 w-full rounded-sm border border-steel-700/60 bg-steel-900/60 px-2 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/30 focus:border-steel-600 focus:outline-none"
                          />
                        )}
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Action buttons ───────────────────────────────────────────────── */}
      {!isClosed && canManage ? (
        <div className="flex flex-col gap-3 border-t border-steel-700 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            {hasDirty ? (
              <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-safety-500/80">
                Hay cambios sin guardar
              </span>
            ) : null}
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              size="md"
              loading={saving}
              disabled={!hasDirty || saving || closing}
              onClick={handleSave}
            >
              Guardar progreso
            </Button>
            <Button
              size="md"
              loading={closing}
              disabled={saving || closing || stats.counted === 0}
              onClick={() => setConfirmOpen(true)}
              className="border-safety-500/60 bg-safety-500/10 text-safety-500 hover:bg-safety-500/20"
            >
              Cerrar y aplicar ajustes
            </Button>
          </div>
        </div>
      ) : isClosed ? (
        <div className="flex justify-end gap-3 border-t border-steel-700 pt-5">
          <Link
            href="/dashboard/inventario/movimientos?type=adjustment"
            className="font-mono text-[11px] text-safety-500 hover:underline uppercase tracking-[0.12em]"
          >
            Ver ajustes en kárdex →
          </Link>
        </div>
      ) : null}

      {/* ── Close confirmation dialog ─────────────────────────────────────── */}
      <Dialog
        open={confirmOpen}
        onClose={() => !closing && setConfirmOpen(false)}
        title="¿Cerrar sesión de conteo?"
        description={`Se aplicarán ${stats.diffs} ajuste${stats.diffs !== 1 ? "s" : ""} en inventario. Esta acción no se puede deshacer.`}
      >
        <div className="space-y-4 px-6 py-5">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-sm border border-steel-700 px-3 py-2.5">
              <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground/60">Contados</p>
              <p className="mt-0.5 font-mono text-[18px] font-bold text-foreground">{stats.counted}</p>
            </div>
            <div className="rounded-sm border border-steel-700 px-3 py-2.5">
              <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground/60">Sin contar</p>
              <p className={`mt-0.5 font-mono text-[18px] font-bold ${stats.uncounted > 0 ? "text-yellow-400" : "text-foreground"}`}>
                {stats.uncounted}
              </p>
            </div>
            <div className="rounded-sm border border-signal-700/40 bg-signal-700/10 px-3 py-2.5">
              <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground/60">Ajustes</p>
              <p className={`mt-0.5 font-mono text-[18px] font-bold ${stats.diffs > 0 ? "text-signal-400" : "text-muted-foreground/40"}`}>
                {stats.diffs}
              </p>
            </div>
          </div>
          {stats.uncounted > 0 ? (
            <Alert tone="warning">
              {stats.uncounted} producto{stats.uncounted !== 1 ? "s" : ""} sin contar — no serán ajustados.
            </Alert>
          ) : null}
        </div>
        <div className="flex justify-end gap-3 border-t-2 border-steel-700 bg-steel-900/60 px-6 py-4">
          <Button variant="outline" size="md" onClick={() => setConfirmOpen(false)} disabled={closing}>
            Cancelar
          </Button>
          <Button size="md" loading={closing} onClick={handleClose}>
            Confirmar cierre
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function SummaryTile({ label, value, accent }: {
  label: string; value: number; accent?: "green" | "orange" | "yellow";
}) {
  const color = accent === "green" ? "text-emerald-400" : accent === "orange" ? "text-signal-400" : accent === "yellow" ? "text-yellow-400" : "text-foreground";
  return (
    <div className="panel rounded-sm px-4 py-3">
      <p className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground/60">{label}</p>
      <p className={`mt-0.5 font-mono text-[22px] font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

function ResultCard({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" }) {
  const color = tone === "ok" ? "text-emerald-400" : tone === "warn" && value > 0 ? "text-signal-400" : "text-foreground";
  return (
    <div className="rounded-sm border border-steel-700 bg-steel-900/60 px-4 py-3 text-center">
      <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground/60">{label}</p>
      <p className={`mt-0.5 font-mono text-[22px] font-bold tabular-nums ${color}`}>{value}</p>
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
  return <td className={"px-5 py-3.5 align-middle " + (className ?? "")}>{children}</td>;
}
