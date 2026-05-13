"use client";

import * as React from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CONSUMIDOR_FINAL_DOC } from "@/lib/validations/customer";
import type { CustomerRow } from "./customers-table";
import type { ReceivableRow } from "@/lib/validations/receivable";

type Props = {
  customer:      CustomerRow;
  onEdit:        () => void;
  onToggleActive: () => void;
  togglePending: boolean;
  receivables?:  ReceivableRow[];
};

function isConsumidorFinal(row: CustomerRow): boolean {
  return (
    row.document_type === "CONSUMIDOR_FINAL" &&
    row.document_number === CONSUMIDOR_FINAL_DOC
  );
}

const dateFmt = new Intl.DateTimeFormat("es-EC", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});

const docLabel = (type: string) => {
  switch (type) {
    case "CEDULA":
      return "Cédula";
    case "RUC":
      return "RUC";
    case "PASAPORTE":
      return "Pasaporte";
    case "CONSUMIDOR_FINAL":
      return "Consumidor Final";
    default:
      return type;
  }
};

export function CustomerDetail({
  customer,
  onEdit,
  onToggleActive,
  togglePending,
  receivables = [],
}: Props) {
  const isCF = isConsumidorFinal(customer);
  const initials = customer.full_name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        {/* ── Avatar + nombre ── */}
        <div className="flex flex-col items-center gap-3 border-b border-steel-700 px-6 py-6">
          <div
            className={
              "grid h-16 w-16 place-items-center rounded-sm border-2 text-[22px] font-bold " +
              (isCF
                ? "border-safety-500/40 bg-safety-500/10 text-safety-500"
                : "border-steel-600 bg-steel-800 text-foreground")
            }
          >
            {isCF ? (
              <LockIcon className="h-7 w-7" />
            ) : (
              <span className="font-display tracking-wider">{initials}</span>
            )}
          </div>

          <div className="text-center">
            <h3 className="font-display text-[22px] tracking-[0.04em] text-foreground">
              {customer.full_name.toUpperCase()}
            </h3>
            <div className="mt-1.5 flex items-center justify-center gap-2">
              <Badge tone={customer.is_active ? "active" : "neutral"}>
                {customer.is_active ? "Activo" : "Inactivo"}
              </Badge>
              {isCF && <Badge tone="warning">Protegido SRI</Badge>}
            </div>
          </div>
        </div>

        {/* ── Datos clave ── */}
        <div className="space-y-0 divide-y divide-steel-800">
          <DetailRow
            icon={<IdIcon className="h-4 w-4" />}
            label={docLabel(customer.document_type)}
            value={customer.document_number}
            mono
          />
          {customer.phone && (
            <DetailRow
              icon={<PhoneIcon className="h-4 w-4" />}
              label="Teléfono"
              value={customer.phone}
              mono
            />
          )}
          {customer.email && (
            <DetailRow
              icon={<MailIcon className="h-4 w-4" />}
              label="Email"
              value={customer.email}
            />
          )}
          {customer.address && (
            <DetailRow
              icon={<MapIcon className="h-4 w-4" />}
              label="Dirección"
              value={customer.address}
            />
          )}
          <DetailRow
            icon={<CalendarIcon className="h-4 w-4" />}
            label="Registro"
            value={dateFmt.format(new Date(customer.created_at))}
          />
        </div>

        {/* ── Cuenta corriente (fiado) ── */}
        {(() => {
          if (isCF || receivables.length === 0) return null;
          const moneyFmt = new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
          const active   = receivables.filter((r) => r.status !== "paid" && r.status !== "cancelled");
          const overdue  = active.filter((r) => r.is_overdue);
          const total    = active.reduce((s, r) => s + r.balance_due, 0);
          if (active.length === 0) return null;
          return (
            <div className="border-t border-steel-700 px-6 py-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground/70">
                  Cuenta corriente (fiado)
                </span>
                <Link
                  href="/dashboard/pos/fiado"
                  className="font-mono text-[10px] uppercase tracking-[0.12em] text-safety-500 hover:text-safety-400 transition-colors"
                >
                  Ver todo →
                </Link>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <MiniStat label="Saldo total" value={moneyFmt.format(total)} tone={total > 0 ? "warning" : "neutral"} />
                <MiniStat label="Cuentas" value={String(active.length)} tone="neutral" />
                <MiniStat label="Vencidas" value={String(overdue.length)} tone={overdue.length > 0 ? "error" : "neutral"} />
              </div>
            </div>
          );
        })()}

        {/* ── Notas ── */}
        {customer.notes && (
          <div className="border-t border-steel-700 px-6 py-4">
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground/70">
              Notas
            </div>
            <p className="mt-2 whitespace-pre-wrap text-[13px] leading-5 text-muted-foreground">
              {customer.notes}
            </p>
          </div>
        )}
      </div>

      {/* ── Acciones ── */}
      <div className="flex items-center gap-3 border-t-2 border-steel-700 bg-steel-900/60 px-6 py-4">
        {isCF ? (
          <div className="flex flex-1 items-center justify-center gap-2 py-1 text-[12px] text-muted-foreground">
            <LockIcon className="h-3.5 w-3.5" />
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.14em]">
              Registro protegido por SRI
            </span>
          </div>
        ) : (
          <>
            <Button
              variant="outline"
              size="md"
              className="flex-1"
              onClick={onToggleActive}
              loading={togglePending}
            >
              {customer.is_active ? "Inactivar" : "Reactivar"}
            </Button>
            <Button size="md" className="flex-1" onClick={onEdit}>
              <PencilIcon className="h-4 w-4" />
              Editar
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Detail row helper ── */
function DetailRow({
  icon,
  label,
  value,
  mono,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 px-6 py-3.5">
      <span className="mt-0.5 shrink-0 text-muted-foreground/60">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground/60">
          {label}
        </div>
        <div
          className={
            "mt-0.5 text-[14px] text-foreground " +
            (mono ? "font-mono tabular-nums tracking-[0.02em]" : "")
          }
        >
          {value}
        </div>
      </div>
    </div>
  );
}

/* ── Icons ── */
function IdIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 15h4M7 11h2" />
      <circle cx="15" cy="11" r="2" />
      <path d="M13 15c0-1.1.9-2 2-2s2 .9 2 2" />
    </svg>
  );
}

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function MailIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function MapIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1 1 16 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
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

function MiniStat({ label, value, tone }: { label: string; value: string; tone: "neutral" | "warning" | "error" }) {
  const tones = {
    neutral: "text-foreground",
    warning: "text-signal-400",
    error:   "text-red-400",
  };
  return (
    <div className="rounded-sm border border-steel-700 bg-steel-900/40 px-2 py-2 text-center">
      <p className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground/60">{label}</p>
      <p className={["mt-1 font-mono text-[14px] font-bold tabular-nums", tones[tone]].join(" ")}>{value}</p>
    </div>
  );
}
