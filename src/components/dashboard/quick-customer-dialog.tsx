"use client";

import * as React from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import {
  createQuickCustomerAction,
  type PickedCustomer,
} from "@/actions/customers";

type DocType = "CEDULA" | "RUC" | "PASAPORTE";

const DOC_OPTIONS: { value: DocType; label: string; placeholder: string; maxLen: number }[] = [
  { value: "CEDULA",    label: "Cédula",    placeholder: "10 dígitos",              maxLen: 10  },
  { value: "RUC",       label: "RUC",       placeholder: "13 dígitos",              maxLen: 13  },
  { value: "PASAPORTE", label: "Pasaporte", placeholder: "Número de pasaporte",     maxLen: 20  },
];

type Props = {
  open:      boolean;
  onClose:   () => void;
  onCreated: (customer: PickedCustomer) => void;
};

export function QuickCustomerDialog({ open, onClose, onCreated }: Props) {
  const [fullName,   setFullName]   = React.useState("");
  const [docType,    setDocType]    = React.useState<DocType>("CEDULA");
  const [docNumber,  setDocNumber]  = React.useState("");
  const [phone,      setPhone]      = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error,      setError]      = React.useState<string | null>(null);
  const [fieldError, setFieldError] = React.useState<Record<string, string>>({});
  const nameRef = React.useRef<HTMLInputElement>(null);

  // Reset form when dialog opens
  React.useEffect(() => {
    if (open) {
      setFullName("");
      setDocType("CEDULA");
      setDocNumber("");
      setPhone("");
      setError(null);
      setFieldError({});
      setSubmitting(false);
      // Autofocus name field on next tick (Dialog animation)
      const t = setTimeout(() => nameRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [open]);

  const selectedDoc = DOC_OPTIONS.find((d) => d.value === docType)!;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    setError(null);
    setFieldError({});
    setSubmitting(true);

    const result = await createQuickCustomerAction({
      full_name:       fullName,
      document_type:   docType,
      document_number: docNumber,
      phone:           phone || null,
    });

    setSubmitting(false);

    if ("error" in result) {
      if (result.field) {
        setFieldError({ [result.field]: result.error });
      } else {
        setError(result.error);
      }
      return;
    }

    onCreated(result.data);
  };

  return (
    <Dialog open={open} onClose={!submitting ? onClose : () => {}} title="Nuevo cliente" description="">
      <form onSubmit={handleSubmit}>
        <div className="space-y-4 px-6 py-5">

          {/* Full name */}
          <div className="space-y-1.5">
            <Label htmlFor="qc-name">
              Nombre completo <span className="text-red-400">*</span>
            </Label>
            <Input
              id="qc-name"
              ref={nameRef}
              value={fullName}
              onChange={(e) => { setFullName(e.target.value); setFieldError((p) => ({ ...p, full_name: "" })); }}
              placeholder="Ej: Juan Pérez García"
              maxLength={120}
              disabled={submitting}
            />
            {fieldError.full_name ? (
              <p className="font-mono text-[11px] text-red-400">{fieldError.full_name}</p>
            ) : null}
          </div>

          {/* Document type + number */}
          <div className="space-y-1.5">
            <Label>
              Identificación <span className="text-red-400">*</span>
            </Label>
            {/* Type selector */}
            <div className="grid grid-cols-3 gap-1.5">
              {DOC_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={submitting}
                  onClick={() => { setDocType(opt.value); setDocNumber(""); setFieldError((p) => ({ ...p, document_number: "" })); }}
                  className={[
                    "rounded-sm border-2 px-2 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.1em] transition-all",
                    docType === opt.value
                      ? "border-safety-500 bg-safety-500/10 text-safety-500"
                      : "border-steel-700 bg-steel-900 text-muted-foreground hover:border-steel-600",
                  ].join(" ")}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {/* Document number */}
            <Input
              id="qc-docnum"
              value={docNumber}
              onChange={(e) => { setDocNumber(e.target.value.replace(/\D/g, "")); setFieldError((p) => ({ ...p, document_number: "" })); }}
              placeholder={selectedDoc.placeholder}
              maxLength={selectedDoc.maxLen}
              mono
              disabled={submitting}
            />
            {fieldError.document_number ? (
              <p className="font-mono text-[11px] text-red-400">{fieldError.document_number}</p>
            ) : null}
          </div>

          {/* Phone */}
          <div className="space-y-1.5">
            <Label htmlFor="qc-phone">
              Teléfono{" "}
              <span className="font-normal normal-case tracking-normal text-muted-foreground/60">(opcional)</span>
            </Label>
            <Input
              id="qc-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Ej: 0991234567"
              maxLength={20}
              disabled={submitting}
            />
          </div>

          {/* Vehicle hook — future Fase 2 (no-op for now) */}
          {/* Aquí irá el selector de vehículo en Fase 2 */}

          {error ? <Alert tone="error">{error}</Alert> : null}
        </div>

        <div className="flex items-center justify-end gap-3 border-t-2 border-steel-700 bg-steel-900/60 px-6 py-4">
          <Button type="button" variant="outline" size="md" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button type="submit" size="md" loading={submitting} className="min-w-[130px]">
            Crear y seleccionar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
