"use client";

import * as React from "react";
import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert } from "@/components/ui/alert";
import { FieldError } from "@/components/ui/field-error";
import { upsertBranchAction, type BranchState } from "@/actions/branches";
import type { BranchRow } from "./branches-table";

type Props = {
  initial: BranchRow | null;
  onSuccess: () => void;
};

export function BranchForm({ initial, onSuccess }: Props) {
  const [state, formAction, pending] = useActionState<BranchState, FormData>(
    upsertBranchAction,
    null
  );

  const [isActive, setIsActive] = useState<boolean>(initial?.is_active ?? true);

  useEffect(() => {
    if (state?.ok) onSuccess();
  }, [state, onSuccess]);

  const errors = state?.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex h-full flex-col">
      {initial?.id ? (
        <input type="hidden" name="id" value={initial.id} />
      ) : null}

      <fieldset
        disabled={pending}
        className="m-0 min-w-0 flex-1 space-y-6 border-0 px-6 py-6 disabled:opacity-95"
      >
        <div className="space-y-2">
          <Label htmlFor="name" required>
            Nombre de la sucursal
          </Label>
          <Input
            id="name"
            name="name"
            defaultValue={initial?.branch_name ?? ""}
            placeholder="Matriz Ibarra"
            invalid={Boolean(errors.name)}
            autoFocus
          />
          <FieldError fieldId="name" message={errors.name} />
        </div>

        <div className="flex items-center justify-between gap-4 border-2 border-steel-700 bg-steel-950 px-4 py-3">
          <div className="min-w-0 space-y-0.5">
            <p className="font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-foreground">
              Sucursal activa
            </p>
            <p className="text-[11.5px] leading-4 text-muted-foreground">
              Solo las sucursales activas aparecen como destino de bodegas y
              ventas.
            </p>
          </div>
          <Switch
            name="is_active"
            checked={isActive}
            onCheckedChange={setIsActive}
            aria-label="Cambiar estado de la sucursal"
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
        <Button type="submit" size="md" loading={pending}>
          {initial?.id ? "Guardar cambios" : "Crear sucursal"}
        </Button>
      </div>
    </form>
  );
}
