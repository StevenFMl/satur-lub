import Link from "next/link";
import { Button } from "@/components/ui/button";

export function HeroSection() {
  return (
    <section className="relative isolate w-full overflow-hidden bg-steel-950 pt-32 pb-44 sm:pb-52 lg:pt-36 lg:pb-60">
      {/* === Capas de fondo automotrices === */}
      {/* Tread plate base */}
      <div aria-hidden className="absolute inset-0 tread-plate opacity-60" />

      {/* Spotlight amarillo entrando por arriba derecha (puerta del taller) */}
      <div
        aria-hidden
        className="absolute -top-40 right-[-10%] h-[640px] w-[640px] rounded-full bg-safety-500/15 blur-[140px]"
      />
      {/* Acento azul mecánico en esquina inferior izquierda */}
      <div
        aria-hidden
        className="absolute bottom-[-20%] left-[-10%] h-[520px] w-[520px] rounded-full bg-mechanic-600/12 blur-[160px]"
      />

      {/* Diagonal hazard mark gigante translúcida tipo poster automotriz */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 top-1/2 hidden h-[120%] w-[60%] -translate-y-1/2 -rotate-12 opacity-[0.04] lg:block"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg, #FFC107 0 32px, transparent 32px 64px)",
        }}
      />

      {/* Vignette inferior para fundir con la siguiente sección */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-steel-950"
      />

      {/* === Contenido === */}
      <div className="relative mx-auto grid w-full max-w-7xl grid-cols-1 gap-14 px-6 lg:grid-cols-[1.15fr_1fr] lg:items-center lg:gap-12 lg:px-10">
        {/* Columna izquierda: copy + CTAs */}
        <div className="space-y-8">
          {/* Eyebrow industrial */}
          <div className="inline-flex items-center gap-3 border-l-2 border-safety-500 bg-steel-900/70 px-3 py-1.5 backdrop-blur">
            <span
              aria-hidden
              className="h-2 w-2 rounded-full bg-safety-500 shadow-[0_0_10px_2px_rgba(255,193,7,0.7)] animate-press-blink"
            />
            <span className="hud-readout">
              Software industrial · Lubricentros · Talleres
            </span>
          </div>

          {/* Titular gigante tipo poster */}
          <h1 className="font-display text-[56px] leading-[0.92] tracking-[0.005em] text-foreground sm:text-[78px] lg:text-[96px] xl:text-[110px]">
            OPERA TU TALLER
            <br />
            <span className="text-safety-500">SIN FRENOS.</span>
          </h1>

          <p className="max-w-xl text-[15px] leading-7 text-zinc-300 sm:text-[16px] sm:leading-8">
            La plataforma operativa para lubricentros, talleres mecánicos y
            ferreterías automotrices. Órdenes de servicio, vehículos,
            inventario, caja y facturación —{" "}
            <span className="font-semibold text-foreground">
              todo bajo el mismo panel
            </span>
            , listo para usar desde el mostrador.
          </p>

          {/* CTAs */}
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <Link href="/register" className="sm:min-w-[240px]">
              <Button size="xl" className="w-full">
                Comenzar gratis
              </Button>
            </Link>
            <Link href="#como-opera" className="sm:min-w-[180px]">
              <Button size="xl" variant="outline" className="w-full">
                Ver cómo funciona
              </Button>
            </Link>
          </div>

          {/* Trust strip */}
          <ul className="flex flex-wrap items-center gap-x-7 gap-y-3 pt-2 text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-400">
            <TrustItem>Sin tarjeta para empezar</TrustItem>
            <TrustItem>Cédula o correo</TrustItem>
            <TrustItem>Multi-sucursal</TrustItem>
          </ul>
        </div>

        {/* Columna derecha: panel HMI */}
        <div className="relative">
          <HudPanel />
        </div>
      </div>

      {/* Spec strip al pie del hero — KPIs anclados */}
      <div className="relative mx-auto mt-16 w-full max-w-7xl px-6 lg:px-10">
        <div className="grid grid-cols-2 divide-x divide-steel-700/80 border-y border-steel-700/80 bg-steel-900/40 backdrop-blur sm:grid-cols-4">
          <SpecCell value="120+" label="Talleres" />
          <SpecCell value="18k" label="Órdenes/mes" />
          <SpecCell value="99,9%" label="Disponibilidad" />
          <SpecCell value="24/7" label="Operativo" />
        </div>
      </div>
    </section>
  );
}

function TrustItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <span
        aria-hidden
        className="grid h-4 w-4 place-items-center rounded-sm bg-safety-500 text-steel-950"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
      {children}
    </li>
  );
}

function SpecCell({ value, label }: { value: string; label: string }) {
  return (
    <div className="px-5 py-5 text-center sm:px-6 sm:py-6">
      <div className="font-display text-[34px] leading-none tracking-[0.02em] text-foreground tabular-nums sm:text-[40px]">
        {value}
      </div>
      <div className="mt-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

/**
 * Panel HMI lateral del hero — gauge analógico + KPIs + ticker de órdenes.
 */
function HudPanel() {
  return (
    <div className="panel panel-bolts relative overflow-hidden rounded-sm shadow-bevel">
      <span aria-hidden className="bolt-bl" />
      <span aria-hidden className="bolt-br" />

      {/* Header tipo placa */}
      <div className="top-highlight flex items-center justify-between border-b border-steel-700 bg-steel-900/80 px-5 py-3">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="h-2 w-2 rounded-full bg-signal-500 animate-press-blink shadow-[0_0_8px_2px_rgba(22,163,74,0.5)]"
          />
          <span className="hud-readout">Sucursal 01 · Operando</span>
        </div>
        <span className="font-mono text-[11px] tracking-wider text-signal-500">
          ONLINE
        </span>
      </div>

      {/* Gauge */}
      <div className="px-6 pt-6">
        <Gauge value={72} />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-2 px-5 py-5">
        <Kpi label="Órdenes" value="24" tone="default" />
        <Kpi label="En proceso" value="06" tone="rust" />
        <Kpi label="Stock bajo" value="03" tone="hazard" />
      </div>

      {/* Ticker de últimas órdenes */}
      <div className="border-t border-steel-700 bg-steel-950/60 px-5 py-3">
        <div className="hud-readout mb-2">Últimas órdenes</div>
        <ul className="space-y-1.5 font-mono text-[11.5px] tracking-[0.04em]">
          <TickerRow plate="ABC-241" service="Cambio de aceite" />
          <TickerRow plate="V3W-882" service="Frenos delanteros" />
          <TickerRow plate="P1K-014" service="Diagnóstico ECU" />
        </ul>
      </div>

      <div className="flex items-center justify-between border-t border-steel-700 bg-steel-900/60 px-5 py-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Panel · v1.0
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground tabular-nums">
          14:32
        </span>
      </div>
    </div>
  );
}

function Gauge({ value }: { value: number }) {
  const angle = -120 + (value / 100) * 240;
  return (
    <div className="relative mx-auto h-44 w-72">
      <svg viewBox="0 0 200 110" className="h-full w-full">
        <defs>
          <linearGradient id="gauge-fill" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#16A34A" />
            <stop offset="55%" stopColor="#FFC107" />
            <stop offset="100%" stopColor="#DC2626" />
          </linearGradient>
        </defs>
        <path
          d="M 20 100 A 80 80 0 0 1 180 100"
          stroke="#202630"
          strokeWidth="14"
          fill="none"
        />
        <path
          d="M 20 100 A 80 80 0 0 1 180 100"
          stroke="url(#gauge-fill)"
          strokeWidth="14"
          fill="none"
          strokeDasharray="251.3 251.3"
          strokeDashoffset={(1 - value / 100) * 251.3}
        />
        {Array.from({ length: 11 }).map((_, i) => {
          const a = (-120 + i * 24) * (Math.PI / 180);
          const r1 = 64;
          const r2 = i % 5 === 0 ? 54 : 58;
          const cx = 100;
          const cy = 100;
          return (
            <line
              key={i}
              x1={cx + r1 * Math.cos(a)}
              y1={cy + r1 * Math.sin(a)}
              x2={cx + r2 * Math.cos(a)}
              y2={cy + r2 * Math.sin(a)}
              stroke="#5F6772"
              strokeWidth={i % 5 === 0 ? 1.5 : 1}
            />
          );
        })}
        <g transform={`rotate(${angle} 100 100)`}>
          <line
            x1="100"
            y1="100"
            x2="100"
            y2="38"
            stroke="#FFC107"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <circle
            cx="100"
            cy="100"
            r="6"
            fill="#0F141A"
            stroke="#FFC107"
            strokeWidth="2"
          />
        </g>
      </svg>
      <div className="absolute inset-x-0 bottom-1 text-center">
        <div className="font-display text-[42px] leading-none text-foreground tabular-nums">
          {value}
          <span className="text-muted-foreground">%</span>
        </div>
        <div className="hud-readout mt-1">Carga operativa</div>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "default" | "rust" | "hazard";
}) {
  const valueColor =
    tone === "rust"
      ? "text-rust-500"
      : tone === "hazard"
        ? "text-hazard-500"
        : "text-foreground";
  return (
    <div className="border border-steel-700 bg-steel-950 p-3">
      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-1 font-display text-[28px] leading-none tabular-nums ${valueColor}`}
      >
        {value}
      </div>
    </div>
  );
}

function TickerRow({ plate, service }: { plate: string; service: string }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="font-bold text-safety-500 tabular-nums">{plate}</span>
      <span className="truncate text-muted-foreground">{service}</span>
    </li>
  );
}
