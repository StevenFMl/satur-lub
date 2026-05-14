"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import { saveBundleItemsAction } from "@/actions/products";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type ComponentLine = {
  component_product_id: string;
  component_name:       string;
  component_sku:        string;
  component_unit:       string;
  quantity:             string;
  base_qty:             string;
  sort_order:           number;
};

type AvailableProduct = {
  id:   string;
  name: string;
  sku:  string;
  unit: string;
};

const numFmt = new Intl.NumberFormat("es-EC", { minimumFractionDigits: 0, maximumFractionDigits: 4 });

export function BundleEditor({ productId }: { productId: string }) {
  const [lines, setLines]       = React.useState<ComponentLine[]>([]);
  const [available, setAvailable] = React.useState<AvailableProduct[]>([]);
  const [loading, setLoading]   = React.useState(true);
  const [saving, setSaving]     = React.useState(false);
  const [error, setError]       = React.useState<string | null>(null);
  const [success, setSuccess]   = React.useState(false);

  // Search state for adding components
  const [search, setSearch]     = React.useState("");
  const [addQty, setAddQty]     = React.useState("1");
  const [addBase, setAddBase]   = React.useState("1");
  const [selectedId, setSelectedId] = React.useState("");

  // Fetch current bundle_items + available products
  React.useEffect(() => {
    const supabase = createClient();
    Promise.all([
      // Current components
      supabase
        .from("bundle_items")
        .select(`
          component_product_id, quantity, base_qty, sort_order,
          products:component_product_id ( name, sku, unit )
        `)
        .eq("bundle_product_id", productId)
        .order("sort_order"),
      // Available products (exclude kit/bundle — composites can't be components)
      supabase
        .from("products")
        .select("id, name, sku, unit")
        .eq("is_active", true)
        .neq("product_kind", "kit")
        .neq("product_kind", "bundle")
        .neq("id", productId)
        .order("name"),
    ]).then(([compRes, availRes]) => {
      if (compRes.data) {
        type RawComp = {
          component_product_id: string;
          quantity: number;
          base_qty: number;
          sort_order: number;
          products: { name: string; sku: string; unit: string } | null;
        };
        setLines(
          (compRes.data as unknown as RawComp[]).map((c, i) => ({
            component_product_id: c.component_product_id,
            component_name:       c.products?.name  ?? "—",
            component_sku:        c.products?.sku   ?? "—",
            component_unit:       c.products?.unit  ?? "unidad",
            quantity:             String(c.quantity  ?? 1),
            base_qty:             String(c.base_qty  ?? 1),
            sort_order:           c.sort_order ?? i,
          }))
        );
      }
      if (availRes.data) {
        setAvailable(availRes.data as unknown as AvailableProduct[]);
      }
      setLoading(false);
    });
  }, [productId]);

  const filteredAvailable = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    const taken = new Set(lines.map((l) => l.component_product_id));
    return available.filter(
      (p) =>
        !taken.has(p.id) &&
        (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
    );
  }, [available, lines, search]);

  const addLine = (prod: AvailableProduct) => {
    const qty  = parseFloat(addQty)  || 1;
    const base = parseFloat(addBase) || 1;
    setLines((prev) => [
      ...prev,
      {
        component_product_id: prod.id,
        component_name:       prod.name,
        component_sku:        prod.sku,
        component_unit:       prod.unit,
        quantity:             String(qty),
        base_qty:             String(base),
        sort_order:           prev.length,
      },
    ]);
    setSearch("");
    setSelectedId("");
    setAddQty("1");
    setAddBase("1");
  };

  const removeLine = (id: string) => {
    setLines((prev) => prev.filter((l) => l.component_product_id !== id));
  };

  const updateLine = (id: string, field: "quantity" | "base_qty", val: string) => {
    setLines((prev) =>
      prev.map((l) => l.component_product_id === id ? { ...l, [field]: val } : l)
    );
  };

  const moveUp = (id: string) => {
    setLines((prev) => {
      const i = prev.findIndex((l) => l.component_product_id === id);
      if (i <= 0) return prev;
      const next = [...prev];
      [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
      return next.map((l, j) => ({ ...l, sort_order: j }));
    });
  };

  const moveDown = (id: string) => {
    setLines((prev) => {
      const i = prev.findIndex((l) => l.component_product_id === id);
      if (i < 0 || i >= prev.length - 1) return prev;
      const next = [...prev];
      [next[i], next[i + 1]] = [next[i + 1]!, next[i]!];
      return next.map((l, j) => ({ ...l, sort_order: j }));
    });
  };

  const handleSave = async () => {
    setSaving(true); setError(null); setSuccess(false);

    const items = lines.map((l, i) => ({
      component_product_id: l.component_product_id,
      quantity:             Math.max(0.0001, parseFloat(l.quantity)  || 1),
      base_qty:             Math.max(0.0001, parseFloat(l.base_qty)  || 1),
      sort_order:           i,
    }));

    const res = await saveBundleItemsAction(productId, items);
    setSaving(false);
    if (res?.error) { setError(res.error); return; }
    setSuccess(true);
    setTimeout(() => setSuccess(false), 2500);
  };

  if (loading) {
    return (
      <div className="space-y-2 border-t border-steel-700/60 pt-5">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground/50">
          Componentes del kit
        </p>
        <div className="h-8 animate-pulse rounded-sm bg-steel-800" />
      </div>
    );
  }

  return (
    <div className="space-y-4 border-t border-steel-700/60 pt-5">
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground/60">
        Componentes del kit
      </p>

      {/* Current components */}
      {lines.length === 0 ? (
        <p className="font-mono text-[11px] text-muted-foreground/50">
          Sin componentes. Agrega productos con sus cantidades.
        </p>
      ) : (
        <div className="space-y-1">
          {/* Header */}
          <div className="grid grid-cols-[20px_1fr_70px_70px_28px] gap-1.5 pb-1">
            <span />
            <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground/50">Producto</span>
            <span className="text-right font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground/50">Cant.</span>
            <span className="text-right font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground/50">U.base</span>
            <span />
          </div>
          {lines.map((l, idx) => (
            <div key={l.component_product_id} className="grid grid-cols-[20px_1fr_70px_70px_28px] items-center gap-1.5">
              {/* Move up / down */}
              <div className="flex flex-col">
                <button
                  type="button"
                  onClick={() => moveUp(l.component_product_id)}
                  disabled={idx === 0}
                  className="flex h-3.5 w-5 items-center justify-center text-[9px] text-muted-foreground/40 transition-colors hover:text-foreground disabled:opacity-20"
                  aria-label="Subir"
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={() => moveDown(l.component_product_id)}
                  disabled={idx === lines.length - 1}
                  className="flex h-3.5 w-5 items-center justify-center text-[9px] text-muted-foreground/40 transition-colors hover:text-foreground disabled:opacity-20"
                  aria-label="Bajar"
                >
                  ▼
                </button>
              </div>
              <div className="min-w-0">
                <p className="truncate text-[12px] font-semibold text-foreground">{l.component_name}</p>
                <p className="font-mono text-[10px] text-muted-foreground/60">{l.component_sku} · {l.component_unit}</p>
              </div>
              <input
                type="number" min={0.0001} step="any"
                value={l.quantity}
                onChange={(e) => updateLine(l.component_product_id, "quantity", e.target.value)}
                className="h-7 w-full rounded-sm border border-steel-700 bg-steel-900 px-2 text-right font-mono text-[11px] text-foreground focus:border-safety-500 focus:outline-none"
              />
              <input
                type="number" min={0.0001} step="any"
                value={l.base_qty}
                onChange={(e) => updateLine(l.component_product_id, "base_qty", e.target.value)}
                className="h-7 w-full rounded-sm border border-steel-700 bg-steel-900 px-2 text-right font-mono text-[11px] text-foreground focus:border-safety-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => removeLine(l.component_product_id)}
                className="h-7 w-7 rounded-sm border border-steel-700 text-muted-foreground/50 transition-colors hover:border-red-700/40 hover:text-red-400"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add component */}
      <div className="space-y-1.5 rounded-sm border border-steel-700/60 bg-steel-950/40 p-3">
        <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground/50">
          Agregar componente
        </p>
        <Input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setSelectedId(""); }}
          placeholder="Buscar por nombre o SKU…"
          className="text-[12px]"
        />
        {search.trim().length > 0 && filteredAvailable.length > 0 ? (
          <div className="max-h-[160px] overflow-y-auto rounded-sm border border-steel-700 bg-steel-900">
            {filteredAvailable.slice(0, 12).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => { setSelectedId(p.id); setSearch(p.name); }}
                className={[
                  "flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-steel-800",
                  selectedId === p.id ? "bg-steel-800" : "",
                ].join(" ")}
              >
                <span className="text-[12px] font-semibold text-foreground">{p.name}</span>
                <span className="font-mono text-[10px] text-muted-foreground/60">{p.sku}</span>
              </button>
            ))}
          </div>
        ) : null}
        {selectedId ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 space-y-0.5">
              <label className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground/50">Cantidad / kit</label>
              <input
                type="number" min={0.0001} step="any"
                value={addQty}
                onChange={(e) => setAddQty(e.target.value)}
                className="h-8 w-full rounded-sm border border-steel-700 bg-steel-900 px-2 text-right font-mono text-[12px] text-foreground focus:border-safety-500 focus:outline-none"
              />
            </div>
            <div className="w-[70px] space-y-0.5">
              <label className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground/50">U.base</label>
              <input
                type="number" min={0.0001} step="any"
                value={addBase}
                onChange={(e) => setAddBase(e.target.value)}
                className="h-8 w-full rounded-sm border border-steel-700 bg-steel-900 px-2 text-right font-mono text-[12px] text-foreground focus:border-safety-500 focus:outline-none"
              />
            </div>
            <div className="space-y-0.5">
              <label className="invisible font-mono text-[9px]">X</label>
              <button
                type="button"
                onClick={() => {
                  const prod = available.find((p) => p.id === selectedId);
                  if (prod) addLine(prod);
                }}
                className="h-8 rounded-sm border border-safety-500/50 bg-safety-500/10 px-3 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-safety-500 hover:bg-safety-500/20"
              >
                Agregar
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {error   ? <Alert tone="error">{error}</Alert> : null}
      {success ? <Alert tone="info">Componentes guardados.</Alert> : null}

      <Button
        type="button"
        size="md"
        loading={saving}
        disabled={saving}
        onClick={handleSave}
        className="w-full"
      >
        Guardar componentes del kit
      </Button>

      {lines.length > 0 ? (
        <p className="font-mono text-[10px] text-muted-foreground/50">
          El kit vende {numFmt.format(1)} unidad → descuenta{" "}
          {lines.map((l) => {
            const q = parseFloat(l.quantity) || 1;
            const b = parseFloat(l.base_qty) || 1;
            return `${numFmt.format(q * b)} ${l.component_unit} de ${l.component_name}`;
          }).join(", ")}
        </p>
      ) : null}
    </div>
  );
}
