import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
};

type NavSection = {
  title: string;
  items: NavItem[];
};

const SECTIONS: NavSection[] = [
  {
    title: "Operación",
    items: [
      {
        href: "/dashboard",
        label: "Inicio",
        icon: (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12 12 3l9 9" />
            <path d="M5 10v10h14V10" />
          </svg>
        ),
      },
      {
        href: "/dashboard/orders",
        label: "Órdenes",
        icon: (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="4" width="16" height="16" rx="1" />
            <path d="M8 9h8M8 13h8M8 17h5" />
          </svg>
        ),
      },
      {
        href: "/dashboard/customers",
        label: "Clientes",
        icon: (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
          </svg>
        ),
      },
      {
        href: "/dashboard/proveedores",
        label: "Proveedores",
        icon: (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9h18" />
            <path d="M5 9V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3" />
            <path d="M3 9v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9" />
            <path d="M9 13h6" />
          </svg>
        ),
      },
      {
        href: "/dashboard/compras/nueva",
        label: "Compras",
        icon: (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
            <path d="M3 6h18" />
            <path d="M16 10a4 4 0 0 1-8 0" />
          </svg>
        ),
      },
    ],
  },
  {
    title: "Inventario",
    items: [
      {
        href: "/dashboard/inventario/bodegas",
        label: "Bodegas",
        icon: (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9 12 4l9 5" />
            <path d="M5 9v11h4v-7h6v7h4V9" />
          </svg>
        ),
      },
    ],
  },
  {
    title: "Cuenta",
    items: [
      {
        href: "/dashboard/team",
        label: "Equipo",
        icon: (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="8" r="3.5" />
            <path d="M2.5 21c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6" />
            <circle cx="17" cy="9" r="3" />
            <path d="M21.5 21c0-2.6-2-5-4.5-5" />
          </svg>
        ),
      },
      {
        href: "/dashboard/settings",
        label: "Ajustes",
        icon: (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
        ),
      },
    ],
  },
];

export function Sidebar({ activePath }: { activePath: string }) {
  return (
    <aside className="hidden w-64 shrink-0 border-r border-steel-700 bg-steel-900 lg:flex lg:flex-col">
      <div className="flex h-16 items-center border-b border-steel-700 bg-steel-900/70 px-5 top-highlight">
        <Logo size="sm" />
      </div>

      <nav className="flex-1 space-y-6 px-3 py-4">
        {SECTIONS.map((section) => (
          <div key={section.title} className="space-y-1">
            <p className="px-3 pb-1 hud-readout !text-muted-foreground">
              {section.title}
            </p>
            {section.items.map((item) => {
              const isActive =
                item.href === "/dashboard"
                  ? activePath === "/dashboard"
                  : activePath.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "group/nav flex items-center gap-3 rounded-sm border-l-2 px-3 py-2.5 font-mono text-[12px] font-semibold uppercase tracking-[0.14em]",
                    "transition-all duration-150 ease-out",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-offset-2 focus-visible:ring-offset-steel-900",
                    isActive
                      ? "border-safety-500 bg-steel-800 text-safety-500"
                      : "border-transparent text-muted-foreground hover:border-steel-600 hover:bg-steel-800/60 hover:text-foreground"
                  )}
                >
                  <span
                    className={cn(
                      "transition-colors duration-150",
                      isActive
                        ? "text-safety-500"
                        : "text-muted-foreground group-hover/nav:text-foreground"
                    )}
                  >
                    {item.icon}
                  </span>
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-steel-700 px-5 py-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Plataforma · v0.1
        </p>
      </div>
    </aside>
  );
}
