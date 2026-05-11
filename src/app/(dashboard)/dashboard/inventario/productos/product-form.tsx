"use client";

import * as React from "react";
import { useActionState, useEffect, useRef, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { FieldError } from "@/components/ui/field-error";
import { Switch } from "@/components/ui/switch";
import {
  upsertProductAction,
  type ProductState,
} from "@/actions/products";
import type { ProductRow } from "./products-table";

const IVA_RATE = 15;
const IVA_MULT = 1 + IVA_RATE / 100; // 1.15

/**
 * Calcula el preview del precio según el modo de entrada.
 *
 * priceIncludesIva = false → el usuario escribe precio base (neto).
 *   Preview: "= $X.XX c/IVA"  (le sumamos el IVA para mostrar el precio final)
 *
 * priceIncludesIva = true → el usuario escribe precio final (ya con IVA).
 *   Preview: "sin IVA: $X.XX" (dividimos para mostrar la base que se va a guardar)
 */
function pricePreview(val: string, includesIva: boolean): string | null {
  const n = parseFloat(val.replace(",", "."));
  if (!isFinite(n) || n <= 0) return null;
  return includesIva
    ? "sin IVA: $" + (n / IVA_MULT).toFixed(2)
    : "= $" + (n * IVA_MULT).toFixed(2) + " c/IVA";
}

// Convención de almacenamiento: product_prices.unit_price guarda siempre el
// precio BRUTO (precio final de venta con IVA incluido).
// La tabla y el POS muestran ese valor directamente, sin reconversión.

/**
 * Cuando el usuario ingresa precio NETO (toggle desmarcado),
 * lo convertimos a bruto antes de persistir.
 */
function toGross(val: string): string {
  const n = parseFloat(val.replace(",", "."));
  if (!isFinite(n) || n <= 0) return "";
  return (n * IVA_MULT).toFixed(4);
}

/**
 * Convierte el valor mostrado al cambiar de modo para que el precio
 * efectivo guardado no cambie al solo activar/desactivar el toggle.
 *
 * net→gross: multiplica por 1.15  (usuario pasó a "ya incluye IVA")
 * gross→net: divide entre 1.15    (usuario pasó a "precio base neto")
 */
function convertDisplayedPrice(val: string, toGross: boolean): string {
  const n = parseFloat(val.replace(",", "."));
  if (!isFinite(n) || n <= 0) return val;
  return toGross
    ? (n * IVA_MULT).toFixed(4)
    : (n / IVA_MULT).toFixed(4);
}

type Props = { initial: ProductRow | null; onSuccess: () => void };

export function ProductForm({ initial, onSuccess }: Props) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const [state, formAction, pending] = useActionState<ProductState, FormData>(
    upsertProductAction,
    null
  );

  // ── Estado controlado ──────────────────────────────────────────────────
  // priceIncludesIva: si es true, el número escrito ya lleva IVA.
  //
  // Edición (initial != null): arranca en TRUE porque los precios en DB
  //   son BRUTOS — mostrar el valor como neto sería incorrecto y causaría
  //   una multiplicación doble al guardar (4.96 × 1.15 = 5.70).
  //
  // Creación (initial == null): arranca en FALSE — el usuario ingresa el
  //   precio neto y el preview muestra el bruto como referencia.
  const [priceIncludesIva, setPriceIncludesIva] = useState(initial != null);

  /**
   * Cambia el modo IVA y convierte los valores mostrados para que el precio
   * efectivo que se va a guardar NO cambie solo por activar el toggle.
   *
   * Ejemplo: campo muestra "10.00" (neto) → usuario activa "ya incluye IVA"
   *  → el campo pasa a mostrar "11.50" (bruto equivalente)
   *  → submit guarda 11.50/1.15 = 10.00 — mismo precio, sin sorpresa.
   */
  const handleToggleIva = React.useCallback((next: boolean) => {
    const cvt = (v: string) => convertDisplayedPrice(v, next);
    setPricePublico((p) => p ? cvt(p) : p);
    setPriceMayorista((p) => p ? cvt(p) : p);
    setPriceDistribuidor((p) => p ? cvt(p) : p);
    setPriceIncludesIva(next);
  }, []);
  const [unit, setUnit] = useState(initial?.unit ?? "unidad");
  const [pricePublico, setPricePublico] = useState(
    initial?.default_price != null ? String(initial.default_price) : ""
  );
  const [priceMayorista, setPriceMayorista] = useState(
    initial?.price_mayorista != null ? String(initial.price_mayorista) : ""
  );
  const [priceDistribuidor, setPriceDistribuidor] = useState(
    initial?.price_distribuidor != null ? String(initial.price_distribuidor) : ""
  );

  // ── Flujo de estado ────────────────────────────────────────────────────
  const [keepOpen, setKeepOpen] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [hasProcessedSuccess, setHasProcessedSuccess] = useState(false);

  useEffect(() => {
    if (!state?.ok || hasProcessedSuccess) return;

    if (typeof BroadcastChannel !== "undefined") {
      const ch = new BroadcastChannel("saturlub:products");
      ch.postMessage({ type: "product-updated" });
      ch.close();
    }

    if (keepOpen && !initial?.id) {
      setHasProcessedSuccess(true);
      // Limpia nombre, sku, costo y precios.
      // Preserva: unit, priceIncludesIva (contexto útil en batch).
      setPricePublico("");
      setPriceMayorista("");
      setPriceDistribuidor("");
      setFormKey((k) => k + 1);
      setSavedFlash(true);
      router.refresh();
      setTimeout(() => nameRef.current?.focus(), 60);
      const t = setTimeout(() => setSavedFlash(false), 2500);
      return () => clearTimeout(t);
    } else {
      router.refresh();
      onSuccess();
    }
  }, [state, keepOpen, initial?.id, onSuccess, router, hasProcessedSuccess]);

  const errors = state?.fieldErrors ?? {};
  const isEditing = Boolean(initial?.id);

  // ── Precios que se envían al servidor (siempre en bruto/gross) ──────────
  // priceIncludesIva=true  → usuario ya ingresó bruto → guardar tal cual
  // priceIncludesIva=false → usuario ingresó neto     → convertir a bruto
  const grossPublico = priceIncludesIva ? pricePublico : toGross(pricePublico);
  const grossMayorista = priceIncludesIva ? priceMayorista : toGross(priceMayorista);
  const grossDistribuidor = priceIncludesIva ? priceDistribuidor : toGross(priceDistribuidor);

  // ── Previews ──────────────────────────────────────────────────────────
  const previewPublico = useMemo(() => pricePreview(pricePublico, priceIncludesIva), [pricePublico, priceIncludesIva]);
  const previewMayorista = useMemo(() => pricePreview(priceMayorista, priceIncludesIva), [priceMayorista, priceIncludesIva]);
  const previewDistribuidor = useMemo(() => pricePreview(priceDistribuidor, priceIncludesIva), [priceDistribuidor, priceIncludesIva]);

  return (
    <form
      ref={formRef}
      key={formKey}
      action={formAction}
      className="flex h-full flex-col"
      onChange={() => {
        if (hasProcessedSuccess) setHasProcessedSuccess(false);
      }}
    >
      {initial?.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      {/* has_tax = true siempre en V1 lubricadora.
          El checkbox visible controla el MODO DE ENTRADA (bruto vs neto),
          no la taxabilidad del producto. */}
      <input type="hidden" name="has_tax" value="on" />
      <input type="hidden" name="unit" value={unit} />
      <input type="hidden" name="price_publico" value={grossPublico} />
      <input type="hidden" name="price_mayorista" value={grossMayorista} />
      <input type="hidden" name="price_distribuidor" value={grossDistribuidor} />

      <fieldset
        disabled={pending}
        className="m-0 min-w-0 flex-1 overflow-y-auto border-0 px-6 py-5 disabled:opacity-95 space-y-0"
      >
        {savedFlash ? (
          <div className="mb-5 flex items-center gap-2 rounded-sm border border-signal-600/60 bg-signal-700/20 px-3 py-2.5 text-[13px] font-semibold text-emerald-300 animate-in fade-in duration-200">
            <CheckIcon className="h-4 w-4 shrink-0" />
            Producto guardado — ingresa el siguiente
          </div>
        ) : null}

        {/* ── BLOQUE 1: Identificación ─────────────────────────────── */}
        <SectionHeader label="Identificación" />

        <div className="space-y-4 pb-5">
          <div className="space-y-1.5">
            <Label htmlFor="name" required>Nombre del producto</Label>
            <Input
              ref={nameRef}
              id="name"
              name="name"
              defaultValue={initial?.name ?? ""}
              placeholder="Aceite 20W-50 mineral 1L"
              invalid={Boolean(errors.name)}
              autoFocus
            />
            <FieldError fieldId="name" message={errors.name} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sku">
                SKU{" "}
                <span className="font-normal normal-case tracking-normal text-muted-foreground/70">
                  (opcional)
                </span>
              </Label>
              <Input
                id="sku"
                name="sku"
                defaultValue={initial?.sku ?? ""}
                placeholder="Auto si vacío"
                mono
                maxLength={60}
                autoCapitalize="characters"
                spellCheck={false}
                invalid={Boolean(errors.sku)}
              />
              <FieldError fieldId="sku" message={errors.sku} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="unit">Unidad</Label>
              <select
                id="unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="flex h-10 w-full rounded-sm border-2 border-steel-700 bg-steel-800 px-3 py-2 font-mono text-[13px] text-foreground outline-none transition-colors focus:border-safety-500/60 focus:ring-2 focus:ring-safety-500/20"
              >
                <option value="unidad">Unidad</option>
                <option value="galón">Galón</option>
                <option value="medio_galon">Medio Galón</option>
                <option value="cuarto">Cuarto</option>
                <option value="litro">Litro</option>
                <option value="media_caneca">Media Caneca (2.5 gal)</option>
                <option value="caneca">Caneca (5 gal)</option>
                <option value="tambor">Tambor (55 gal)</option>
                <option value="barril">Barril</option>
                <option value="caja">Caja</option>
                <option value="paquete">Paquete</option>
              </select>
            </div>
          </div>
        </div>

        {/* ── BLOQUE 2: Costo ──────────────────────────────────────── */}
        <SectionHeader label="Costo" />

        <div className="space-y-1.5 pb-5">
          <Label htmlFor="cost_price">
            Costo referencial{" "}
            <span className="font-normal normal-case tracking-normal text-muted-foreground/70">
              (opcional · siempre sin IVA)
            </span>
          </Label>
          <div className="relative">
            <UsdPrefix />
            <Input
              id="cost_price"
              name="cost_price"
              type="number"
              min="0"
              step="0.0001"
              defaultValue={initial?.cost_price != null ? String(initial.cost_price) : ""}
              placeholder="0.00"
              mono
              className="pl-14 text-right"
              invalid={Boolean(errors.cost_price)}
              onFocus={(e) => e.target.select()}
            />
          </div>
          <p className="field-hint">
            Ingresa el costo sin IVA (neto). Referencia para sugerencia de compras —
            el sistema calcula el costo real (CPP) a partir de cada recepción de mercancía.
          </p>
          <FieldError fieldId="cost_price" message={errors.cost_price} />
        </div>

        {/* ── BLOQUE 3: Precios de venta ──────────────────────────── */}
        <SectionHeader label="Precios de venta" />

        <div className="pb-5">
          {/* Toggle de modo de entrada */}
          <div className="mb-3 space-y-2">
            <div className="flex items-center gap-3 rounded-sm border border-steel-700/60 bg-steel-900/40 px-3 py-2.5">
              <Switch
                id="price_includes_iva"
                checked={priceIncludesIva}
                onCheckedChange={handleToggleIva}
              />
              <Label
                htmlFor="price_includes_iva"
                className="cursor-pointer normal-case tracking-normal text-[13px] font-medium text-muted-foreground"
              >
                El precio ingresado ya incluye IVA ({IVA_RATE}%)
              </Label>
            </div>
            <p className="field-hint px-1">
              {priceIncludesIva
                ? "Precios de venta ingresados con IVA incluido (bruto). Se guarda la base neta en la DB."
                : "Precios de venta ingresados sin IVA (neto). El precio final con IVA se muestra como referencia."}
              {" "}El costo referencial de arriba es siempre neto y no se afecta por este toggle.
            </p>
          </div>

          <div className="space-y-2">
            {/* Encabezado de columnas */}
            <div className="grid grid-cols-[120px_1fr_100px] items-center gap-3 pb-1">
              <span />
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground/50">
                {priceIncludesIva ? "Precio c/IVA" : "Precio base"}
              </span>
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-right text-muted-foreground/50">
                {priceIncludesIva ? "sin IVA" : "c/IVA"}
              </span>
            </div>

            <TierPriceRow
              label="Público"
              value={pricePublico}
              onChange={setPricePublico}
              preview={previewPublico}
              error={errors.price_publico}
            />
            <TierPriceRow
              label="Mayorista"
              value={priceMayorista}
              onChange={setPriceMayorista}
              preview={previewMayorista}
              error={errors.price_mayorista}
            />
            <TierPriceRow
              label="Distribuidor (canal)"
              value={priceDistribuidor}
              onChange={setPriceDistribuidor}
              preview={previewDistribuidor}
              error={errors.price_distribuidor}
            />
          </div>
          <div className="mt-2 space-y-1">
            <p className="field-hint">
              Todos opcionales. Distribuidor = cliente revendedor/canal, no proveedor.
            </p>
            {!pricePublico && state?.ok === undefined ? null : !pricePublico ? (
              <p className="field-hint text-safety-500/80">
                Sin precio Público definido el POS asignará $0.00 al vender.
              </p>
            ) : null}
          </div>
        </div>

        {state?.error && !state.fieldErrors ? (
          <Alert tone="error">{state.error}</Alert>
        ) : null}
      </fieldset>

      {/* ── FOOTER ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 border-t-2 border-steel-700 bg-steel-900/60 px-6 py-4">
        {!isEditing ? (
          <label className="flex cursor-pointer items-center gap-2.5">
            <Switch
              checked={keepOpen}
              onCheckedChange={setKeepOpen}
              aria-label="Guardar y agregar otro"
            />
            <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Guardar y agregar otro
            </span>
          </label>
        ) : (
          <div />
        )}

        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={onSuccess}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button type="submit" size="md" loading={pending}>
            {isEditing
              ? "Guardar cambios"
              : keepOpen
                ? "Crear y seguir"
                : "Crear producto"}
          </Button>
        </div>
      </div>
    </form>
  );
}

// ── Sub-componentes ────────────────────────────────────────────────────────

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 pb-3 pt-1">
      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60">
        {label}
      </span>
      <div className="h-px flex-1 bg-steel-700/60" />
    </div>
  );
}

function UsdPrefix() {
  return (
    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
      USD
    </span>
  );
}

function TierPriceRow({
  label,
  value,
  onChange,
  preview,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  preview: string | null;
  error?: string;
}) {
  return (
    <div>
      <div className="grid grid-cols-[120px_1fr_100px] items-center gap-3">
        <span className="font-mono text-[12px] font-semibold text-muted-foreground">
          {label}
        </span>
        <div className="relative">
          <UsdPrefix />
          <Input
            type="number"
            min="0"
            step="any"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="—"
            mono
            className="pl-14 text-right"
            invalid={Boolean(error)}
            onFocus={(e) => e.target.select()}
          />
        </div>
        <span className="text-right font-mono text-[12px] tabular-nums text-muted-foreground/60">
          {preview ?? ""}
        </span>
      </div>
      {error ? (
        <p className="mt-1 ml-[132px] text-[12px] text-red-400">{error}</p>
      ) : null}
    </div>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
