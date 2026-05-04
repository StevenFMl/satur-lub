import { ArrowRight, ClipboardList, CreditCard, Wrench } from "lucide-react";

type Step = {
  number: string;
  title: string;
  body: string;
  icon: React.ReactNode;
  caption: string;
};

const STEP_DELAYS = ["", "delay-100", "delay-200"] as const;

const STEPS: Step[] = [
  {
    number: "01",
    title: "Recibes el vehículo",
    body: "Registras placa, kilometraje y trabajos solicitados en menos de 30 segundos. Si el cliente ya pasó por el taller, su ficha aparece automática.",
    icon: <ClipboardList className="h-5 w-5" />,
    caption: "Mostrador",
  },
  {
    number: "02",
    title: "Diagnosticas y reparas",
    body: "Asignas al técnico, anotas observaciones del box y registras los repuestos que se consumen. Todo queda dentro de la orden, sin papeles.",
    icon: <Wrench className="h-5 w-5" />,
    caption: "Box mecánico",
  },
  {
    number: "03",
    title: "Cobras y entregas",
    body: "Cierras la orden, emites la factura electrónica y entregas el vehículo. La caja del turno queda lista para el arqueo, sin cuadrar a mano.",
    icon: <CreditCard className="h-5 w-5" />,
    caption: "Caja",
  },
];

export function WorkflowSection() {
  return (
    <section
      id="como-opera"
      className="relative w-full overflow-hidden bg-zinc-950 py-16 md:py-24 lg:py-32"
    >
      {/* Gradiente superior: fusión suave con la wave del services */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-zinc-950 to-transparent"
      />
      <div aria-hidden className="absolute inset-0 carbon-fiber opacity-20" />
      <div
        aria-hidden
        className="absolute -bottom-32 left-[-10%] h-[480px] w-[480px] rounded-full bg-rust-600/10 blur-[140px]"
      />
      <div
        aria-hidden
        className="absolute -top-40 right-[-15%] h-[460px] w-[460px] rounded-full bg-safety-500/10 blur-[140px]"
      />

      <div className="relative mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Encabezado */}
        <div className="grid gap-8 lg:grid-cols-[1fr_1.4fr] lg:items-end">
          <div>
            <span className="text-[12px] font-bold uppercase tracking-[0.22em] text-safety-500 animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-both">
              Cómo funciona
            </span>
            <h2 className="mt-4 font-display text-[40px] leading-[0.95] tracking-[0.01em] text-white sm:text-[52px] lg:text-[64px] animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-both delay-100">
              Del mostrador
              <br />
              <span className="text-safety-500">a la caja,</span>
              <br />
              en tres pasos.
            </h2>
          </div>
          <p className="max-w-xl text-[15px] leading-7 text-zinc-400 lg:text-[16px] lg:leading-8 animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-both delay-200">
            SaturnLub colapsa el flujo entero del taller en un proceso lineal.
            Sin saltar entre planillas de Excel, cuadernos y notas pegadas en
            el monitor. Una orden, un técnico, un cobro.
          </p>
        </div>

        {/* Steps */}
        <ol className="mt-16 grid gap-6 sm:mt-20 md:grid-cols-3 md:gap-8">
          {STEPS.map((s, i) => (
            <li
              key={s.number}
              className={`relative flex animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-both ${STEP_DELAYS[i] ?? ""}`}
            >
              <StepCard step={s} isLast={i === STEPS.length - 1} />
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function StepCard({ step, isLast }: { step: Step; isLast: boolean }) {
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden border border-zinc-800 bg-zinc-900 p-7 shadow-bevel-sm transition-all duration-300 hover:-translate-y-1.5 hover:border-safety-500 hover:shadow-[0_0_0_1px_rgba(255,193,7,0.15),0_12px_28px_-8px_rgba(255,193,7,0.15)] sm:p-8">
      {/* Número gigante de fondo */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-2 -top-4 select-none font-display text-[140px] leading-none tracking-[0.02em] text-zinc-800"
      >
        {step.number}
      </span>

      {/* Connector flecha entre cards (desktop) */}
      {!isLast ? (
        <span
          aria-hidden
          className="absolute -right-5 top-12 hidden text-safety-500 md:block"
        >
          <ArrowRight className="h-5 w-5" strokeWidth={2.5} />
        </span>
      ) : null}

      {/* Caption + icon */}
      <div className="relative flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center border border-safety-500/30 bg-safety-500/10 text-safety-500">
          {step.icon}
        </div>
        <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-zinc-400">
          {step.caption}
        </span>
      </div>

      <h3 className="relative mt-6 font-display text-[26px] leading-tight tracking-[0.02em] text-white sm:text-[28px]">
        {step.title}
      </h3>
      <p className="relative mt-3 flex-1 text-[14px] leading-6 text-zinc-400">
        {step.body}
      </p>
    </div>
  );
}
