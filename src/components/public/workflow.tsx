type Step = {
  number: string;
  title: string;
  body: string;
  hud: string;
};

const STEPS: Step[] = [
  {
    number: "01",
    title: "Recibe el vehículo",
    body: "Registra placa, kilometraje y servicio solicitado en menos de 30 segundos. La ficha del vehículo aparece automática si ya pasó por tu taller.",
    hud: "Mostrador · Recepción",
  },
  {
    number: "02",
    title: "Asigna y diagnostica",
    body: "Asigna al técnico, anota observaciones del box y registra repuestos consumidos. Todo queda en la orden, sin papeles que perder.",
    hud: "Box mecánico · Operación",
  },
  {
    number: "03",
    title: "Cobra y entrega",
    body: "Cierra la orden, emite el comprobante con tus datos fiscales y entrega el vehículo. La caja del turno queda lista para el arqueo.",
    hud: "Caja · Cierre",
  },
];

export function WorkflowSection() {
  return (
    <section
      id="como-opera"
      className="relative w-full overflow-hidden bg-steel-950 py-24 sm:py-28 lg:py-32"
    >
      {/* Carbon fiber muy sutil de fondo */}
      <div aria-hidden className="absolute inset-0 carbon-fiber opacity-30" />
      {/* Spotlight rust en la esquina */}
      <div
        aria-hidden
        className="absolute -bottom-32 left-[-15%] h-[480px] w-[480px] rounded-full bg-rust-600/10 blur-[140px]"
      />

      <div className="relative mx-auto w-full max-w-7xl px-6 lg:px-10">
        {/* Encabezado */}
        <div className="grid gap-8 lg:grid-cols-[1fr_1.4fr] lg:items-end">
          <div>
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-safety-500">
              Cómo opera tu taller
            </span>
            <h2 className="mt-4 font-display text-[44px] leading-[0.95] tracking-[0.01em] text-foreground sm:text-[56px] lg:text-[64px]">
              DEL MOSTRADOR
              <br />
              <span className="text-safety-500">A LA CAJA</span>, EN
              <br />
              TRES MOVIMIENTOS.
            </h2>
          </div>
          <p className="max-w-xl text-[15px] leading-7 text-zinc-400 lg:text-[16px] lg:leading-8">
            SaturnLub colapsa el flujo entero del taller en un proceso lineal.
            Sin saltar entre planillas de Excel, cuadernos y notas pegadas en
            el monitor. Una orden, un técnico, un cobro.
          </p>
        </div>

        {/* Steps */}
        <ol className="mt-16 grid gap-6 md:grid-cols-3 md:gap-8">
          {STEPS.map((s, i) => (
            <li key={s.number} className="relative">
              <StepCard step={s} isLast={i === STEPS.length - 1} />
            </li>
          ))}
        </ol>

        {/* Bottom strip */}
        <div className="mt-16 flex flex-col items-start justify-between gap-4 border-t border-steel-700 pt-6 sm:flex-row sm:items-center">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
            Listo para usar · Sin instalación · Sin migraciones forzadas
          </p>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-safety-500">
            ● Operativo en 5 minutos
          </span>
        </div>
      </div>
    </section>
  );
}

function StepCard({ step, isLast }: { step: Step; isLast: boolean }) {
  return (
    <div className="relative flex h-full flex-col overflow-hidden border border-steel-700 bg-steel-900 p-7 shadow-bevel-sm transition-all duration-200 hover:border-safety-500">
      {/* Número gigante de fondo */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-2 -top-4 select-none font-display text-[140px] leading-none tracking-[0.02em] text-steel-700/40"
      >
        {step.number}
      </span>

      {/* Connector flecha entre cards (desktop) */}
      {!isLast ? (
        <span
          aria-hidden
          className="absolute -right-4 top-12 hidden text-safety-500 md:block"
        >
          <svg width="24" height="14" viewBox="0 0 24 14" fill="none">
            <path
              d="M0 7h21M14 1l7 6-7 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      ) : null}

      <span className="relative hud-readout">{step.hud}</span>
      <h3 className="relative mt-5 font-display text-[26px] leading-tight tracking-[0.02em] text-foreground">
        {step.title}
      </h3>
      <p className="relative mt-3 text-[14px] leading-6 text-zinc-400">
        {step.body}
      </p>
    </div>
  );
}
