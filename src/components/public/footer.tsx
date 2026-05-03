import Link from "next/link";
import { Logo } from "@/components/brand/logo";

const PRODUCT_LINKS = [
  { href: "#servicios", label: "Servicios" },
  { href: "#como-opera", label: "Cómo funciona" },
  { href: "#precios", label: "Precios" },
  { href: "/login", label: "Ingresar" },
];

const COMPANY_LINKS = [
  { href: "#", label: "Sobre nosotros" },
  { href: "#contacto", label: "Contacto" },
  { href: "#", label: "Trabaja con nosotros" },
];

const LEGAL_LINKS = [
  { href: "#", label: "Términos del servicio" },
  { href: "#", label: "Política de privacidad" },
  { href: "#", label: "Política de cobros" },
];

export function PublicFooter() {
  return (
    <footer className="relative w-full border-t border-zinc-800 bg-zinc-950 pt-16 pb-10">
      <div className="mx-auto w-full max-w-7xl px-6 lg:px-10">
        <div className="grid gap-12 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
          {/* Marca + descripción */}
          <div>
            <Logo />
            <p className="mt-5 max-w-sm text-[13.5px] leading-6 text-zinc-400">
              SaturnLub es la plataforma operativa para lubricadoras, talleres
              mecánicos y ferreterías automotrices en Ecuador. Pensada para
              mostradores, hecha para durar.
            </p>
          </div>

          <FooterColumn title="Producto" links={PRODUCT_LINKS} />
          <FooterColumn title="Compañía" links={COMPANY_LINKS} />
          <FooterColumn title="Legal" links={LEGAL_LINKS} />
        </div>

        {/* Bottom bar */}
        <div className="mt-14 flex flex-col items-start justify-between gap-3 border-t border-zinc-800 pt-6 sm:flex-row sm:items-center">
          <p className="text-[12px] text-zinc-500">
            © {new Date().getFullYear()} SaturnLub. Todos los derechos
            reservados.
          </p>
          <p className="text-[12px] text-zinc-500">
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
      <h4 className="text-[12px] font-bold uppercase tracking-[0.22em] text-white">
        {title}
      </h4>
      <ul className="mt-5 space-y-3">
        {links.map((l) => (
          <li key={`${title}-${l.label}`}>
            <Link
              href={l.href}
              className="rounded-sm text-[13.5px] text-zinc-400 transition-colors duration-150 hover:text-safety-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
