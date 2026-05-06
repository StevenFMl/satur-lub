"use client";

import * as React from "react";
import { useActionState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { FieldError } from "@/components/ui/field-error";
import {
  upsertSupplierAction,
  type SupplierState,
} from "@/actions/suppliers";
import type { SupplierRow } from "./suppliers-table";

type Props = {
  initial: SupplierRow | null;
  onSuccess: () => void;
};

export function SupplierForm({ initial, onSuccess }: Props) {
  const [state, formAction, pending] = useActionState<SupplierState, FormData>(
    upsertSupplierAction,
    null
  );

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
        className="m-0 flex-1 min-w-0 space-y-6 border-0 px-6 py-6 disabled:opacity-95"
      >
        <div className="space-y-2">
          <Label htmlFor="full_name" required>
            Nombre del proveedor
          </Label>
          <Input
            id="full_name"
            name="full_name"
            defaultValue={initial?.full_name ?? ""}
            placeholder="Distribuidora ACME"
            invalid={Boolean(errors.full_name)}
            autoFocus
          />
          <FieldError fieldId="full_name" message={errors.full_name} />
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-[120px_1fr]">
          <div className="space-y-2">
            <Label htmlFor="document_type" required>
              Tipo
            </Label>
            <Select
              id="document_type"
              name="document_type"
              defaultValue={initial?.document_type ?? "RUC"}
              invalid={Boolean(errors.document_type)}
            >
              <option value="RUC">RUC</option>
              <option value="CEDULA">Cédula</option>
            </Select>
            <FieldError fieldId="document_type" message={errors.document_type} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="document_number" required>
              Identificación
            </Label>
            <Input
              id="document_number"
              name="document_number"
              defaultValue={initial?.document_number ?? ""}
              inputMode="numeric"
              maxLength={13}
              mono
              placeholder="1234567890001"
              invalid={Boolean(errors.document_number)}
            />
            <FieldError
              fieldId="document_number"
              message={errors.document_number}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Correo</Label>
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={initial?.email ?? ""}
            placeholder="ventas@proveedor.ec"
            invalid={Boolean(errors.email)}
          />
          <FieldError fieldId="email" message={errors.email} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="phone">Teléfono</Label>
          <Input
            id="phone"
            name="phone"
            defaultValue={initial?.phone ?? ""}
            placeholder="+593 99 999 9999"
            mono
            invalid={Boolean(errors.phone)}
          />
          <FieldError fieldId="phone" message={errors.phone} />
        </div>

        <label className="flex cursor-pointer items-center gap-3 border-2 border-steel-700 bg-steel-950 px-4 py-3 transition-colors hover:border-steel-500">
          <input
            type="checkbox"
            name="is_active"
            value="true"
            defaultChecked={initial?.is_active ?? true}
            className="h-4 w-4 accent-safety-500"
          />
          <div className="space-y-0.5">
            <span className="font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-foreground">
              Proveedor activo
            </span>
            <p className="text-[11.5px] leading-4 text-muted-foreground">
              Solo los activos aparecen en la pantalla de recepción.
            </p>
          </div>
        </label>

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
          {initial?.id ? "Guardar cambios" : "Crear proveedor"}
        </Button>
      </div>
    </form>
  );
}
