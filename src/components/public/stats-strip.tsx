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
      {/* Gradiente superior para fundir con el hero */}
      <div
        aria-hidden
        className="absolute inset-x-0 -top-1 h-8 bg-gradient-to-b from-zinc-950 to-transparent"
      />

      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 divide-zinc-800 border-y border-zinc-800 lg:grid-cols-4 lg:divide-x">
          {STATS.map((s) => (
            <StatCell key={s.label} {...s} />
          ))}
        </div>
      </div>

      {/* Gradiente inferior: anticipar la transición al fondo claro de services */}
      <div
        aria-hidden
        className="h-16 w-full bg-gradient-to-b from-zinc-950 via-zinc-950 to-zinc-900 sm:h-20"
      />
    </section>
  );
}

function StatCell({ icon, value, label, description }: Stat) {
  return (
    <div className="group/stat flex items-center gap-4 px-5 py-7 transition-colors duration-200 hover:bg-zinc-900/50 sm:gap-5 sm:px-7 sm:py-8 lg:px-8 lg:py-9">
      <div className="grid h-11 w-11 shrink-0 place-items-center border border-safety-500/30 bg-safety-500/10 text-safety-500 transition-all duration-200 group-hover/stat:border-safety-500/60 group-hover/stat:bg-safety-500/20">
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
