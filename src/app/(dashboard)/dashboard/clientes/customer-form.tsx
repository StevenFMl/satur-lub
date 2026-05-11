"use client";

import * as React from "react";
import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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

  const [docType, setDocType] = useState<string>(
    initial?.document_type ?? "CONSUMIDOR_FINAL"
  );

  const isCF = docType === "CONSUMIDOR_FINAL";
  const isEditing = Boolean(initial?.id);

  return (
    <form action={formAction} className="flex h-full flex-col">
      {initial?.id ? (
        <input type="hidden" name="id" value={initial.id} />
      ) : null}

      <div className="flex-1 overflow-y-auto">
        <fieldset
          disabled={pending}
          className="m-0 min-w-0 space-y-0 border-0 p-0 disabled:opacity-95"
        >
          {/* ════════════════════════════════════════════════════════════
              SECCIÓN 1 — DATOS BÁSICOS
              ════════════════════════════════════════════════════════════ */}
          <section>
            <SectionHeader
              icon={<UserIcon className="h-4 w-4" />}
              title="Datos básicos"
              hint="Solo el nombre es obligatorio. El teléfono facilita la búsqueda."
            />
            <div className="space-y-5 px-5 py-5 sm:px-6">
              <div className="space-y-2">
                <Label htmlFor="full_name" required>
                  Nombre completo o razón social
                </Label>
                <Input
                  id="full_name"
                  name="full_name"
                  defaultValue={initial?.full_name ?? ""}
                  placeholder="Juan Pérez / Lubricentro Express S.A."
                  invalid={Boolean(errors.full_name)}
                  autoFocus
                />
                <FieldError fieldId="full_name" message={errors.full_name} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Teléfono</Label>
                <Input
                  id="phone"
                  name="phone"
                  type="tel"
                  defaultValue={initial?.phone ?? ""}
                  placeholder="0999 123 456"
                  mono
                  invalid={Boolean(errors.phone)}
                />
                <FieldError fieldId="phone" message={errors.phone} />
                <p className="field-hint">Celular o fijo. Facilita buscarlo en el POS.</p>
              </div>
            </div>
          </section>

          {/* ════════════════════════════════════════════════════════════
              SECCIÓN 2 — IDENTIFICACIÓN FISCAL
              ════════════════════════════════════════════════════════════ */}
          <section className="border-t border-steel-800">
            <SectionHeader
              icon={<IdCardIcon className="h-4 w-4" />}
              title="Identificación fiscal"
              badge={
                isCF ? (
                  <Badge tone="warning">
                    <ShieldIcon className="h-3 w-3" />
                    Consumidor Final
                  </Badge>
                ) : (
                  <Badge tone="info">Personalizado</Badge>
                )
              }
            />
            <div className="space-y-5 px-5 py-5 sm:px-6">
              <div className="space-y-2">
                <Label htmlFor="document_type">Tipo de documento</Label>
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
                <FieldError fieldId="document_type" message={errors.document_type} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="document_number">
                  Número de identificación
                </Label>
                {isCF ? (
                  <>
                    <div className="relative">
                      <Input
                        id="document_number"
                        name="document_number"
                        value={CONSUMIDOR_FINAL_DOC}
                        readOnly
                        mono
                        className="bg-steel-900/50 pr-12 opacity-60"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2">
                        <LockIcon className="h-4 w-4 text-safety-500/60" />
                      </span>
                    </div>
                    <div className="flex items-start gap-2 rounded-sm border border-safety-500/20 bg-safety-500/5 px-3 py-2">
                      <ShieldIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-safety-500/70" />
                      <p className="text-[11px] leading-4 text-safety-400/80">
                        Número genérico del SRI para ventas sin factura.
                        Este registro no se puede modificar ni eliminar.
                      </p>
                    </div>
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
                    <FieldError fieldId="document_number" message={errors.document_number} />
                    <p className="field-hint">
                      {docType === "RUC"
                        ? "13 dígitos para persona jurídica."
                        : docType === "PASAPORTE"
                        ? "Número alfanumérico del documento."
                        : "10 dígitos de la cédula ecuatoriana."}
                    </p>
                  </>
                )}
              </div>
            </div>
          </section>

          {/* ════════════════════════════════════════════════════════════
              SECCIÓN 3 — CONTACTO Y UBICACIÓN
              ════════════════════════════════════════════════════════════ */}
          <section className="border-t border-steel-800">
            <SectionHeader
              icon={<MapPinIcon className="h-4 w-4" />}
              title="Contacto y ubicación"
              hint="Opcionales. Útiles si el cliente necesita factura."
            />
            <div className="space-y-5 px-5 py-5 sm:px-6">
              <div className="space-y-2">
                <Label htmlFor="email">Correo electrónico</Label>
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
                  defaultValue={initial?.address ?? ""}
                  placeholder="Av. Principal y Calle Secundaria"
                  invalid={Boolean(errors.address)}
                />
                <FieldError fieldId="address" message={errors.address} />
              </div>
            </div>
          </section>

          {/* ════════════════════════════════════════════════════════════
              SECCIÓN 4 — NOTAS
              ════════════════════════════════════════════════════════════ */}
          <section className="border-t border-steel-800">
            <SectionHeader
              icon={<NoteIcon className="h-4 w-4" />}
              title="Notas internas"
              hint="Solo visibles para tu equipo."
            />
            <div className="px-5 py-5 sm:px-6">
              <div className="space-y-2">
                <textarea
                  id="notes"
                  name="notes"
                  defaultValue={initial?.notes ?? ""}
                  placeholder="Prefiere lubricante sintético, viene cada 3 meses, vehículo Hyundai Tucson..."
                  maxLength={500}
                  rows={3}
                  className="flex w-full resize-none rounded-sm border-2 border-steel-700 bg-steel-950 px-4 py-3 text-[14px] font-medium leading-6 text-foreground shadow-control-inset transition-all duration-150 ease-out placeholder:font-normal placeholder:text-muted-foreground hover:border-steel-500 focus:outline-none focus-visible:border-safety-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500/45 disabled:cursor-not-allowed disabled:opacity-60"
                />
                <FieldError fieldId="notes" message={errors.notes} />
              </div>
            </div>
          </section>

          {/* ════════════════════════════════════════════════════════════
              SECCIÓN 5 — ESTADO
              ════════════════════════════════════════════════════════════ */}
          <section className="border-t border-steel-800">
            <div className="px-5 py-4 sm:px-6">
              <label className="flex cursor-pointer items-center gap-4 rounded-sm border-2 border-steel-700 bg-steel-950 px-4 py-3.5 transition-colors hover:border-steel-500">
                <input
                  type="checkbox"
                  name="is_active"
                  value="true"
                  defaultChecked={initial?.is_active ?? true}
                  className="h-5 w-5 shrink-0 rounded-sm accent-safety-500"
                />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <span className="block font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-foreground">
                    Cliente activo
                  </span>
                  <span className="block text-[11.5px] leading-4 text-muted-foreground">
                    Los inactivos no aparecerán en el POS ni al registrar ventas.
                  </span>
                </div>
              </label>
            </div>
          </section>

          {/* ── Error global ── */}
          {state?.error && !state.fieldErrors ? (
            <div className="border-t border-steel-800 px-5 py-4 sm:px-6">
              <Alert tone="error">{state.error}</Alert>
            </div>
          ) : null}
        </fieldset>
      </div>

      {/* ════════════════════════════════════════════════════════════
          BARRA DE ACCIONES
          ════════════════════════════════════════════════════════════ */}
      <div className="shrink-0 border-t-2 border-steel-700 bg-steel-900/60 px-5 py-4 sm:px-6">
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={onSuccess}
            disabled={pending}
            className="w-full sm:w-auto"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            size="md"
            loading={pending}
            className="w-full sm:w-auto sm:min-w-[180px]"
          >
            {isEditing ? "Guardar cambios" : "Crear cliente"}
          </Button>
        </div>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Section header — reutilizable para secciones del formulario         */
/* ------------------------------------------------------------------ */

function SectionHeader({
  icon,
  title,
  hint,
  badge,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  badge?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 bg-steel-900/40 px-5 py-3.5 sm:px-6">
      <span className="mt-0.5 shrink-0 text-muted-foreground/60">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            {title}
          </h3>
          {badge}
        </div>
        {hint && (
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground/50">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Inline SVG icons                                                    */
/* ------------------------------------------------------------------ */

function UserIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
    </svg>
  );
}

function IdCardIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 15h4M7 11h2" />
      <circle cx="15" cy="11" r="2" />
      <path d="M13 15c0-1.1.9-2 2-2s2 .9 2 2" />
    </svg>
  );
}

function MapPinIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1 1 16 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function NoteIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8M8 17h5" />
    </svg>
  );
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
