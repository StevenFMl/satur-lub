import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <div className="garage-backdrop relative flex min-h-dvh flex-col">
      {/* Acento hazard stripe arriba — remate visual */}
      <div aria-hidden className="hazard-stripe h-1 w-full opacity-90" />

      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <Logo />
        <div className="flex items-center gap-2">
          <Link href="/login">
            <Button variant="ghost" size="sm">
              Iniciar sesión
            </Button>
          </Link>
          <Link href="/register">
            <Button variant="primary" size="sm">
              Crear cuenta
            </Button>
          </Link>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 pb-20 pt-10 sm:pt-16">
        <div className="grid gap-12 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-10">
          {/* Lado izquierdo: copy */}
          <div className="space-y-7">
            <div className="inline-flex items-center gap-3 border-l-2 border-safety-500 bg-steel-900/60 px-3 py-1.5 backdrop-blur">
              <span
                aria-hidden
                className="h-2 w-2 rounded-full bg-safety-500 shadow-[0_0_8px_2px_rgba(255,193,7,0.6)] animate-press-blink"
              />
              <span className="hud-readout">
                SaaS · Lubricentros · Talleres
              </span>
            </div>

            <h1 className="font-display text-[56px] leading-[0.92] tracking-[0.01em] text-foreground sm:text-[72px] lg:text-[84px]">
              OPERA TU TALLER
              <br />
              <span className="text-safety-500">CON PRECISIÓN</span>
              <br />
              MECÁNICA.
            </h1>

            <p className="max-w-xl text-[15px] leading-7 text-muted-foreground">
              SaturnLub es la plataforma operativa diseñada para
              lubricentros, talleres mecánicos y ferreterías automotrices.
              Órdenes, vehículos, inventario, caja y facturación —
              todo en un solo panel.
            </p>

            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              <Link href="/register" className="sm:min-w-[220px]">
                <Button size="xl" className="w-full">
                  Comenzar gratis
                </Button>
              </Link>
              <Link href="/login" className="sm:min-w-[180px]">
                <Button size="xl" variant="outline" className="w-full">
                  Ya tengo cuenta
                </Button>
              </Link>
            </div>

            {/* Trust strip */}
            <div className="flex flex-wrap items-center gap-x-7 gap-y-3 pt-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <span className="flex items-center gap-2">
                <CheckMark />
                Multi-tenant seguro
              </span>
              <span className="flex items-center gap-2">
                <CheckMark />
                Sin tarjeta de crédito
              </span>
              <span className="flex items-center gap-2">
                <CheckMark />
                Periodo de prueba
              </span>
            </div>
          </div>

          {/* Lado derecho: dashboard mockup tipo gauge */}
          <div className="relative">
            <DashboardMock />
          </div>
        </div>

        {/* Feature strip */}
        <section className="mt-20 grid gap-4 sm:grid-cols-3">
          <FeatureTile
            label="01 · Órdenes"
            title="Servicio fluido"
            body="Captura órdenes desde el mostrador o el box mecánico. Estados claros, tiempos visibles."
          />
          <FeatureTile
            label="02 · Inventario"
            title="Stock al día"
            body="Aceites, filtros, repuestos. Alertas, ajustes y costos integrados."
          />
          <FeatureTile
            label="03 · Caja"
            title="Cierre sin sorpresas"
            body="Cobros, métodos de pago y arqueo de turno listo para entregar."
          />
        </section>
      </main>

      <footer className="relative z-10 border-t border-steel-700 bg-steel-900/60">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-start justify-between gap-2 px-6 py-4 sm:flex-row sm:items-center">
          <p className="industrial-label !text-[10px]">
            © {new Date().getFullYear()} SATURNLUB · HEAVY-DUTY OS
          </p>
          <nav className="flex items-center gap-5 text-[11px] uppercase tracking-wider text-muted-foreground">
            <a href="#" className="hover:text-foreground">
              Términos
            </a>
            <a href="#" className="hover:text-foreground">
              Privacidad
            </a>
            <a href="#" className="hover:text-foreground">
              Soporte
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

function CheckMark() {
  return (
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
  );
}

function FeatureTile({
  label,
  title,
  body,
}: {
  label: string;
  title: string;
  body: string;
}) {
  return (
    <article className="panel rounded-sm p-5">
      <span className="hud-readout">{label}</span>
      <h3 className="mt-3 font-display text-[24px] leading-none tracking-[0.02em] text-foreground">
        {title}
      </h3>
      <p className="mt-3 text-[13px] leading-6 text-muted-foreground">
        {body}
      </p>
    </article>
  );
}

/**
 * Dashboard mockup decorativo tipo "panel de control de auto":
 * un gauge analógico + lectura de KPIs en mono.
 */
function DashboardMock() {
  return (
    <div className="panel panel-bolts relative overflow-hidden rounded-sm p-6">
      <span aria-hidden className="bolt-bl" />
      <span aria-hidden className="bolt-br" />

      {/* Header tipo placa */}
      <div className="flex items-center justify-between border-b border-steel-700 pb-3">
        <span className="hud-readout">Panel · Sucursal 01</span>
        <span className="font-mono text-[11px] tracking-wider text-signal-500">
          ● ONLINE
        </span>
      </div>

      {/* Gauge */}
      <div className="mt-6 flex items-center justify-center">
        <Gauge value={72} />
      </div>

      {/* KPIs */}
      <div className="mt-6 grid grid-cols-3 gap-3">
        <Kpi label="Órdenes" value="24" tone="default" />
        <Kpi label="En proceso" value="06" tone="rust" />
        <Kpi label="Stock bajo" value="03" tone="hazard" />
      </div>

      {/* Strip inferior */}
      <div className="mt-5 flex items-center justify-between border-t border-steel-700 pt-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          ID-OS-001 · v1.0
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          14:32
        </span>
      </div>
    </div>
  );
}

function Gauge({ value }: { value: number }) {
  // Arco semicircular: -120° a +120°. Aguja gira por 'value' (0..100).
  const angle = -120 + (value / 100) * 240;

  return (
    <div className="relative h-44 w-72">
      <svg viewBox="0 0 200 110" className="h-full w-full">
        <defs>
          <linearGradient id="gauge-fill" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#16A34A" />
            <stop offset="55%" stopColor="#FFC107" />
            <stop offset="100%" stopColor="#DC2626" />
          </linearGradient>
        </defs>

        {/* Arco base */}
        <path
          d="M 20 100 A 80 80 0 0 1 180 100"
          stroke="#202630"
          strokeWidth="14"
          fill="none"
          strokeLinecap="butt"
        />
        {/* Arco activo */}
        <path
          d="M 20 100 A 80 80 0 0 1 180 100"
          stroke="url(#gauge-fill)"
          strokeWidth="14"
          fill="none"
          strokeLinecap="butt"
          strokeDasharray="251.3 251.3"
          strokeDashoffset={(1 - value / 100) * 251.3}
        />
        {/* Marcas */}
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
        {/* Aguja */}
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
          <circle cx="100" cy="100" r="6" fill="#0F141A" stroke="#FFC107" strokeWidth="2" />
        </g>
      </svg>

      {/* Lectura central */}
      <div className="absolute inset-x-0 bottom-1 text-center">
        <div className="font-display text-[42px] leading-none text-foreground">
          {value}
          <span className="text-muted-foreground">%</span>
        </div>
        <div className="hud-readout mt-1">Carga Operativa</div>
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
      <div className={`mt-1 font-display text-[28px] leading-none ${valueColor}`}>
        {value}
      </div>
    </div>
  );
}
