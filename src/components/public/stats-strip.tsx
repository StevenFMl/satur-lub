import { Building2, FileText, HeadphonesIcon, TrendingUp } from "lucide-react";

type Stat = {
  icon: React.ReactNode;
  value: string;
  label: string;
  description: string;
};

const STATS: Stat[] = [
  {
    icon: <Building2 className="h-5 w-5" />,
    value: "120+",
    label: "Talleres activos",
    description: "Operando en Ecuador",
  },
  {
    icon: <FileText className="h-5 w-5" />,
    value: "180k",
    label: "Facturas emitidas",
    description: "Conectadas al SRI",
  },
  {
    icon: <TrendingUp className="h-5 w-5" />,
    value: "99,9%",
    label: "Disponibilidad",
    description: "Garantía de servicio",
  },
  {
    icon: <HeadphonesIcon className="h-5 w-5" />,
    value: "24/7",
    label: "Soporte humano",
    description: "Lun a Sáb por WhatsApp",
  },
];

export function StatsStrip() {
  return (
    <section className="relative z-10 w-full bg-zinc-950">
      <div className="mx-auto w-full max-w-7xl px-6 lg:px-10">
        <div className="grid grid-cols-2 divide-zinc-800 border-y border-zinc-800 lg:grid-cols-4 lg:divide-x">
          {STATS.map((s) => (
            <StatCell key={s.label} {...s} />
          ))}
        </div>
      </div>
    </section>
  );
}

function StatCell({ icon, value, label, description }: Stat) {
  return (
    <div className="flex items-center gap-4 px-5 py-6 sm:gap-5 sm:px-7 sm:py-7 lg:px-8">
      <div className="grid h-11 w-11 shrink-0 place-items-center border border-safety-500/30 bg-safety-500/10 text-safety-500">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-display text-[28px] leading-none tracking-[0.01em] text-white tabular-nums sm:text-[32px]">
          {value}
        </div>
        <div className="mt-1.5 text-[13px] font-semibold text-zinc-200">
          {label}
        </div>
        <div className="text-[11.5px] text-zinc-500">{description}</div>
      </div>
    </div>
  );
}
