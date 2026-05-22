"use client";

import * as React from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import {
  createQuickVehicleAction,
  type PickedVehicle,
} from "@/actions/vehicles";

type Props = {
  open:      boolean;
  onClose:   () => void;
  onCreated: (vehicle: PickedVehicle) => void;
  /** ID del business_partner al que se asocia el vehículo */
  partnerId: string;
};

export function QuickVehicleDialog({ open, onClose, onCreated, partnerId }: Props) {
  const [plate,      setPlate]      = React.useState("");
  const [make,       setMake]       = React.useState("");
  const [model,      setModel]      = React.useState("");
  const [year,       setYear]       = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error,      setError]      = React.useState<string | null>(null);
  const [fieldError, setFieldError] = React.useState<Record<string, string>>({});
  const plateRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) {
      setPlate("");
      setMake("");
      setModel("");
      setYear("");
      setError(null);
      setFieldError({});
      setSubmitting(false);
      const t = setTimeout(() => plateRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    setError(null);
    setFieldError({});
    setSubmitting(true);

    const yearNum = year.trim() ? parseInt(year.trim(), 10) : null;
    if (year.trim() && (isNaN(yearNum!) || yearNum! < 1900 || yearNum! > new Date().getFullYear() + 1)) {
      setFieldError({ year: "Año inválido." });
      setSubmitting(false);
      return;
    }

    const result = await createQuickVehicleAction({
      partner_id: partnerId,
      plate:      plate,
      make:       make  || null,
      model:      model || null,
      year:       yearNum,
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
    <Dialog open={open} onClose={!submitting ? onClose : () => {}} title="Nuevo vehículo" description="">
      <form onSubmit={handleSubmit}>
        <div className="space-y-4 px-6 py-5">

          {/* Plate — required */}
          <div className="space-y-1.5">
            <Label htmlFor="qv-plate">
              Placa <span className="text-red-400">*</span>
            </Label>
            <Input
              id="qv-plate"
              ref={plateRef}
              value={plate}
              onChange={(e) => {
                setPlate(e.target.value.toUpperCase());
                setFieldError((p) => ({ ...p, plate: "" }));
              }}
              placeholder="Ej: ABC-1234"
              maxLength={10}
              mono
              disabled={submitting}
            />
            {fieldError.plate ? (
              <p className="font-mono text-[11px] text-red-400">{fieldError.plate}</p>
            ) : null}
          </div>

          {/* Make + model — optional, side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="qv-make">
                Marca{" "}
                <span className="font-normal normal-case tracking-normal text-muted-foreground/60">(opc.)</span>
              </Label>
              <Input
                id="qv-make"
                value={make}
                onChange={(e) => setMake(e.target.value)}
                placeholder="Toyota"
                maxLength={40}
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qv-model">
                Modelo{" "}
                <span className="font-normal normal-case tracking-normal text-muted-foreground/60">(opc.)</span>
              </Label>
              <Input
                id="qv-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Hilux"
                maxLength={40}
                disabled={submitting}
              />
            </div>
          </div>

          {/* Year — optional */}
          <div className="space-y-1.5">
            <Label htmlFor="qv-year">
              Año{" "}
              <span className="font-normal normal-case tracking-normal text-muted-foreground/60">(opc.)</span>
            </Label>
            <Input
              id="qv-year"
              type="number"
              value={year}
              onChange={(e) => {
                setYear(e.target.value);
                setFieldError((p) => ({ ...p, year: "" }));
              }}
              placeholder={String(new Date().getFullYear())}
              min={1900}
              max={new Date().getFullYear() + 1}
              mono
              disabled={submitting}
            />
            {fieldError.year ? (
              <p className="font-mono text-[11px] text-red-400">{fieldError.year}</p>
            ) : null}
          </div>

          {/* Fase 3 hook: historial de servicios irá aquí */}

          {error ? <Alert tone="error">{error}</Alert> : null}
        </div>

        <div className="flex items-center justify-end gap-3 border-t-2 border-steel-700 bg-steel-900/60 px-6 py-4">
          <Button type="button" variant="outline" size="md" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button type="submit" size="md" loading={submitting} className="min-w-[130px]">
            Registrar vehículo
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
