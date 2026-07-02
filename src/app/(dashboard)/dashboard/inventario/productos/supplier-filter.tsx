"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/select";

export function SupplierFilter({
  suppliers,
  activeSupplierId,
}: {
  suppliers: Array<{ id: string; full_name: string }>;
  activeSupplierId: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const onChange = (val: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (val) {
      params.set("supplier_id", val);
    } else {
      params.delete("supplier_id");
    }
    // Maintain active tab
    router.push(`/dashboard/inventario/productos?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="space-y-1">
      <label className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground/60">
        Proveedor
      </label>
      <Select
        value={activeSupplierId}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 py-1 text-[13px] sm:w-64"
      >
        <option value="" className="bg-steel-950 text-foreground">Todos los proveedores</option>
        {suppliers.map((s) => (
          <option key={s.id} value={s.id} className="bg-steel-950 text-foreground">
            {s.full_name}
          </option>
        ))}
      </Select>
    </div>
  );
}
