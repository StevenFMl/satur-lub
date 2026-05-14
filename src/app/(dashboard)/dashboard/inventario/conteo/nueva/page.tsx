"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { createCountSessionAction } from "@/actions/inventory";
import { Alert } from "@/components/ui/alert";

// This is a client component because we need the warehouses list at runtime
// and need to redirect after session creation.

export default function NuevaConteoPage() {
  const router = useRouter();

  const [warehouses, setWarehouses] = React.useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading]       = React.useState(true);
  const [warehouseId, setWarehouseId] = React.useState("");
  const [notes, setNotes]           = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError]           = React.useState<string | null>(null);

  React.useEffect(() => {
    const supabase = createClient();
    supabase
      .from("warehouses")
      .select("id, name")
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => {
        setWarehouses(data ?? []);
        if (data?.length === 1) setWarehouseId(data[0]!.id);
        setLoading(false);
      });
  }, []);

  const handleStart = async () => {
    if (!warehouseId) { setError("Selecciona una bodega."); return; }
    setSubmitting(true); setError(null);
    const res = await createCountSessionAction(warehouseId, notes.trim() || null);
    setSubmitting(false);
    if (res?.error) { setError(res.error); return; }
    if (res?.sessionId) {
      router.push(`/dashboard/inventario/conteo/${res.sessionId}`);
    }
  };

  return (
    <div className="mx-auto w-full max-w-xl space-y-8">
      <header className="space-y-1.5">
        <span className="hud-readout">Conteo físico · Nueva sesión</span>
        <h1 className="font-display text-[28px] leading-none tracking-[0.02em] text-foreground sm:text-[34px]">
          INICIAR CONTEO
        </h1>
        <p className="text-[13px] text-muted-foreground">
          Selecciona la bodega a contar. El sistema cargará todos los productos
          con su stock actual como punto de partida.
        </p>
      </header>

      <div className="panel rounded-sm space-y-5 px-6 py-6">
        {/* Warehouse */}
        <div className="space-y-1.5">
          <label className="block font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">
            Bodega <span className="text-red-400">*</span>
          </label>
          {loading ? (
            <div className="h-10 animate-pulse rounded-sm bg-steel-800" />
          ) : warehouses.length === 0 ? (
            <p className="font-mono text-[12px] text-muted-foreground/60">
              No hay bodegas activas registradas.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2">
              {warehouses.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => setWarehouseId(w.id)}
                  className={[
                    "flex items-center justify-between rounded-sm border-2 px-4 py-3 text-left transition-all",
                    warehouseId === w.id
                      ? "border-safety-500 bg-safety-500/10 text-safety-500"
                      : "border-steel-700 bg-steel-900/40 text-foreground hover:border-steel-600",
                  ].join(" ")}
                >
                  <span className="font-semibold">{w.name}</span>
                  {warehouseId === w.id ? (
                    <span className="font-mono text-[10px] uppercase tracking-[0.1em]">Seleccionada ✓</span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Notes */}
        <div className="space-y-1.5">
          <label className="block font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">
            Nota <span className="font-normal text-muted-foreground/40">(opcional)</span>
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={400}
            rows={2}
            placeholder="Ej: Conteo mensual mayo 2026, responsable: Juan…"
            className="w-full resize-none rounded-sm border border-steel-700 bg-steel-900 px-3 py-2 font-mono text-[12px] text-foreground placeholder:text-muted-foreground/40 focus:border-safety-500 focus:outline-none"
          />
        </div>

        {error ? <Alert tone="error">{error}</Alert> : null}

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={() => router.back()}
            disabled={submitting}
            className="rounded-sm border border-steel-700 px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-steel-600 hover:text-foreground disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleStart}
            disabled={!warehouseId || submitting || loading}
            className="flex flex-1 items-center justify-center gap-2 rounded-sm border border-safety-500 bg-safety-500/10 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-safety-500 transition-colors hover:bg-safety-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? (
              <>
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-safety-500 border-t-transparent" />
                Cargando productos…
              </>
            ) : (
              "Iniciar conteo →"
            )}
          </button>
        </div>
      </div>

      {/* Info box */}
      <div className="rounded-sm border border-steel-700/60 bg-steel-900/30 px-5 py-4 space-y-2">
        <p className="font-mono text-[9.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground/60">
          Cómo funciona
        </p>
        <ul className="space-y-1.5 text-[12px] text-muted-foreground/70">
          <li>• Se cargan todos los productos con stock en la bodega elegida</li>
          <li>• Ingresa la cantidad física que encontraste para cada producto</li>
          <li>• Al cerrar la sesión, los ajustes se aplican automáticamente</li>
          <li>• Cada ajuste queda registrado en el kárdex con motivo "Conteo físico"</li>
          <li>• Los productos no contados no se modifican</li>
        </ul>
      </div>
    </div>
  );
}
