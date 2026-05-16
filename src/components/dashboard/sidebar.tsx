"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import { Sheet } from "@/components/ui/sheet";

// ── Types ──────────────────────────────────────────────────────────────────

type NavItem = {
  href:   string;
  label:  string;
  exact?: boolean;
  icon:   React.ReactNode;
};

type NavGroup = {
  key:   string;
  label: string;
  icon:  React.ReactNode;
  items: NavItem[];
};

type NavEntry =
  | { kind: "link";  data: NavItem }
  | { kind: "group"; data: NavGroup };

// ── Active helpers ─────────────────────────────────────────────────────────

function itemActive(item: NavItem, path: string): boolean {
  return item.exact ? path === item.href : path.startsWith(item.href);
}

function groupActive(group: NavGroup, path: string): boolean {
  return group.items.some(i => itemActive(i, path));
}

// ── Navigation definition ──────────────────────────────────────────────────

const NAV: NavEntry[] = [
  // Inicio
  {
    kind: "link",
    data: {
      href: "/dashboard",
      label: "Inicio",
      exact: true,
      icon: (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12 12 3l9 9" />
          <path d="M5 10v10h14V10" />
        </svg>
      ),
    },
  },

  // POS: Terminal · Caja · Ventas · Fiados
  {
    kind: "group",
    data: {
      key: "pos",
      label: "POS",
      icon: (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
          <path d="M3 6h18" />
          <path d="M16 10a4 4 0 0 1-8 0" />
        </svg>
      ),
      items: [
        {
          href: "/dashboard/pos",
          label: "Terminal",
          exact: true,
          icon: (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8M12 17v4" />
            </svg>
          ),
        },
        {
          href: "/dashboard/pos/caja",
          label: "Caja",
          icon: (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 7l1-4h14l1 4" />
              <rect x="2" y="7" width="20" height="13" rx="1" />
              <path d="M16 12h.01M12 12h.01M8 12h.01" />
              <path d="M6 7v13" />
            </svg>
          ),
        },
        {
          href: "/dashboard/pos/ventas",
          label: "Ventas",
          icon: (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
          ),
        },
        {
          href: "/dashboard/pos/fiado",
          label: "Fiados",
          icon: (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="5" width="20" height="14" rx="2" />
              <path d="M2 10h20" />
              <path d="M6 15h4" />
            </svg>
          ),
        },
      ],
    },
  },

  // Clientes: Clientes · Órdenes
  {
    kind: "group",
    data: {
      key: "clientes",
      label: "Clientes",
      icon: (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
        </svg>
      ),
      items: [
        {
          href: "/dashboard/clientes",
          label: "Clientes",
          icon: (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
            </svg>
          ),
        },
        {
          href: "/dashboard/orders",
          label: "Órdenes",
          icon: (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="4" width="16" height="16" rx="1" />
              <path d="M8 9h8M8 13h8M8 17h5" />
            </svg>
          ),
        },
      ],
    },
  },

  // Compras: Compras · Proveedores
  {
    kind: "group",
    data: {
      key: "compras",
      label: "Compras",
      icon: (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
          <rect x="9" y="3" width="6" height="4" rx="1" />
          <path d="M9 12h6M9 16h4" />
        </svg>
      ),
      items: [
        {
          href: "/dashboard/compras",
          label: "Compras",
          icon: (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
              <rect x="9" y="3" width="6" height="4" rx="1" />
              <path d="M9 12h6M9 16h4" />
            </svg>
          ),
        },
        {
          href: "/dashboard/proveedores",
          label: "Proveedores",
          icon: (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9h18" />
              <path d="M5 9V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3" />
              <path d="M3 9v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9" />
              <path d="M9 13h6" />
            </svg>
          ),
        },
      ],
    },
  },

  // Inventario: Productos · Existencias · Locales y Bodegas
  {
    kind: "group",
    data: {
      key: "inventario",
      label: "Inventario",
      icon: (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <path d="M3.27 6.96 12 12.01l8.73-5.05" />
          <path d="M12 22.08V12" />
        </svg>
      ),
      items: [
        {
          href: "/dashboard/inventario/productos",
          label: "Productos",
          icon: (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <path d="M3.27 6.96 12 12.01l8.73-5.05" />
              <path d="M12 22.08V12" />
            </svg>
          ),
        },
        {
          href: "/dashboard/inventario/stock",
          label: "Existencias",
          icon: (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v18h18" />
              <rect x="7" y="10" width="3" height="8" rx="0.5" />
              <rect x="12" y="6" width="3" height="12" rx="0.5" />
              <rect x="17" y="3" width="3" height="15" rx="0.5" />
            </svg>
          ),
        },
        {
          href: "/dashboard/inventario/infraestructura",
          label: "Locales y Bodegas",
          icon: (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 21h18" />
              <path d="M5 21V7l7-4 7 4v14" />
              <path d="M9 21v-6h6v6" />
            </svg>
          ),
        },
        {
          href: "/dashboard/inventario/movimientos",
          label: "Movimientos",
          icon: (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12h18" />
              <path d="M3 6h18" />
              <path d="M3 18h18" />
              <path d="M9 3 3 9l6 6" />
              <path d="M15 21l6-6-6-6" />
            </svg>
          ),
        },
        {
          href: "/dashboard/inventario/conteo",
          label: "Conteo físico",
          icon: (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
          ),
        },
      ],
    },
  },

  // Reportes: Rentabilidad · Auditoría · Valor inventario · Reposición · IVA
  {
    kind: "group",
    data: {
      key: "reportes",
      label: "Reportes",
      icon: (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 20V10M12 20V4M6 20v-6" />
        </svg>
      ),
      items: [
        {
          href: "/dashboard/pos/rentabilidad",
          label: "Rentabilidad",
          icon: (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
              <polyline points="16 7 22 7 22 13" />
            </svg>
          ),
        },
        {
          href: "/dashboard/pos/auditoria",
          label: "Auditoría",
          icon: (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <path d="M9 13h6M9 17h4" />
              <circle cx="7.5" cy="9.5" r="1" fill="currentColor" />
            </svg>
          ),
        },
        {
          href: "/dashboard/reportes/devoluciones",
          label: "Devoluciones",
          icon: (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 14 4 9l5-5" />
              <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
            </svg>
          ),
        },
        {
          href: "/dashboard/reportes/auditoria",
          label: "Cambios",
          icon: (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3 4 7l4 4" />
              <path d="M4 7h16" />
              <path d="m16 21 4-4-4-4" />
              <path d="M20 17H4" />
            </svg>
          ),
        },
        {
          href: "/dashboard/inventario/valor",
          label: "Valor inventario",
          icon: (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          ),
        },
        {
          href: "/dashboard/inventario/reposicion",
          label: "Reposición",
          icon: (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9h18M3 15h18" />
              <path d="M8 3 2 9l6 6" />
              <path d="M16 21l6-6-6-6" />
            </svg>
          ),
        },
        {
          href: "/dashboard/compras/iva",
          label: "IVA compras",
          icon: (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="9" y1="15" x2="15" y2="9" />
              <circle cx="9.5" cy="9.5" r="0.5" fill="currentColor" />
              <circle cx="14.5" cy="14.5" r="0.5" fill="currentColor" />
            </svg>
          ),
        },
        {
          href: "/dashboard/compras/iva-ventas",
          label: "IVA ventas",
          icon: (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
              <path d="M3 6h18" />
              <line x1="9" y1="15" x2="15" y2="9" />
              <circle cx="9.5" cy="9.5" r="0.5" fill="currentColor" />
              <circle cx="14.5" cy="14.5" r="0.5" fill="currentColor" />
            </svg>
          ),
        },
        {
          href: "/dashboard/compras/resumen-iva",
          label: "Resumen IVA",
          icon: (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18" />
              <path d="M9 21V9" />
            </svg>
          ),
        },
        {
          href: "/dashboard/compras/consolidado",
          label: "Consolidado",
          icon: (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v18h18" />
              <rect x="7" y="10" width="3" height="8" rx="0.5" />
              <rect x="12" y="6" width="3" height="12" rx="0.5" />
              <rect x="17" y="13" width="3" height="5" rx="0.5" />
            </svg>
          ),
        },
      ],
    },
  },

  // Ajustes: Equipo · Ajustes
  {
    kind: "group",
    data: {
      key: "ajustes",
      label: "Ajustes",
      icon: (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
      ),
      items: [
        {
          href: "/dashboard/team",
          label: "Equipo",
          icon: (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
            </svg>
          ),
        },
      ],
    },
  },
];

// ── Chevron ────────────────────────────────────────────────────────────────

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn(
        "h-3 w-3 shrink-0 transition-transform duration-200",
        open && "rotate-180"
      )}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

// ── SidebarContent ─────────────────────────────────────────────────────────

function SidebarContent({
  activePath,
  onNavigate,
}: {
  activePath: string;
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const entry of NAV) {
      if (entry.kind === "group") {
        init[entry.data.key] = groupActive(entry.data, activePath);
      }
    }
    return init;
  });

  // Auto-expand any group that contains the newly active path.
  useEffect(() => {
    setOpen(prev => {
      const next = { ...prev };
      let changed = false;
      for (const entry of NAV) {
        if (
          entry.kind === "group" &&
          groupActive(entry.data, activePath) &&
          !next[entry.data.key]
        ) {
          next[entry.data.key] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [activePath]);

  function toggle(key: string) {
    setOpen(prev => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center border-b border-steel-700 bg-steel-900/70 px-5 top-highlight">
        <Logo size="sm" />
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {NAV.map(entry => {
          // ── Flat link ──────────────────────────────────────────────────────
          if (entry.kind === "link") {
            const isActive = itemActive(entry.data, activePath);
            return (
              <Link
                key={entry.data.href}
                href={entry.data.href}
                onClick={onNavigate}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "group/nav flex min-h-[44px] items-center gap-3 rounded-sm border-l-2 px-3 py-2.5",
                  "font-mono text-[12px] font-semibold uppercase tracking-[0.14em]",
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
                  {entry.data.icon}
                </span>
                {entry.data.label}
              </Link>
            );
          }

          // ── Collapsible group ──────────────────────────────────────────────
          const group     = entry.data;
          const isOpen    = open[group.key] ?? false;
          const hasActive = groupActive(group, activePath);

          return (
            <div key={group.key}>
              <button
                type="button"
                onClick={() => toggle(group.key)}
                className={cn(
                  "group/nav flex min-h-[44px] w-full items-center gap-3 rounded-sm border-l-2 px-3 py-2.5",
                  "font-mono text-[12px] font-semibold uppercase tracking-[0.14em]",
                  "transition-all duration-150 ease-out",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-offset-2 focus-visible:ring-offset-steel-900",
                  isOpen
                    ? "border-steel-600 bg-steel-800/40 text-foreground"
                    : hasActive
                      ? "border-safety-500 bg-steel-800 text-safety-500"
                      : "border-transparent text-muted-foreground hover:border-steel-600 hover:bg-steel-800/60 hover:text-foreground"
                )}
              >
                <span
                  className={cn(
                    "transition-colors duration-150",
                    isOpen || hasActive
                      ? "text-inherit"
                      : "text-muted-foreground group-hover/nav:text-foreground"
                  )}
                >
                  {group.icon}
                </span>
                <span className="flex-1 text-left">{group.label}</span>
                <Chevron open={isOpen} />
              </button>

              {isOpen && (
                <div className="mb-1 ml-[23px] mt-0.5 space-y-0.5 border-l border-steel-700/60 pb-0.5 pl-2.5">
                  {group.items.map(item => {
                    const isActive = itemActive(item, activePath);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          "group/sub flex min-h-[36px] items-center gap-2.5 rounded-sm px-2.5 py-1.5",
                          "font-mono text-[11px] font-semibold uppercase tracking-[0.12em]",
                          "transition-all duration-150 ease-out",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-offset-1 focus-visible:ring-offset-steel-900",
                          isActive
                            ? "bg-steel-800 text-safety-500"
                            : "text-muted-foreground hover:bg-steel-800/50 hover:text-foreground"
                        )}
                      >
                        <span
                          className={cn(
                            "transition-colors duration-150",
                            isActive
                              ? "text-safety-500"
                              : "text-muted-foreground group-hover/sub:text-foreground"
                          )}
                        >
                          {item.icon}
                        </span>
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-steel-700 px-5 py-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Plataforma · v0.1
        </p>
      </div>
    </div>
  );
}

// ── Desktop sidebar ────────────────────────────────────────────────────────

export function Sidebar({ activePath }: { activePath: string }) {
  return (
    <aside className="hidden w-64 shrink-0 border-r border-steel-700 bg-steel-900 md:flex md:flex-col">
      <SidebarContent activePath={activePath} />
    </aside>
  );
}

// ── Mobile sidebar ─────────────────────────────────────────────────────────

export function MobileSidebar({ activePath }: { activePath?: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const currentPath = activePath || pathname || "/dashboard";

  return (
    <>
      <button
        type="button"
        aria-label="Abrir menú"
        onClick={() => setOpen(true)}
        className="grid h-11 w-11 place-items-center rounded-sm border border-steel-700 bg-steel-800 text-muted-foreground transition-colors hover:text-foreground md:hidden"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="4" x2="20" y1="12" y2="12" />
          <line x1="4" x2="20" y1="6" y2="6" />
          <line x1="4" x2="20" y1="18" y2="18" />
        </svg>
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} side="left" className="w-64 p-0">
        <SidebarContent activePath={currentPath} onNavigate={() => setOpen(false)} />
      </Sheet>
    </>
  );
}
