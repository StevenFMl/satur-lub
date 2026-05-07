"use client";

import * as React from "react";
import { useActionState, useEffect, useRef, useState } from "react";
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

type Props = {
  initial: ProductRow | null;
  onSuccess: () => void;
};

export function ProductForm({ initial, onSuccess }: Props) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const [state, formAction, pending] = useActionState<ProductState, FormData>(
    upsertProductAction,
    null
  );

  // "Guardar y añadir otro" — solo en modo creación
  const [keepOpen, setKeepOpen] = useState(false);
  // Flash de confirmación efímero
  const [savedFlash, setSavedFlash] = useState(false);
  // Key para forzar re-render del formulario en modo continuo
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (!state?.ok) return;

    if (keepOpen && !initial?.id) {
      // Modo continuo: resetear form, mantener Sheet abierto
      setFormKey((k) => k + 1);
      setSavedFlash(true);
      router.refresh();
      // Focus al nombre tras el reset
      setTimeout(() => nameRef.current?.focus(), 60);
      // Ocultar flash después de 2.5s
      const t = setTimeout(() => setSavedFlash(false), 2500);
      return () => clearTimeout(t);
    } else {
      // Comportamiento normal: cerrar Sheet
      onSuccess();
    }
  }, [state, keepOpen, initial?.id, onSuccess, router]);

  const errors = state?.fieldErrors ?? {};
  const isEditing = Boolean(initial?.id);

  return (
    <form
      ref={formRef}
      key={formKey}
      action={formAction}
      className="flex h-full flex-col"
    >
      {initial?.id ? (
        <input type="hidden" name="id" value={initial.id} />
      ) : null}

      <fieldset
        disabled={pending}
        className="m-0 min-w-0 flex-1 space-y-6 border-0 px-6 py-6 disabled:opacity-95"
      >
        {/* Flash de confirmación */}
        {savedFlash ? (
          <div className="flex items-center gap-2 rounded-sm border border-signal-600/60 bg-signal-700/20 px-3 py-2.5 text-[13px] font-semibold text-emerald-300 animate-in fade-in duration-200">
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
            Producto creado — sigue con el siguiente
          </div>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="name" required>
            Nombre del producto
          </Label>
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

        <div className="space-y-2">
          <Label htmlFor="sku">
            SKU{" "}
            <span className="font-normal normal-case tracking-normal text-muted-foreground/80">
              (opcional)
            </span>
          </Label>
          <Input
            id="sku"
            name="sku"
            defaultValue={initial?.sku ?? ""}
            placeholder="Lo generamos por ti si lo dejas vacío"
            mono
            maxLength={60}
            autoCapitalize="characters"
            spellCheck={false}
            invalid={Boolean(errors.sku)}
            aria-describedby={errors.sku ? "sku-error" : "sku-hint"}
          />
          {errors.sku ? (
            <FieldError fieldId="sku" message={errors.sku} />
          ) : (
            <p id="sku-hint" className="field-hint">
              Único por negocio. Se genera automáticamente si lo dejas vacío.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="unit">Unidad de medida</Label>
          <select
            id="unit"
            name="unit"
            defaultValue={initial?.unit ?? "unidad"}
            className="flex h-10 w-full rounded-sm border-2 border-steel-700 bg-steel-800 px-3 py-2 font-mono text-[13px] text-foreground outline-none transition-colors focus:border-safety-500/60 focus:ring-2 focus:ring-safety-500/20"
          >
            <option value="unidad">Unidad</option>
            <option value="galón">Galón</option>
            <option value="medio_galon">Medio Galón</option>
            <option value="cuarto">Cuarto</option>
            <option value="litro">Litro</option>
            <option value="caneca">Caneca (5 Galones)</option>
            <option value="tambor">Tambor (55 Galones)</option>
            <option value="barril">Barril</option>
            <option value="caja">Caja</option>
            <option value="paquete">Paquete</option>
          </select>
          <FieldError fieldId="unit" message={errors.unit} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="cost_price">
            Costo base{" "}
            <span className="font-normal normal-case tracking-normal text-muted-foreground/80">
              (opcional)
            </span>
          </Label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              USD
            </span>
            <Input
              id="cost_price"
              name="cost_price"
              type="number"
              min="0"
              step="0.01"
              defaultValue={
                initial?.cost_price != null ? String(initial.cost_price) : "0"
              }
              placeholder="0.00"
              mono
              className="pl-14 text-right"
              invalid={Boolean(errors.cost_price)}
              onFocus={(e) => e.target.select()}
            />
          </div>
          <FieldError fieldId="cost_price" message={errors.cost_price} />
        </div>

        {state?.error && !state.fieldErrors ? (
          <Alert tone="error">{state.error}</Alert>
        ) : null}
      </fieldset>

      <div className="flex items-center justify-between gap-3 border-t-2 border-steel-700 bg-steel-900/60 px-6 py-4">
        {/* Switch: solo en modo creación */}
        {!isEditing ? (
          <label className="flex cursor-pointer items-center gap-2.5">
            <Switch
              checked={keepOpen}
              onCheckedChange={setKeepOpen}
              aria-label="Guardar y añadir otro"
            />
            <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Guardar y añadir otro
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
