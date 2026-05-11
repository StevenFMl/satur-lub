"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import {
  productSchema,
  makeSkuFromName,
  type ProductFieldErrors,
} from "@/lib/validations/product";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ProductState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: ProductFieldErrors;
} | null;

export type BulkImportResult = {
  ok?: boolean;
  error?: string;
};

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Invalida caches relevantes a productos. Toda mutación de catálogo o de
 * precios debe llamarla. `revalidateTag` queda preparado para cuando las
 * lecturas pasen a `unstable_cache`; mientras tanto `revalidatePath` cubre
 * el render de los Server Components.
 */
function invalidateProducts() {
  revalidateTag("products");
  revalidatePath("/dashboard/inventario/productos");
  revalidatePath("/dashboard/compras/nueva");
  revalidatePath("/dashboard/inventario/stock");
  revalidatePath("/dashboard/inventario/movimientos");
}

/**
 * Persiste los precios por tier vía `set_product_tier_price`.
 * Solo llama al RPC para los tiers que tienen precio (no null).
 * null = no crear/actualizar esa fila — el catálogo puede no tener precio.
 * La RPC es idempotente: si el precio vigente coincide, es no-op.
 */
async function persistTierPrices(
  supabase: SupabaseClient,
  tenantId: string,
  productId: string,
  prices: {
    publico: number | null;
    mayorista: number | null;
    distribuidor: number | null;
  }
): Promise<{ error: string | null }> {
  const calls: Array<{ code: string; price: number }> = [];
  if (prices.publico !== null)
    calls.push({ code: "PUBLICO", price: prices.publico });
  if (prices.mayorista !== null)
    calls.push({ code: "MAYORISTA", price: prices.mayorista });
  if (prices.distribuidor !== null)
    calls.push({ code: "DISTRIBUIDOR", price: prices.distribuidor });

  for (const c of calls) {
    const { error } = await supabase.rpc("set_product_tier_price", {
      p_tenant_id: tenantId,
      p_product_id: productId,
      p_tier_code: c.code,
      p_unit_price: c.price,
    } as never);
    if (error) {
      console.error(`set_product_tier_price(${c.code}):`, error);
      return { error: `No se pudo guardar el precio ${c.code}.` };
    }
  }
  return { error: null };
}

function parseFormData(formData: FormData) {
  return productSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    sku: formData.get("sku"),
    unit: formData.get("unit"),
    cost_price: formData.get("cost_price"),
    has_tax:
      formData.get("has_tax") === "on" || formData.get("has_tax") === "true",
    price_publico: formData.get("price_publico"),
    price_mayorista: formData.get("price_mayorista"),
    price_distribuidor: formData.get("price_distribuidor"),
  });
}

/* ------------------------------------------------------------------ */
/* upsertProductAction                                                */
/* ------------------------------------------------------------------ */

/**
 * Crea o actualiza un producto del catálogo + sus precios por tier.
 *
 * Reglas:
 *  - `tenant_id` se inyecta en el servidor desde la sesión activa.
 *  - `product_kind` queda fijo en 'item'.
 *  - Si `sku` viene vacío, se genera uno determinista a partir del nombre.
 *  - Solo owner/admin pueden crear/editar.
 *  - PUBLICO es obligatorio; MAYORISTA / DISTRIBUIDOR opcionales.
 */
export async function upsertProductAction(
  _prev: ProductState,
  formData: FormData
): Promise<ProductState> {
  const parsed = parseFormData(formData);

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
    has_tax: data.has_tax,
    product_kind: "item" as const,
  };

  const { data: row, error } = data.id
    ? await supabase
        .from("products")
        .update(payload)
        .eq("id", data.id)
        .eq("tenant_id", tenantId)
        .select("id")
        .single()
    : await supabase
        .from("products")
        .insert(payload)
        .select("id")
        .single();

  if (error || !row) {
    const m = (error?.message ?? "").toLowerCase();
    if (m.includes("duplicate") || m.includes("unique")) {
      return {
        fieldErrors: { sku: "Ya existe un producto con este SKU." },
        error: "SKU duplicado.",
      };
    }
    console.error("upsertProductAction:", error);
    return { error: "No se pudo guardar el producto." };
  }

  const productId = row.id as string;

  const priceResult = await persistTierPrices(supabase, tenantId, productId, {
    publico: data.price_publico,
    mayorista: data.price_mayorista,
    distribuidor: data.price_distribuidor,
  });
  if (priceResult.error) {
    return { error: priceResult.error };
  }

  invalidateProducts();
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
    default_price: number | null;
    average_cost: number | null;
    last_purchase_cost: number | null;
    has_tax: boolean;
  };
  error?: string;
  fieldErrors?: ProductFieldErrors;
} | null;

/**
 * Crea un producto con datos mínimos + precios por tier y retorna su info
 * completa para inyectarlo en el formulario de compras sin recargar la
 * página. También maneja el modo edición (cuando `id` viene presente).
 */
export async function quickCreateProductAction(
  _prev: QuickCreateProductState,
  formData: FormData
): Promise<QuickCreateProductState> {
  const parsed = parseFormData(formData);

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
    has_tax: data.has_tax,
    product_kind: "item" as const,
  };

  const { data: row, error } = data.id
    ? await supabase
        .from("products")
        .update(payload)
        .eq("id", data.id)
        .eq("tenant_id", tenantId)
        .select("id")
        .single()
    : await supabase
        .from("products")
        .insert(payload)
        .select("id")
        .single();

  if (error || !row) {
    const m = (error?.message ?? "").toLowerCase();
    if (m.includes("duplicate") || m.includes("unique")) {
      return {
        fieldErrors: { sku: "Ya existe un producto con este SKU." },
        error: "SKU duplicado.",
      };
    }
    console.error("quickCreateProductAction:", error);
    return { error: "No se pudo crear el producto." };
  }

  const productId = row.id as string;

  const priceResult = await persistTierPrices(supabase, tenantId, productId, {
    publico: data.price_publico,
    mayorista: data.price_mayorista,
    distribuidor: data.price_distribuidor,
  });
  if (priceResult.error) {
    return { error: priceResult.error };
  }

  // Releemos el producto YA con default_price/average_cost/last_purchase_cost
  // sincronizados (trigger ya corrió). Esto es lo que el cliente inyecta a
  // su catálogo local para que la fila refleje el precio nuevo al instante.
  const { data: hydrated } = await supabase
    .from("products")
    .select(
      "id, name, sku, unit, cost_price, default_price, average_cost, last_purchase_cost, has_tax"
    )
    .eq("id", productId)
    .eq("tenant_id", tenantId)
    .single();

  invalidateProducts();

  return {
    ok: true,
    product: hydrated
      ? {
          id: hydrated.id as string,
          name: hydrated.name as string,
          sku: hydrated.sku as string,
          unit: hydrated.unit as string,
          cost_price: hydrated.cost_price as number | null,
          default_price: hydrated.default_price as number | null,
          average_cost: hydrated.average_cost as number | null,
          last_purchase_cost: hydrated.last_purchase_cost as number | null,
          has_tax: hydrated.has_tax as boolean,
        }
      : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Duplicar producto                                                  */
/* ------------------------------------------------------------------ */

export type DuplicateProductResult = {
  ok?: boolean;
  newId?: string;
  error?: string;
} | null;

export async function duplicateProductAction(
  id: string
): Promise<DuplicateProductResult> {
  if (typeof id !== "string" || id.length === 0) return { error: "ID inválido." };

  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { error: "Sesión expirada." };
  if (membership.role !== "owner" && membership.role !== "admin")
    return { error: "No tienes permisos para gestionar productos." };

  const tenantId = membership.tenant_id;
  const supabase = await createClient();

  const { data: src, error: srcErr } = await supabase
    .from("products")
    .select("name, unit, cost_price, has_tax, product_kind")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .single();

  if (srcErr || !src) return { error: "Producto no encontrado." };

  const newName = `${src.name as string} (Copia)`;
  const { data: newRow, error: insertErr } = await supabase
    .from("products")
    .insert({
      tenant_id: tenantId,
      name: newName,
      sku: makeSkuFromName(newName),
      unit: src.unit as string,
      cost_price: src.cost_price as number | null,
      has_tax: (src.has_tax as boolean | null) ?? true,
      product_kind: (src.product_kind as string) || "item",
    })
    .select("id")
    .single();

  if (insertErr || !newRow) {
    console.error("duplicateProductAction:", insertErr);
    return { error: "No se pudo duplicar el producto." };
  }

  const newProductId = newRow.id as string;

  const { data: tiers } = await supabase
    .from("v_product_active_prices")
    .select("tier_code, unit_price")
    .eq("product_id", id);

  if (tiers?.length) {
    type TierRow = { tier_code: string; unit_price: number };
    const findTier = (code: string) =>
      (tiers as TierRow[]).find((t) => t.tier_code === code)?.unit_price ?? null;
    await persistTierPrices(supabase, tenantId, newProductId, {
      publico: findTier("PUBLICO"),
      mayorista: findTier("MAYORISTA"),
      distribuidor: findTier("DISTRIBUIDOR"),
    });
  }

  invalidateProducts();
  return { ok: true, newId: newProductId };
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

  invalidateProducts();
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Importación Masiva (CSV)                                           */
/* ------------------------------------------------------------------ */

/**
 * Importación masiva. El CSV ya parseado contiene `cost_price` (costo
 * referencial). Para cada producto importado:
 *  - Inserta/actualiza en `products`.
 *  - Crea precio PUBLICO inicial = cost_price (el usuario lo ajusta luego
 *    desde la UI). Esto evita productos sin precio vigente.
 */
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

  const { data: upserted, error } = await supabase
    .from("products")
    .upsert(payload, { onConflict: "tenant_id, sku", ignoreDuplicates: false })
    .select("id, sku, cost_price");

  if (error) {
    console.error("bulkImportProductsAction:", error);
    return {
      error:
        "Error al importar productos masivamente. Revisa si hay SKUs duplicados.",
    };
  }

  // Sembrar PUBLICO con cost_price para cada producto importado (idempotente
  // gracias a la RPC: si el precio vigente ya coincide, es no-op).
  if (upserted) {
    for (const r of upserted) {
      const price = (r.cost_price as number | null) ?? 0;
      const { error: errPrice } = await supabase.rpc(
        "set_product_tier_price",
        {
          p_tenant_id: tenantId,
          p_product_id: r.id as string,
          p_tier_code: "PUBLICO",
          p_unit_price: price,
        } as never
      );
      if (errPrice) {
        console.error("bulkImport set_product_tier_price:", errPrice);
        // Continuamos: un fallo en un precio no aborta toda la importación.
      }
    }
  }

  invalidateProducts();
  return { ok: true };
}
