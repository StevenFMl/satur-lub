import Link from "next/link";
import {
  ArrowRight,
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

const FEATURES: Omit<FeatureProps, "index">[] = [
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
      {/* Bloque superior blanco — solo para las cards superpuestas */}
      <div className="bg-white pb-20 sm:pb-24 lg:pb-28">
        <div className="relative z-20 mx-auto -mt-32 w-full max-w-7xl px-6 sm:-mt-40 lg:-mt-44 lg:px-10">
          <div className="grid gap-5 md:grid-cols-3 md:gap-6">
            {SERVICES.map((s) => (
              <ServiceCard key={s.badge} {...s} />
            ))}
          </div>
        </div>
      </div>

      {/* Bloque de features con fondo neutro para que las cards blancas tengan profundidad */}
      <div className="relative bg-zinc-50 pb-20 pt-20 sm:pb-24 sm:pt-24 lg:pb-32 lg:pt-28">
        {/* Línea de separación sutil */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-zinc-200 to-transparent"
        />

        <div className="mx-auto w-full max-w-7xl px-6 lg:px-10">
          {/* Header de la sección — grid 2col en desktop para aprovechar ancho */}
          <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-end lg:gap-14">
            <div>
              <span className="inline-flex items-center gap-2 border border-rust-500/30 bg-rust-500/10 px-3 py-1.5 text-[12px] font-bold uppercase tracking-[0.18em] text-rust-500">
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full bg-rust-500"
                />
                Características principales
              </span>
              <h2 className="mt-5 font-display text-[44px] leading-[0.95] tracking-[0.01em] text-zinc-950 sm:text-[56px] lg:text-[60px]">
                Diseñado para quien
                <br />
                <span className="text-rust-500">vive en el mostrador.</span>
              </h2>
            </div>
            <p className="text-[15px] leading-7 text-zinc-600 sm:text-[16px] sm:leading-8 lg:max-w-xl lg:pb-2">
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
          <div className="mt-14 grid gap-5 sm:grid-cols-2 sm:gap-6 lg:mt-16 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <FeatureCard key={f.title} {...f} index={i + 1} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function ServiceCard({ badge, title, body, href, icon }: Service) {
  return (
    <Link
      href={href}
      className="group/card relative flex h-full flex-col overflow-hidden border border-zinc-800 bg-zinc-900 p-7 shadow-bevel transition-all duration-200 ease-out hover:-translate-y-1 hover:border-safety-500 hover:shadow-safety-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
    >
      <div className="flex items-start justify-between">
        <div className="grid h-12 w-12 place-items-center border border-zinc-700 bg-zinc-950 text-safety-500 transition-colors duration-200 group-hover/card:border-safety-500 group-hover/card:bg-safety-500 group-hover/card:text-zinc-950">
          {icon}
        </div>
        <span className="font-mono text-[12px] font-bold tracking-[0.18em] text-zinc-500">
          {badge}
        </span>
      </div>

      <h3 className="mt-7 font-display text-[26px] leading-tight tracking-[0.02em] text-white">
        {title}
      </h3>
      <p className="mt-3 flex-1 text-[14px] leading-6 text-zinc-400">{body}</p>

      <div className="mt-6 inline-flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.22em] text-safety-500">
        Conocer más
        <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover/card:translate-x-1" />
      </div>
    </Link>
  );
}

type FeatureProps = {
  icon: React.ReactNode;
  title: string;
  body: string;
  index: number;
};

function FeatureCard({ icon, title, body, index }: FeatureProps) {
  return (
    <article className="group/feature relative flex h-full flex-col overflow-hidden border border-zinc-200 bg-white p-7 shadow-[0_1px_0_0_rgba(0,0,0,0.04)] transition-all duration-200 ease-out hover:-translate-y-1 hover:border-safety-500 hover:shadow-bevel-sm">
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
  );
}

