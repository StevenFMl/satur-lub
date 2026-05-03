import Link from "next/link";

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
    title: "Órdenes de servicio",
    body: "Captura desde el mostrador o el box mecánico. Estados claros, tiempos visibles, asignación por técnico.",
    href: "#servicios",
    icon: <IconWrench />,
  },
  {
    badge: "02",
    title: "Diagnóstico al instante",
    body: "Bitácora por vehículo, historial de cambios, recordatorios automáticos. Cada placa con su ficha completa.",
    href: "#servicios",
    icon: <IconScan />,
  },
  {
    badge: "03",
    title: "Inventario y caja",
    body: "Aceites, filtros y repuestos con alertas de stock. Cobros, métodos de pago y arqueo de turno listo para entregar.",
    href: "#servicios",
    icon: <IconBox />,
  },
];

export function ServicesOverlapSection() {
  return (
    <section
      id="servicios"
      className="relative bg-white pb-24 pt-0 text-steel-950"
    >
      {/* Cards superpuestas que rompen del hero oscuro a esta sección blanca */}
      <div className="relative mx-auto -mt-32 w-full max-w-7xl px-6 lg:-mt-36 lg:px-10">
        <div className="grid gap-5 md:grid-cols-3 md:gap-6">
          {SERVICES.map((s) => (
            <ServiceCard key={s.badge} {...s} />
          ))}
        </div>
      </div>

      {/* Hazard stripe interna como divisor */}
      <div
        aria-hidden
        className="mx-auto mt-24 h-1 w-24 hazard-stripe opacity-90"
      />

      {/* Bloque de features blanco */}
      <div className="mx-auto mt-12 w-full max-w-7xl px-6 lg:px-10">
        <div className="max-w-3xl">
          <span className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-rust-500">
            Características principales
          </span>
          <h2 className="mt-4 font-display text-[44px] leading-[0.95] tracking-[0.01em] text-steel-950 sm:text-[56px] lg:text-[68px]">
            REPARAMOS{" "}
            <span className="text-rust-500">CON CUIDADO</span>,
            <br />
            OPERAMOS CON PRECISIÓN.
          </h2>
          <p className="mt-6 max-w-2xl text-[15px] leading-7 text-zinc-600 sm:text-[16px] sm:leading-8">
            SaturnLub no es otro CRM con esmalte. Está construido sobre la
            forma real en que se trabaja en un taller: manos llenas de
            grasa, prisa de mostrador y vehículos esperando. Cada pantalla
            resuelve una decisión, no decora el escritorio.
          </p>
        </div>

        <div className="mt-14 grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          <Feature
            icon={<IconShield />}
            title="Multi-sucursal seguro"
            body="Aislamiento real entre negocios. Cada sucursal opera independiente, con su inventario, equipo y caja."
          />
          <Feature
            icon={<IconBolt />}
            title="Diseñado para POS"
            body="Botones grandes, atajos de teclado, focus visible. Funciona con guantes y bajo presión de mostrador."
          />
          <Feature
            icon={<IconChart />}
            title="Reportes operativos"
            body="Carga de trabajo, top de servicios, rotación de stock y arqueo de caja al cierre del turno."
          />
          <Feature
            icon={<IconUsers />}
            title="Roles y permisos"
            body="Dueño, administrador, mecánico y cobrador. Cada uno ve solo lo que necesita para hacer su trabajo."
          />
          <Feature
            icon={<IconCar />}
            title="Ficha por vehículo"
            body="Historial completo por placa: aceites, filtros, kilometraje. El cliente vuelve y todo queda en su sitio."
          />
          <Feature
            icon={<IconReceipt />}
            title="Facturación local"
            body="Comprobantes electrónicos con tu RUC y secuenciales configurables. Pensado para el SRI ecuatoriano desde el día uno."
          />
        </div>
      </div>
    </section>
  );
}

function ServiceCard({ badge, title, body, href, icon }: Service) {
  return (
    <Link
      href={href}
      className="group/card relative block overflow-hidden rounded-sm border border-steel-700 bg-steel-900 p-7 shadow-bevel transition-all duration-200 ease-out hover:-translate-y-1 hover:border-safety-500 hover:shadow-safety-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
    >
      {/* Badge numérico tipo placa */}
      <div className="flex items-start justify-between">
        <div className="grid h-12 w-12 place-items-center border border-steel-700 bg-steel-950 text-safety-500 transition-colors duration-200 group-hover/card:border-safety-500 group-hover/card:bg-safety-500 group-hover/card:text-steel-950">
          {icon}
        </div>
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
          {badge}
        </span>
      </div>

      <h3 className="mt-7 font-display text-[26px] leading-none tracking-[0.02em] text-foreground">
        {title}
      </h3>
      <p className="mt-3 text-[14px] leading-6 text-zinc-400">{body}</p>

      <div className="mt-6 inline-flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-safety-500">
        Conocer más
        <span
          aria-hidden
          className="transition-transform duration-200 group-hover/card:translate-x-1"
        >
          →
        </span>
      </div>
    </Link>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="group/feature">
      <div className="grid h-12 w-12 place-items-center bg-safety-500 text-steel-950 transition-colors duration-200 group-hover/feature:bg-rust-500 group-hover/feature:text-white">
        {icon}
      </div>
      <h3 className="mt-5 font-display text-[22px] leading-tight tracking-[0.02em] text-steel-950">
        {title}
      </h3>
      <p className="mt-2 text-[14px] leading-6 text-zinc-600">{body}</p>
    </div>
  );
}

/* ----------------------------- ICONOS ----------------------------- */

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className: "h-6 w-6",
};

function IconWrench() {
  return (
    <svg {...iconProps}>
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-2.4 2.6-2.6a4 4 0 0 0-.6 0z" />
    </svg>
  );
}
function IconScan() {
  return (
    <svg {...iconProps}>
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <path d="M7 12h10" />
    </svg>
  );
}
function IconBox() {
  return (
    <svg {...iconProps}>
      <path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <path d="M3.3 7 12 12l8.7-5" />
      <path d="M12 22V12" />
    </svg>
  );
}
function IconShield() {
  return (
    <svg {...iconProps}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
function IconBolt() {
  return (
    <svg {...iconProps}>
      <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
    </svg>
  );
}
function IconChart() {
  return (
    <svg {...iconProps}>
      <path d="M3 3v18h18" />
      <path d="M7 15l4-4 3 3 5-7" />
    </svg>
  );
}
function IconUsers() {
  return (
    <svg {...iconProps}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 21c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6" />
      <circle cx="17" cy="9" r="3" />
      <path d="M21.5 21c0-2.6-2-5-4.5-5" />
    </svg>
  );
}
function IconCar() {
  return (
    <svg {...iconProps}>
      <path d="M5 17h14M3 13l2-6h14l2 6" />
      <path d="M5 17v3M19 17v3" />
      <circle cx="7.5" cy="14.5" r="1.5" />
      <circle cx="16.5" cy="14.5" r="1.5" />
    </svg>
  );
}
function IconReceipt() {
  return (
    <svg {...iconProps}>
      <path d="M5 3v18l3-2 3 2 3-2 3 2 3-2V3z" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </svg>
  );
}
