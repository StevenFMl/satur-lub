"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { BranchesTable } from "@/app/(dashboard)/dashboard/configuracion/sucursales/branches-table";
import {
  WarehousesTable,
} from "@/app/(dashboard)/dashboard/inventario/bodegas/warehouses-table";

export type BranchRow = {
  id: string;
  branch_name: string;
  is_active: boolean;
  created_at: string;
};

export type WarehouseRow = {
  id: string;
  name: string;
  branch_id: string | null;
  is_active: boolean;
  created_at: string;
  branches: { branch_name: string } | null;
};

export type BranchOption = { id: string; branch_name: string };

type Tab = "sucursales" | "bodegas";

export function InfrastructureTabs({
  branches,
  warehouses,
  branchOptions,
  canManage,
}: {
  branches: BranchRow[];
  warehouses: WarehouseRow[];
  branchOptions: BranchOption[];
  canManage: boolean;
}) {
  const [active, setActive] = React.useState<Tab>("sucursales");

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "sucursales", label: "Sucursales", count: branches.length },
    { key: "bodegas", label: "Bodegas", count: warehouses.length },
  ];

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex gap-1 border-b-2 border-steel-700" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active === tab.key}
            onClick={() => setActive(tab.key)}
            className={cn(
              "relative flex items-center gap-2 px-5 py-3 font-mono text-[12px] font-bold uppercase tracking-[0.14em] transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              active === tab.key
                ? "text-safety-500"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
            <span
              className={cn(
                "inline-flex h-5 min-w-5 items-center justify-center rounded-sm px-1.5 font-mono text-[10px] font-bold tabular-nums",
                active === tab.key
                  ? "bg-safety-500/20 text-safety-500"
                  : "bg-steel-800 text-muted-foreground"
              )}
            >
              {tab.count}
            </span>
            {/* Active underline */}
            {active === tab.key ? (
              <span className="absolute -bottom-[2px] left-0 right-0 h-[2px] bg-safety-500" />
            ) : null}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      <div role="tabpanel">
        {active === "sucursales" ? (
          <BranchesTable initialRows={branches} canManage={canManage} />
        ) : (
          <WarehousesTable
            initialRows={warehouses}
            branches={branchOptions}
            canManage={canManage}
          />
        )}
      </div>
    </div>
  );
}
