import {
  Boxes,
  Car,
  ClipboardList,
  Receipt,
  ShieldCheck,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";

type Service = {
  badge: string;
  title: string;
  body: string;
  href: string;
  icon: React.ReactNode;
};

const SERVICES: Service[] = [
  {
    badge: "01",
    title: "Órdenes de trabajo",
    body: "Registra una orden en menos de 30 segundos: placa, kilometraje, cliente y trabajos. Asigna al técnico y olvídate de las hojas sueltas.",
    href: "#servicios",
    icon: <ClipboardList className="h-6 w-6" />,
  },
  {
    badge: "02",
    title: "Facturación electrónica SRI",
    body: "Emite facturas, notas de venta y notas de crédito directamente desde la orden. Autorización del SRI en segundos, archivo XML y PDF listos.",
    href: "#servicios",
    icon: <Receipt className="h-6 w-6" />,
  },
  {
    badge: "03",
    title: "Inventario y caja",
    body: "Aceites, filtros y repuestos con alertas de stock mínimo. Cobros, métodos de pago y arqueo de caja al cierre de turno, sin cuadrar a mano.",
    href: "#servicios",
    icon: <Boxes className="h-6 w-6" />,
  },
];

// Stagger por columna (mod 3) — entrada izquierda → derecha
const FEATURE_DELAYS = ["", "delay-100", "delay-200"] as const;

const FEATURES: Omit<FeatureProps, "index" | "delayClass">[] = [
  {
    icon: <ShieldCheck className="h-6 w-6" />,
    title: "Multi-sucursal seguro",
    body: "Cada local opera independiente con su propio inventario, equipo y caja. Consolidas todo desde un panel central.",
  },
  {
    icon: <Zap className="h-6 w-6" />,
    title: "Pensado para POS",
    body: "Botones grandes, atajos de teclado y focus visible. Funciona con guantes y bajo presión de mostrador.",
  },
  {
    icon: <TrendingUp className="h-6 w-6" />,
    title: "Reportes operativos",
    body: "Carga de trabajo por técnico, top de servicios, rotación de stock y arqueo de caja al cierre del turno.",
  },
  {
    icon: <Users className="h-6 w-6" />,
    title: "Roles y permisos",
    body: "Dueño, administrador, mecánico y cobrador. Cada uno ve solo lo que necesita para hacer su trabajo.",
  },
  {
    icon: <Car className="h-6 w-6" />,
    title: "Ficha por vehículo",
    body: "Historial completo por placa: aceites, filtros, kilometraje. El cliente vuelve y todo queda en su sitio.",
  },
  {
    icon: <Receipt className="h-6 w-6" />,
    title: "Facturación SRI",
    body: "Comprobantes electrónicos firmados, autorización del SRI en segundos y envío automático al correo del cliente.",
  },
];

export function ServicesOverlapSection() {
  return (
    <section id="servicios" className="relative text-zinc-900">
      {/* ===== SVG Wave Divider: dark → light ===== */}
      <div className="relative -mt-px w-full overflow-hidden bg-zinc-950">
        <svg
          aria-hidden
          viewBox="0 0 1440 80"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="none"
          className="block h-12 w-full sm:h-16 lg:h-20"
        >
          <path
            d="M0 0h1440v20c-180 40-360 60-720 60S180 60 0 20V0z"
            fill="#09090b"
          />
          <path
            d="M0 20c180 40 360 60 720 60s540-20 720-60v60H0V20z"
            fill="#fafafa"
          />
        </svg>
      </div>

      {/* Bloque de features con fondo neutro para que las cards blancas tengan profundidad */}
      <div className="relative bg-zinc-50 py-16 md:py-24 lg:py-32">
        {/* Línea de separación sutil */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-zinc-200 to-transparent"
        />

        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          {/* Header de la sección — grid 2col en desktop para aprovechar ancho */}
          <div className="grid gap-8 sm:gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-end lg:gap-14">
            <div>
              <span className="inline-flex items-center gap-2 border border-rust-500/30 bg-rust-500/10 px-3 py-1.5 text-[12px] font-bold uppercase tracking-[0.18em] text-rust-500 animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-both">
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full bg-rust-500"
                />
                Características principales
              </span>
              <h2 className="mt-5 font-display text-[40px] leading-[0.95] tracking-[0.01em] text-zinc-950 sm:text-[52px] lg:text-[60px] animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-both delay-100">
                Diseñado para quien
                <br />
                <span className="text-rust-500">vive en el mostrador.</span>
              </h2>
            </div>
            <p className="text-[15px] leading-7 text-zinc-600 sm:text-[16px] sm:leading-8 lg:max-w-xl lg:pb-2 animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-both delay-200">
              SaturnLub no es otro CRM con esmalte. Está construido sobre la
              forma real en que se trabaja en un taller: manos llenas de
              grasa, prisa de mostrador y vehículos esperando.{" "}
              <span className="font-semibold text-zinc-900">
                Cada pantalla resuelve una decisión
              </span>
              , no decora el escritorio.
            </p>
          </div>

          {/* Grid de tarjetas de features */}
          <div className="mt-14 grid gap-5 sm:grid-cols-2 sm:gap-6 lg:mt-16 lg:grid-cols-3 lg:gap-7">
            {FEATURES.map((f, i) => (
              <FeatureCard
                key={f.title}
                {...f}
                index={i + 1}
                delayClass={FEATURE_DELAYS[i % FEATURE_DELAYS.length]}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ===== SVG Wave Divider: light → dark ===== */}
      <div className="relative -mb-px w-full overflow-hidden bg-zinc-50">
        <svg
          aria-hidden
          viewBox="0 0 1440 80"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="none"
          className="block h-12 w-full sm:h-16 lg:h-20"
        >
          <path
            d="M0 0h1440v20c-180 40-360 60-720 60S180 60 0 20V0z"
            fill="#fafafa"
          />
          <path
            d="M0 20c180 40 360 60 720 60s540-20 720-60v60H0V20z"
            fill="#09090b"
          />
        </svg>
      </div>
    </section>
  );
}

type FeatureProps = {
  icon: React.ReactNode;
  title: string;
  body: string;
  index: number;
  delayClass?: string;
};

function FeatureCard({ icon, title, body, index, delayClass }: FeatureProps) {
  return (
    <div
      className={`flex h-full animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-both ${delayClass ?? ""}`}
    >
    <article className="group/feature relative flex h-full w-full flex-col overflow-hidden border border-zinc-200 bg-white p-7 shadow-sm transition-all duration-300 ease-out hover:-translate-y-1.5 hover:border-safety-500 hover:shadow-[0_12px_28px_-8px_rgba(0,0,0,0.12)]">
      {/* Línea superior amarilla que aparece en hover */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-[3px] origin-left scale-x-0 bg-safety-500 transition-transform duration-300 ease-out group-hover/feature:scale-x-100"
      />

      <div className="flex items-start justify-between">
        <div className="grid h-12 w-12 place-items-center border border-zinc-200 bg-zinc-50 text-rust-500 transition-colors duration-200 group-hover/feature:border-safety-500 group-hover/feature:bg-safety-500 group-hover/feature:text-zinc-950">
          {icon}
        </div>
        <span className="font-mono text-[12px] font-bold tracking-[0.18em] text-zinc-400">
          {String(index).padStart(2, "0")}
        </span>
      </div>

      <h3 className="mt-7 font-display text-[24px] leading-tight tracking-[0.02em] text-zinc-950">
        {title}
      </h3>
      <p className="mt-3 flex-1 text-[14px] leading-6 text-zinc-600">{body}</p>
    </article>
    </div>
  );
}
