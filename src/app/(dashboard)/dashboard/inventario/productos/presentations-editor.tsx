"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import { savePresentationsAction } from "@/actions/presentations";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog } from "@/components/ui/dialog";

// ── Types ──────────────────────────────────────────────────────────────────

type PresLine = {
  _key:       string;
  name:       string;
  unit_label: string;
  base_qty:   string;
  unit_price: string;
  is_default: boolean;
};

let _seq = 0;
function newKey() { return `new-${++_seq}`; }

const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency", currency: "USD",
  minimumFractionDigits: 2,
});
const numFmt = new Intl.NumberFormat("es-EC", {
  minimumFractionDigits: 0, maximumFractionDigits: 4,
});

// ── PresDialog ─────────────────────────────────────────────────────────────
// Centered modal for adding or editing a single presentation.

function PresDialog({
  open, initial, baseUnit, onSave, onClose,
}: {
  open:     boolean;
  initial:  PresLine | null;   // null = add mode
  baseUnit: string;
  onSave:   (line: PresLine) => void;
  onClose:  () => void;
}) {
  const isNew = initial === null;

  const [name,    setName]    = React.useState("");
  const [label,   setLabel]   = React.useState("");
  const [baseQty, setBaseQty] = React.useState("1");
  const [price,   setPrice]   = React.useState("");
  const [isDef,   setIsDef]   = React.useState(false);
  const [err,     setErr]     = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setName(initial?.name       ?? "");
    setLabel(initial?.unit_label ?? "");
    setBaseQty(initial?.base_qty ?? "1");
    setPrice(initial?.unit_price ?? "");
    setIsDef(initial?.is_default ?? false);
    setErr(null);
  }, [open, initial]);

  const bqNum   = parseFloat(baseQty.replace(",", "."));
  const bqValid = isFinite(bqNum) && bqNum > 0;
  const priceNum = parseFloat(price.replace(",", "."));
  const hasPrice = price.trim() !== "" && isFinite(priceNum) && priceNum >= 0;

  function handleSave() {
    if (!name.trim())  { setErr("El nombre interno es obligatorio."); return; }
    if (!label.trim()) { setErr("La etiqueta POS es obligatoria."); return; }
    if (!bqValid)      { setErr("La equivalencia debe ser mayor a 0."); return; }
    onSave({
      _key:       initial?._key ?? newKey(),
      name:       name.trim().toLowerCase().replace(/\s+/g, "_"),
      unit_label: label.trim(),
      base_qty:   String(bqNum),
      unit_price: hasPrice ? String(priceNum) : "",
      is_default: isDef,
    });
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isNew ? "Nueva presentación" : "Editar presentación"}
      description={`Unidad de venta y equivalencia en ${baseUnit}s de inventario.`}
      className="max-w-[480px]"
    >
      <div className="space-y-5 px-6 py-6">

        {/* Row 1: Nombre + Etiqueta */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">
              Nombre interno *
            </label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="galon"
              className="h-10"
            />
            <p className="font-mono text-[9px] leading-3.5 text-muted-foreground/35">
              Clave única sin espacios
            </p>
          </div>
          <div className="space-y-1.5">
            <label className="block font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">
              Etiqueta en POS *
            </label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Galón"
              className="h-10"
            />
            <p className="font-mono text-[9px] leading-3.5 text-muted-foreground/35">
              Lo que ve el cajero
            </p>
          </div>
        </div>

        {/* Row 2: Base qty + preview */}
        <div className="space-y-1.5">
          <label className="block font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">
            Equivalencia en {baseUnit}s *{" "}
            <span className="normal-case tracking-normal text-muted-foreground/40 font-normal">
              (cuánto descuenta del inventario base)
            </span>
          </label>
          <div className="flex items-center gap-3">
            <Input
              type="number"
              min={0.0001}
              step="any"
              value={baseQty}
              onChange={(e) => setBaseQty(e.target.value)}
              placeholder="0.20"
              mono
              className="h-10 w-32 text-right"
              onFocus={(e) => e.target.select()}
            />
            <div className="flex h-10 flex-1 items-center rounded-sm border border-steel-700/40 bg-steel-950/40 px-3">
              {bqValid ? (
                <p className="font-mono text-[11px] text-muted-foreground/70">
                  1 {label || "presentación"} →{" "}
                  <span className="font-bold text-safety-400">
                    {numFmt.format(bqNum)} {baseUnit}
                  </span>
                </p>
              ) : (
                <p className="font-mono text-[10px] text-muted-foreground/25">
                  Ingresa un valor &gt; 0
                </p>
              )}
            </div>
          </div>
          <p className="font-mono text-[9px] leading-3.5 text-muted-foreground/35">
            Caneca 5 gal → Galón = 0.20 · Litro = 0.264 · Cuarto = 0.05
          </p>
        </div>

        {/* Row 3: Precio sugerido */}
        <div className="space-y-1.5">
          <label className="block font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">
            Precio sugerido{" "}
            <span className="normal-case tracking-normal text-muted-foreground/40 font-normal">
              (opcional)
            </span>
          </label>
          <div className="flex items-center gap-3">
            <div className="relative w-32">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[11px] font-bold text-muted-foreground/40">
                $
              </span>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                mono
                className="h-10 pl-8 text-right"
                onFocus={(e) => e.target.select()}
              />
            </div>
            <p className="flex-1 font-mono text-[9.5px] leading-4 text-muted-foreground/45">
              Vacío → usa el precio base del producto.
              En el POS siempre se puede cambiar con motivo.
            </p>
          </div>
        </div>

        {/* Row 4: Predeterminada */}
        <div className="flex items-center gap-3 rounded-sm border border-steel-700/50 bg-steel-950/30 px-4 py-3">
          <Switch checked={isDef} onCheckedChange={setIsDef} id="pres-dialog-default" />
          <label htmlFor="pres-dialog-default" className="cursor-pointer">
            <p className="text-[13px] font-semibold text-foreground">Predeterminada</p>
            <p className="font-mono text-[9.5px] text-muted-foreground/45">
              Tocar la tarjeta del producto en POS agrega esta presentación
            </p>
          </label>
        </div>

        {err ? <Alert tone="error">{err}</Alert> : null}
      </div>

      {/* Footer */}
      <div className="flex gap-3 border-t-2 border-steel-700 bg-steel-900/60 px-6 py-4">
        <Button type="button" variant="outline" onClick={onClose} className="flex-1">
          Cancelar
        </Button>
        <Button type="button" onClick={handleSave} className="flex-1">
          {isNew ? "Agregar" : "Guardar cambios"}
        </Button>
      </div>
    </Dialog>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function PresentationsEditor({
  productId,
  baseUnit,
}: {
  productId: string;
  baseUnit:  string;
}) {
  const [lines, setLines]           = React.useState<PresLine[]>([]);
  const [loading, setLoading]       = React.useState(true);
  const [saving, setSaving]         = React.useState(false);
  const [error, setError]           = React.useState<string | null>(null);
  const [success, setSuccess]       = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing]       = React.useState<PresLine | null>(null);

  React.useEffect(() => {
    const supabase = createClient();
    supabase
      .from("product_presentations")
      .select("id, name, unit_label, base_qty, unit_price, is_default, sort_order")
      .eq("product_id", productId)
      .eq("is_active", true)
      .order("sort_order")
      .then(({ data }) => {
        if (data?.length) {
          type Raw = {
            id: string; name: string; unit_label: string;
            base_qty: number; unit_price: number | null; is_default: boolean;
          };
          setLines(
            (data as unknown as Raw[]).map((r) => ({
              _key:       r.id,
              name:       r.name,
              unit_label: r.unit_label,
              base_qty:   String(r.base_qty),
              unit_price: r.unit_price != null ? String(r.unit_price) : "",
              is_default: r.is_default,
            }))
          );
        }
        setLoading(false);
      });
  }, [productId]);

  const openAdd  = () => { setEditing(null);  setDialogOpen(true); };
  const openEdit = (l: PresLine) => { setEditing(l); setDialogOpen(true); };

  const handleDialogSave = (saved: PresLine) => {
    setLines((prev) => {
      // Clear other defaults if this one is default
      const base = saved.is_default
        ? prev.map((l) => ({ ...l, is_default: false }))
        : prev;
      const exists = base.find((l) => l._key === saved._key);
      return exists
        ? base.map((l) => l._key === saved._key ? saved : l)
        : [...base, saved];
    });
  };

  const removeLine = (key: string) =>
    setLines((prev) => prev.filter((l) => l._key !== key));

  const moveUp = (key: string) => {
    setLines((prev) => {
      const i = prev.findIndex((l) => l._key === key);
      if (i <= 0) return prev;
      const n = [...prev];
      [n[i - 1], n[i]] = [n[i]!, n[i - 1]!];
      return n;
    });
  };

  const moveDown = (key: string) => {
    setLines((prev) => {
      const i = prev.findIndex((l) => l._key === key);
      if (i < 0 || i >= prev.length - 1) return prev;
      const n = [...prev];
      [n[i], n[i + 1]] = [n[i + 1]!, n[i]!];
      return n;
    });
  };

  const handleSave = async () => {
    setError(null); setSuccess(false);
    setSaving(true);
    const res = await savePresentationsAction(
      productId,
      lines.map((l) => ({
        name:       l.name,
        unit_label: l.unit_label,
        base_qty:   Math.max(0.0001, parseFloat(l.base_qty) || 1),
        unit_price: l.unit_price.trim() ? parseFloat(l.unit_price) : null,
        is_default: l.is_default,
      }))
    );
    setSaving(false);
    if (res?.error) { setError(res.error); return; }
    setSuccess(true);
    setTimeout(() => setSuccess(false), 2500);
  };

  if (loading) {
    return (
      <div className="space-y-3 border-t border-steel-700/60 pt-6">
        <div className="h-4 w-48 animate-pulse rounded-sm bg-steel-800" />
        <div className="h-14 animate-pulse rounded-sm bg-steel-800/50" />
      </div>
    );
  }

  return (
    <div className="space-y-4 border-t border-steel-700/60 pt-6">

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60">
            Presentaciones de venta
          </p>
          <p className="mt-0.5 font-mono text-[9px] text-muted-foreground/35">
            Unidad base: <span className="text-muted-foreground/55">{baseUnit}</span>
            {" · "}El precio sugerido se puede cambiar en el POS
          </p>
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="flex shrink-0 items-center gap-1.5 rounded-sm border border-steel-700 bg-steel-800 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground/70 transition-colors hover:border-safety-500/50 hover:text-safety-500"
        >
          <PlusIcon className="h-3 w-3" />
          Agregar
        </button>
      </div>

      {/* ── Empty state ──────────────────────────────────────── */}
      {lines.length === 0 ? (
        <div className="rounded-sm border border-dashed border-steel-700/50 px-5 py-8 text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground/35">
            Sin presentaciones configuradas
          </p>
          <p className="mt-1.5 font-mono text-[9.5px] leading-4 text-muted-foreground/25">
            El POS vende directamente en {baseUnit}s.
            <br />
            Agrega presentaciones para vender galones de una caneca, etc.
          </p>
          <button
            type="button"
            onClick={openAdd}
            className="mt-5 inline-flex items-center gap-1.5 rounded-sm border border-safety-500/30 bg-safety-500/5 px-4 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-safety-500/60 transition-colors hover:border-safety-500/50 hover:bg-safety-500/8 hover:text-safety-500"
          >
            <PlusIcon className="h-3 w-3" />
            Agregar primera presentación
          </button>
        </div>
      ) : (
        <>
          {/* ── Table ──────────────────────────────────────── */}
          <div className="overflow-hidden rounded-sm border border-steel-700/60">
            {/* Header */}
            <div className="grid grid-cols-[28px_1fr_76px_76px_48px_64px] border-b border-steel-700/60 bg-steel-950/70 px-3 py-2">
              <span />
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground/45">Presentación</span>
              <span className="text-right font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground/45">Equiv.</span>
              <span className="text-right font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground/45">Precio</span>
              <span className="text-center font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground/45">Def.</span>
              <span />
            </div>

            {lines.map((l, idx) => {
              const bqNum    = parseFloat(l.base_qty) || 1;
              const priceNum = parseFloat(l.unit_price);
              const hasP     = l.unit_price.trim() !== "" && isFinite(priceNum);

              return (
                <div
                  key={l._key}
                  className="grid grid-cols-[28px_1fr_76px_76px_48px_64px] items-center border-b border-steel-700/25 px-3 py-3 last:border-b-0 transition-colors hover:bg-steel-800/15"
                >
                  {/* Sort */}
                  <div className="flex flex-col items-center gap-px">
                    <button type="button" onClick={() => moveUp(l._key)} disabled={idx === 0}
                      className="h-3.5 w-4 grid place-items-center text-[7px] text-muted-foreground/30 hover:text-muted-foreground/60 disabled:opacity-0 transition-colors"
                      aria-label="Subir">▲</button>
                    <button type="button" onClick={() => moveDown(l._key)} disabled={idx === lines.length - 1}
                      className="h-3.5 w-4 grid place-items-center text-[7px] text-muted-foreground/30 hover:text-muted-foreground/60 disabled:opacity-0 transition-colors"
                      aria-label="Bajar">▼</button>
                  </div>

                  {/* Name + label */}
                  <div className="min-w-0 pr-3">
                    <p className="truncate text-[13px] font-semibold leading-tight text-foreground">
                      {l.unit_label}
                    </p>
                    <p className="truncate font-mono text-[9.5px] text-muted-foreground/40">
                      {l.name}
                    </p>
                  </div>

                  {/* Equiv */}
                  <div className="text-right pr-2">
                    <span className="font-mono text-[12px] font-bold tabular-nums text-safety-400">
                      {numFmt.format(bqNum)}
                    </span>
                    <span className="ml-0.5 font-mono text-[9px] text-muted-foreground/35">
                      {baseUnit}
                    </span>
                  </div>

                  {/* Price */}
                  <div className="text-right pr-2">
                    {hasP ? (
                      <span className="font-mono text-[12px] tabular-nums text-foreground">
                        {moneyFmt.format(priceNum)}
                      </span>
                    ) : (
                      <span className="font-mono text-[10px] text-muted-foreground/25">base</span>
                    )}
                  </div>

                  {/* Default */}
                  <div className="flex justify-center">
                    {l.is_default ? (
                      <span className="rounded-sm border border-safety-500/40 bg-safety-500/10 px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.08em] text-safety-500">
                        DEF
                      </span>
                    ) : (
                      <span className="font-mono text-[9px] text-muted-foreground/15">—</span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-1">
                    <button type="button" onClick={() => openEdit(l)}
                      className="grid h-7 w-7 place-items-center rounded-sm border border-steel-700/50 text-muted-foreground/40 transition-colors hover:border-steel-500 hover:text-foreground"
                      aria-label="Editar">
                      <PencilIcon className="h-3 w-3" />
                    </button>
                    <button type="button" onClick={() => removeLine(l._key)}
                      className="grid h-7 w-7 place-items-center rounded-sm border border-steel-700/50 text-muted-foreground/40 transition-colors hover:border-red-700/50 hover:text-red-400"
                      aria-label="Eliminar">
                      <TrashIcon className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {error   ? <Alert tone="error">{error}</Alert>                    : null}
          {success ? <Alert tone="info">Presentaciones guardadas.</Alert> : null}

          <Button
            type="button"
            size="md"
            loading={saving}
            disabled={saving}
            onClick={handleSave}
            className="w-full"
          >
            Guardar presentaciones
          </Button>
        </>
      )}

      {/* ── Dialog ───────────────────────────────────────────── */}
      <PresDialog
        open={dialogOpen}
        initial={editing}
        baseUnit={baseUnit}
        onSave={handleDialogSave}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}
