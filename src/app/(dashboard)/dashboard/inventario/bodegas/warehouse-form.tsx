"use client";

import * as React from "react";
import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Alert } from "@/components/ui/alert";
import { FieldError } from "@/components/ui/field-error";
import {
  upsertWarehouseAction,
  type WarehouseState,
} from "@/actions/inventory";
import type { BranchOption, WarehouseRow } from "./warehouses-table";

type Props = {
  initial: WarehouseRow | null;
  branches: BranchOption[];
  onSuccess: () => void;
};

export function WarehouseForm({ initial, branches, onSuccess }: Props) {
  const [state, formAction, pending] = useActionState<WarehouseState, FormData>(
    upsertWarehouseAction,
    null
  );

  const [isActive, setIsActive] = useState<boolean>(initial?.is_active ?? true);

  useEffect(() => {
    if (state?.ok) onSuccess();
  }, [state, onSuccess]);

  const errors = state?.fieldErrors ?? {};
  // Defensa de flujo: una bodega siempre debe pertenecer a una sucursal
  // (matriz, sucursal norte, etc.). Bloqueamos el formulario hasta que el
  // usuario tenga al menos una sucursal creada para evitar bodegas huérfanas.
  const noBranches = branches.length === 0;

  return (
    <form action={formAction} className="flex h-full flex-col">
      {initial?.id ? (
        <input type="hidden" name="id" value={initial.id} />
      ) : null}

      <fieldset
        disabled={pending || noBranches}
        className="m-0 min-w-0 flex-1 space-y-6 border-0 px-6 py-6 disabled:opacity-95"
      >
        {noBranches ? (
          <Alert tone="error">
            <strong className="block font-semibold">
              Debes crear al menos una Sucursal primero.
            </strong>
            <span className="mt-1 block text-[12px] leading-5">
              Una bodega siempre pertenece a una sucursal.{" "}
              <a
                href="/dashboard/inventario/infraestructura"
                className="underline hover:text-red-200"
              >
                Crear sucursal →
              </a>
            </span>
          </Alert>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="name" required>
            Nombre de la bodega
          </Label>
          <Input
            id="name"
            name="name"
            defaultValue={initial?.name ?? ""}
            placeholder="Bodega central"
            invalid={Boolean(errors.name)}
            autoFocus
          />
          <FieldError fieldId="name" message={errors.name} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="branch_id" required={!noBranches}>
            Sucursal
          </Label>
          <Select
            id="branch_id"
            name="branch_id"
            defaultValue={initial?.branch_id ?? ""}
            invalid={Boolean(errors.branch_id)}
          >
            <option value="">— Sin sucursal asignada —</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.branch_name}
              </option>
            ))}
          </Select>
          <FieldError fieldId="branch_id" message={errors.branch_id} />
        </div>

        <div className="flex items-center justify-between gap-4 border-2 border-steel-700 bg-steel-950 px-4 py-3">
          <div className="min-w-0 space-y-0.5">
            <p className="font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-foreground">
              Bodega activa
            </p>
            <p className="text-[11.5px] leading-4 text-muted-foreground">
              Solo las bodegas activas aparecen en recepciones y traspasos.
            </p>
          </div>
          <Switch
            name="is_active"
            checked={isActive}
            onCheckedChange={setIsActive}
            aria-label="Cambiar estado de la bodega"
          />
        </div>

        {state?.error && !state.fieldErrors ? (
          <Alert tone="error">{state.error}</Alert>
        ) : null}
      </fieldset>

      <div className="flex items-center justify-end gap-3 border-t-2 border-steel-700 bg-steel-900/60 px-6 py-4">
        <Button
          type="button"
          variant="outline"
          size="md"
          onClick={onSuccess}
          disabled={pending}
        >
          Cancelar
        </Button>
        <Button
          type="submit"
          size="md"
          loading={pending}
          disabled={pending || noBranches}
        >
          {initial?.id ? "Guardar cambios" : "Crear bodega"}
        </Button>
      </div>
    </form>
  );
}
