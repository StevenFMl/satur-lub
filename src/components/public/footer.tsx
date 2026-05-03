import Link from "next/link";
import { Logo } from "@/components/brand/logo";

const PRODUCT_LINKS = [
  { href: "#servicios", label: "Servicios" },
  { href: "#como-opera", label: "Cómo opera" },
  { href: "#precios", label: "Precios" },
  { href: "/login", label: "Ingresar al sistema" },
];

const COMPANY_LINKS = [
  { href: "#", label: "Sobre nosotros" },
  { href: "#contacto", label: "Contacto" },
  { href: "#", label: "Trabaja con nosotros" },
];

const LEGAL_LINKS = [
  { href: "#", label: "Términos" },
  { href: "#", label: "Privacidad" },
  { href: "#", label: "Política de cobros" },
];

export function PublicFooter() {
  return (
    <footer className="relative w-full bg-steel-950 pt-16 pb-10">
      <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-steel-700" />

      <div className="mx-auto w-full max-w-7xl px-6 lg:px-10">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          {/* Marca + descripción */}
          <div>
            <Logo />
            <p className="mt-5 max-w-sm text-[13px] leading-6 text-zinc-400">
              SaturnLub es la plataforma operativa para lubricentros, talleres
              mecánicos y ferreterías automotrices. Pensada para mostradores,
              hecha para durar.
            </p>
            <div className="mt-6 inline-flex items-center gap-2 border border-steel-700 bg-steel-900 px-3 py-2">
              <span
                aria-hidden
                className="h-2 w-2 rounded-full bg-signal-500 animate-press-blink shadow-[0_0_8px_2px_rgba(22,163,74,0.5)]"
              />
              <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.22em] text-signal-500">
                Sistema operativo
              </span>
            </div>
          </div>

          <FooterColumn title="Producto" links={PRODUCT_LINKS} />
          <FooterColumn title="Compañía" links={COMPANY_LINKS} />
          <FooterColumn title="Legal" links={LEGAL_LINKS} />
        </div>

        {/* Bottom bar */}
        <div className="mt-14 flex flex-col items-start justify-between gap-4 border-t border-steel-700 pt-6 sm:flex-row sm:items-center">
          <p className="industrial-label !text-[10px]">
            © {new Date().getFullYear()} SATURNLUB · SISTEMA OPERATIVO INDUSTRIAL
          </p>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Hecho en Ecuador · Para talleres del mundo
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: { href: string; label: string }[];
}) {
  return (
    <div>
      <h4 className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-safety-500">
        {title}
      </h4>
      <ul className="mt-5 space-y-3">
        {links.map((l) => (
          <li key={`${title}-${l.label}`}>
            <Link
              href={l.href}
              className="rounded-sm text-[13px] text-zinc-300 transition-colors duration-150 hover:text-safety-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
