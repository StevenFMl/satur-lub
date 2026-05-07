"use client";

import * as React from "react";
import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { FieldError } from "@/components/ui/field-error";
import {
  upsertCustomerAction,
  type CustomerState,
} from "@/actions/customers";
import { CONSUMIDOR_FINAL_DOC } from "@/lib/validations/customer";
import type { CustomerRow } from "./customers-table";

type Props = {
  initial: CustomerRow | null;
  onSuccess: () => void;
};

export function CustomerForm({ initial, onSuccess }: Props) {
  const [state, formAction, pending] = useActionState<CustomerState, FormData>(
    upsertCustomerAction,
    null
  );

  useEffect(() => {
    if (state?.ok) onSuccess();
  }, [state, onSuccess]);

  const errors = state?.fieldErrors ?? {};

  // Track document_type to show/hide document_number field
  const [docType, setDocType] = useState<string>(
    initial?.document_type ?? "CONSUMIDOR_FINAL"
  );

  const isCF = docType === "CONSUMIDOR_FINAL";

  return (
    <form action={formAction} className="flex h-full flex-col">
      {initial?.id ? (
        <input type="hidden" name="id" value={initial.id} />
      ) : null}

      <fieldset
        disabled={pending}
        className="m-0 flex-1 min-w-0 space-y-5 border-0 px-6 py-6 disabled:opacity-95"
      >
        {/* ── Nombre (obligatorio, autoFocus) ── */}
        <div className="space-y-2">
          <Label htmlFor="full_name" required>
            Nombre del cliente
          </Label>
          <Input
            id="full_name"
            name="full_name"
            defaultValue={initial?.full_name ?? ""}
            placeholder="Juan Pérez"
            invalid={Boolean(errors.full_name)}
            autoFocus
          />
          <FieldError fieldId="full_name" message={errors.full_name} />
        </div>

        {/* ── Teléfono (prioridad alta) ── */}
        <div className="space-y-2">
          <Label htmlFor="phone">Teléfono</Label>
          <Input
            id="phone"
            name="phone"
            defaultValue={initial?.phone ?? ""}
            placeholder="0999 123 456"
            mono
            invalid={Boolean(errors.phone)}
          />
          <FieldError fieldId="phone" message={errors.phone} />
        </div>

        {/* ── Datos Fiscales (colapsados) ── */}
        <details className="group rounded-sm border-2 border-steel-700 bg-steel-950 transition-colors open:border-steel-600">
          <summary className="flex min-h-[44px] cursor-pointer select-none items-center gap-2 px-4 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground">
            <ChevronIcon className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
            Datos Fiscales (SRI)
            {!isCF && (
              <span className="ml-auto rounded bg-safety-500/20 px-1.5 py-0.5 text-[10px] text-safety-400">
                Personalizado
              </span>
            )}
          </summary>
          <div className="space-y-4 border-t border-steel-700 px-4 py-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[140px_1fr]">
              <div className="space-y-2">
                <Label htmlFor="document_type">Tipo</Label>
                <Select
                  id="document_type"
                  name="document_type"
                  defaultValue={docType}
                  invalid={Boolean(errors.document_type)}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                    setDocType(e.target.value)
                  }
                >
                  <option value="CONSUMIDOR_FINAL">Consumidor Final</option>
                  <option value="CEDULA">Cédula</option>
                  <option value="RUC">RUC</option>
                  <option value="PASAPORTE">Pasaporte</option>
                </Select>
                <FieldError
                  fieldId="document_type"
                  message={errors.document_type}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="document_number">
                  Identificación
                </Label>
                {isCF ? (
                  <>
                    <Input
                      id="document_number"
                      name="document_number"
                      value={CONSUMIDOR_FINAL_DOC}
                      readOnly
                      mono
                      className="opacity-50"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Se usa el número genérico del SRI.
                    </p>
                  </>
                ) : (
                  <>
                    <Input
                      id="document_number"
                      name="document_number"
                      defaultValue={
                        initial?.document_number &&
                        initial.document_number !== CONSUMIDOR_FINAL_DOC
                          ? initial.document_number
                          : ""
                      }
                      inputMode="numeric"
                      maxLength={13}
                      mono
                      placeholder={
                        docType === "RUC"
                          ? "1234567890001"
                          : docType === "PASAPORTE"
                          ? "AB1234567"
                          : "0102030405"
                      }
                      invalid={Boolean(errors.document_number)}
                    />
                    <FieldError
                      fieldId="document_number"
                      message={errors.document_number}
                    />
                  </>
                )}
              </div>
            </div>
          </div>
        </details>

        {/* ── Más datos (colapsados) ── */}
        <details className="group rounded-sm border-2 border-steel-700 bg-steel-950 transition-colors open:border-steel-600">
          <summary className="flex min-h-[44px] cursor-pointer select-none items-center gap-2 px-4 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground">
            <ChevronIcon className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
            Más datos
          </summary>
          <div className="space-y-4 border-t border-steel-700 px-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="email">Correo</Label>
              <Input
                id="email"
                name="email"
                type="email"
                defaultValue={initial?.email ?? ""}
                placeholder="cliente@email.com"
                invalid={Boolean(errors.email)}
              />
              <FieldError fieldId="email" message={errors.email} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="address">Dirección</Label>
              <Input
                id="address"
                name="address"
                defaultValue=""
                placeholder="Av. Principal y Calle Secundaria"
                invalid={Boolean(errors.address)}
              />
              <FieldError fieldId="address" message={errors.address} />
            </div>
          </div>
        </details>

        {/* ── Estado activo ── */}
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
              Cliente activo
            </span>
            <p className="text-[11.5px] leading-4 text-muted-foreground">
              Solo los activos aparecen al registrar ventas.
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
          {initial?.id ? "Guardar cambios" : "Crear cliente"}
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Inline SVG icon                                                     */
/* ------------------------------------------------------------------ */

function ChevronIcon({ className }: { className?: string }) {
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
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
