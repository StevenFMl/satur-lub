"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import {
  productSchema,
  makeSkuFromName,
  type ProductFieldErrors,
} from "@/lib/validations/product";

export type ProductState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: ProductFieldErrors;
} | null;

export type BulkImportResult = {
  ok?: boolean;
  error?: string;
};


/**
 * Crea o actualiza un producto del catálogo.
 *
 * Reglas:
 *  - `tenant_id` se inyecta en el servidor desde la sesión activa. Nunca se
 *    acepta del FormData.
 *  - `product_kind` queda fijo en 'item' (este formulario no maneja servicios
 *    ni kits — esos van en módulos dedicados).
 *  - Si `sku` viene vacío, se genera uno determinista a partir del nombre.
 *  - Solo owner/admin pueden crear/editar (alineado con la RLS de products).
 */
export async function upsertProductAction(
  _prev: ProductState,
  formData: FormData
): Promise<ProductState> {
  const parsed = productSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    sku: formData.get("sku"),
    unit: formData.get("unit"),
    cost_price: formData.get("cost_price"),
  });

  if (!parsed.success) {
    const fieldErrors: ProductFieldErrors = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !(key in fieldErrors)) {
        (fieldErrors as Record<string, string>)[key] = issue.message;
      }
    }
    return { fieldErrors, error: "Revisa los campos marcados." };
  }

  const data = parsed.data;

  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { error: "Sesión expirada." };

  if (membership.role !== "owner" && membership.role !== "admin") {
    return { error: "No tienes permisos para gestionar productos." };
  }

  const tenantId = membership.tenant_id;
  const supabase = await createClient();

  const sku = data.sku ?? makeSkuFromName(data.name);

  const payload = {
    tenant_id: tenantId,
    name: data.name,
    sku,
    unit: data.unit,
    cost_price: data.cost_price,
    product_kind: "item" as const,
  };

  const { error } = data.id
    ? await supabase
        .from("products")
        .update(payload)
        .eq("id", data.id)
        .eq("tenant_id", tenantId)
    : await supabase.from("products").insert(payload);

  if (error) {
    const m = error.message.toLowerCase();
    if (m.includes("duplicate") || m.includes("unique")) {
      return {
        fieldErrors: { sku: "Ya existe un producto con este SKU." },
        error: "SKU duplicado.",
      };
    }
    console.error("upsertProductAction:", error);
    return { error: "No se pudo guardar el producto." };
  }

  revalidatePath("/dashboard/inventario/productos");
  revalidatePath("/dashboard/compras/nueva");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Creación rápida inline (desde formulario de compras)               */
/* ------------------------------------------------------------------ */

export type QuickCreateProductState = {
  ok?: boolean;
  product?: {
    id: string;
    name: string;
    sku: string;
    unit: string;
    cost_price: number | null;
  };
  error?: string;
  fieldErrors?: ProductFieldErrors;
} | null;

/**
 * Crea un producto con datos mínimos y retorna su info completa para
 * inyectarlo en el formulario de compras sin recargar la página.
 */
export async function quickCreateProductAction(
  _prev: QuickCreateProductState,
  formData: FormData
): Promise<QuickCreateProductState> {
  const parsed = productSchema.safeParse({
    name: formData.get("name"),
    sku: formData.get("sku"),
    unit: formData.get("unit"),
    cost_price: formData.get("cost_price"),
  });

  if (!parsed.success) {
    const fieldErrors: ProductFieldErrors = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !(key in fieldErrors)) {
        (fieldErrors as Record<string, string>)[key] = issue.message;
      }
    }
    return { fieldErrors, error: "Revisa los campos marcados." };
  }

  const data = parsed.data;

  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { error: "Sesión expirada." };

  if (membership.role !== "owner" && membership.role !== "admin") {
    return { error: "No tienes permisos para gestionar productos." };
  }

  const tenantId = membership.tenant_id;
  const supabase = await createClient();
  const sku = data.sku ?? makeSkuFromName(data.name);

  const payload = {
    tenant_id: tenantId,
    name: data.name,
    sku,
    unit: data.unit,
    cost_price: data.cost_price,
    product_kind: "item" as const,
  };

  const { data: inserted, error } = await supabase
    .from("products")
    .insert(payload)
    .select("id, name, sku, unit, cost_price")
    .single();

  if (error) {
    const m = error.message.toLowerCase();
    if (m.includes("duplicate") || m.includes("unique")) {
      return {
        fieldErrors: { sku: "Ya existe un producto con este SKU." },
        error: "SKU duplicado.",
      };
    }
    console.error("quickCreateProductAction:", error);
    return { error: "No se pudo crear el producto." };
  }

  revalidatePath("/dashboard/inventario/productos");
  revalidatePath("/dashboard/compras/nueva");
  return {
    ok: true,
    product: inserted
      ? {
          id: inserted.id as string,
          name: inserted.name as string,
          sku: inserted.sku as string,
          unit: inserted.unit as string,
          cost_price: inserted.cost_price as number | null,
        }
      : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Borrado lógico (soft-delete)                                       */
/* ------------------------------------------------------------------ */

export type ToggleState = { ok?: boolean; error?: string } | null;

export async function toggleProductActiveAction(
  id: string,
  isActive: boolean
): Promise<ToggleState> {
  if (typeof id !== "string" || id.length === 0) {
    return { error: "ID inválido." };
  }

  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { error: "Sesión expirada." };

  if (membership.role !== "owner" && membership.role !== "admin") {
    return { error: "No tienes permisos para inactivar productos." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("products")
    .update({ is_active: isActive })
    .eq("id", id)
    .eq("tenant_id", membership.tenant_id);

  if (error) {
    console.error("toggleProductActiveAction:", error);
    return { error: "No se pudo cambiar el estado del producto." };
  }

  revalidatePath("/dashboard/inventario/productos");
  revalidatePath("/dashboard/compras/nueva");
  revalidatePath("/dashboard/inventario/stock");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Importación Masiva (CSV)                                           */
/* ------------------------------------------------------------------ */

export async function bulkImportProductsAction(
  items: Array<{
    name: string;
    sku: string;
    unit: string;
    cost_price: number;
  }>
): Promise<BulkImportResult> {
  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { error: "Sesión expirada." };

  if (membership.role !== "owner" && membership.role !== "admin") {
    return { error: "No tienes permisos para gestionar productos." };
  }

  const tenantId = membership.tenant_id;
  const supabase = await createClient();

  const payload = items.map((item) => ({
    tenant_id: tenantId,
    name: item.name,
    sku: item.sku || makeSkuFromName(item.name),
    unit: item.unit,
    cost_price: item.cost_price,
    product_kind: "item" as const,
  }));

  const { error } = await supabase
    .from("products")
    .upsert(payload, { onConflict: 'tenant_id, sku', ignoreDuplicates: false });

  if (error) {
    console.error("bulkImportProductsAction:", error);
    return { error: "Error al importar productos masivamente. Revisa si hay SKUs duplicados." };
  }

  revalidatePath("/dashboard/inventario/productos");
  revalidatePath("/dashboard/compras/nueva");
  return { ok: true };
}
