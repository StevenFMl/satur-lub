"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { voidSaleAction } from "@/actions/sales";

type Props = {
  saleId:    string;
  open:      boolean;
  onClose:   () => void;
  onSuccess: () => void;
};

export function VoidDialog({ saleId, open, onClose, onSuccess }: Props) {
  const [reason,   setReason]   = React.useState("");
  const [note,     setNote]     = React.useState("");
  const [loading,  setLoading]  = React.useState(false);
  const [error,    setError]    = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) { setReason(""); setNote(""); setError(null); setLoading(false); }
  }, [open]);

  const canSubmit = reason.trim().length >= 3 && !loading;

  const handleVoid = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);

    const result = await voidSaleAction({
      sale_id: saleId,
      reason:  reason.trim(),
      note:    note.trim() || null,
    });

    setLoading(false);

    if (result?.error) {
      setError(result.error);
      return;
    }

    onSuccess();
  };

  return (
    <Dialog
      open={open}
      onClose={!loading ? onClose : () => {}}
      title="Anular venta"
      description=""
    >
      <div className="space-y-4 px-6 py-5">
        {/* Warning */}
        <div className="flex gap-3 rounded-sm border border-red-500/30 bg-red-500/5 px-4 py-3">
          <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <div className="space-y-0.5">
            <p className="text-[12.5px] font-semibold text-red-400">
              Acción irreversible
            </p>
            <p className="text-[11.5px] text-muted-foreground">
              La venta quedará anulada y el stock se repondrá. Los pagos permanecen
              registrados para conciliación.
            </p>
          </div>
        </div>

        {/* Reason */}
        <div className="space-y-1.5">
          <Label htmlFor="void-reason">
            Motivo de anulación{" "}
            <span className="font-normal text-red-400">*</span>
          </Label>
          <Input
            id="void-reason"
            value={reason}
            onChange={(e) => { setReason(e.target.value); setError(null); }}
            placeholder="Ej: Error de cobro, producto equivocado..."
            maxLength={200}
            autoFocus
          />
        </div>

        {/* Note */}
        <div className="space-y-1.5">
          <Label htmlFor="void-note">
            Nota adicional{" "}
            <span className="font-normal normal-case tracking-normal text-muted-foreground/60">
              (opcional)
            </span>
          </Label>
          <Input
            id="void-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Información adicional para el registro..."
            maxLength={500}
          />
        </div>

        {error ? <Alert tone="error">{error}</Alert> : null}
      </div>

      <div className="flex items-center justify-end gap-3 border-t-2 border-steel-700 bg-steel-900/60 px-6 py-4">
        <Button variant="outline" size="md" onClick={onClose} disabled={loading}>
          Cancelar
        </Button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={handleVoid}
          className={[
            "inline-flex h-10 items-center justify-center gap-2 rounded-sm border-2 px-5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] transition-all",
            canSubmit
              ? "border-red-500/70 bg-red-500/10 text-red-400 hover:bg-red-500/20"
              : "cursor-not-allowed border-steel-700 text-muted-foreground/40",
          ].join(" ")}
        >
          {loading ? (
            <span className="flex items-center gap-1.5">
              <SpinIcon className="h-3.5 w-3.5 animate-spin" />
              Anulando...
            </span>
          ) : (
            "Anular venta"
          )}
        </button>
      </div>
    </Dialog>
  );
}

function AlertTriangleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function SpinIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

// re-export so page/detail can use it without their own hook
export function useVoidDialog() {
  const router = useRouter();
  const [targetId, setTargetId] = React.useState<string | null>(null);

  const open   = (id: string) => setTargetId(id);
  const close  = () => setTargetId(null);
  const handle = targetId ? (
    <VoidDialog
      saleId={targetId}
      open={!!targetId}
      onClose={close}
      onSuccess={() => { close(); router.refresh(); }}
    />
  ) : null;

  return { open, handle };
}
