import Link from "next/link";
import { ArrowRight, Clock, Mail, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CtaBanner() {
  return (
    <section
      id="contacto"
      className="relative w-full overflow-hidden bg-zinc-900 py-20 sm:py-24 lg:py-32"
    >
      {/* Backdrop industrial */}
      <div aria-hidden className="absolute inset-0 brushed-steel opacity-90" />
      <div
        aria-hidden
        className="absolute -bottom-32 right-[-10%] h-[420px] w-[420px] rounded-full bg-safety-500/15 blur-[140px]"
      />

      <div className="relative mx-auto w-full max-w-7xl px-6 lg:px-10">
        <div className="grid items-center gap-12 lg:grid-cols-[1.5fr_1fr]">
          {/* Copy */}
          <div>
            <span className="text-[12px] font-bold uppercase tracking-[0.22em] text-safety-500">
              Pon en marcha tu taller
            </span>
            <h2 className="mt-4 font-display text-[44px] leading-[0.94] tracking-[0.01em] text-white sm:text-[58px] lg:text-[68px]">
              Empieza hoy.
              <br />
              <span className="text-safety-500">Decide en 14 días.</span>
            </h2>
            <p className="mt-5 max-w-xl text-[15px] leading-7 text-zinc-300 sm:text-[16px] sm:leading-8">
              Crea tu cuenta en menos de un minuto. Sin tarjeta, sin
              instalaciones, sin llamadas. Empiezas a operar el mismo día y
              decides si seguir cuando termine la prueba.
            </p>

            <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              <Link href="/register" className="sm:min-w-[240px]">
                <Button size="xl" className="group/cta w-full">
                  Crear cuenta ahora
                  <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover/cta:translate-x-1" />
                </Button>
              </Link>
              <Link href="/login" className="sm:min-w-[180px]">
                <Button size="xl" variant="outline" className="w-full">
                  Ya tengo cuenta
                </Button>
              </Link>
            </div>
          </div>

          {/* Caja lateral con datos de contacto */}
          <aside className="relative overflow-hidden border border-zinc-800 bg-zinc-950/80 backdrop-blur">
            <div aria-hidden className="h-1 w-full bg-safety-500" />

            <div className="border-b border-zinc-800 px-6 py-5">
              <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-safety-500">
                Soporte directo
              </span>
              <h3 className="mt-2 font-display text-[24px] leading-tight tracking-[0.02em] text-white">
                ¿Prefieres hablar primero?
              </h3>
            </div>

            <ul className="space-y-1 px-3 py-3">
              <ContactRow
                icon={<MessageCircle className="h-4 w-4" />}
                label="WhatsApp"
                value="+593 99 000 0000"
                href="https://wa.me/593990000000"
              />
              <ContactRow
                icon={<Mail className="h-4 w-4" />}
                label="Correo"
                value="hola@saturnlub.app"
                href="mailto:hola@saturnlub.app"
              />
              <ContactRow
                icon={<Clock className="h-4 w-4" />}
                label="Atención"
                value="Lun a Sáb · 8:00 – 19:00"
              />
            </ul>
          </aside>
        </div>
      </div>
    </section>
  );
}

function ContactRow({
  icon,
  label,
  value,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  href?: string;
}) {
  const Inner = (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="grid h-10 w-10 shrink-0 place-items-center border border-safety-500/30 bg-safety-500/10 text-safety-500">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.22em] text-zinc-500">
          {label}
        </div>
        <div className="mt-0.5 truncate font-mono text-[13.5px] font-semibold tracking-[0.02em] text-white tabular-nums">
          {value}
        </div>
      </div>
    </div>
  );

  if (!href) return <li>{Inner}</li>;

  return (
    <li>
      <a
        href={href}
        className="block rounded-sm transition-colors duration-150 hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
      >
        {Inner}
      </a>
    </li>
  );
}
