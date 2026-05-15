"use server";

import { revalidateTag, revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";

export type PresentationInput = {
  name:       string;
  unit_label: string;
  base_qty:   number;
  unit_price: number | null;
  is_default: boolean;
};

export type PresentationsState = { ok?: boolean; error?: string } | null;

/**
 * Replaces all active presentations for a product.
 * Strategy: deactivate all → upsert new list (by unique tenant+product+name).
 * Deactivated rows are preserved for FK integrity with sale_items.presentation_id.
 */
export async function savePresentationsAction(
  productId: string,
  items: PresentationInput[]
): Promise<PresentationsState> {
  if (!productId) return { error: "ID de producto requerido." };

  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { error: "Sesión expirada." };
  if (membership.role !== "owner" && membership.role !== "admin")
    return { error: "Solo administradores pueden editar presentaciones." };

  const tenantId = membership.tenant_id;
  const supabase = await createClient();

  const { data: prod } = await supabase
    .from("products")
    .select("id, product_kind")
    .eq("id", productId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!prod) return { error: "Producto no encontrado." };

  // Deactivate all current presentations (preserves FK history)
  const { error: deactErr } = await supabase
    .from("product_presentations")
    .update({ is_active: false })
    .eq("product_id", productId)
    .eq("tenant_id", tenantId);

  if (deactErr) {
    console.error("savePresentationsAction deactivate:", deactErr.message);
    return { error: "No se pudieron actualizar las presentaciones." };
  }

  if (items.length > 0) {
    const rows = items.map((p, i) => ({
      tenant_id:  tenantId,
      product_id: productId,
      name:       p.name.trim(),
      unit_label: p.unit_label.trim(),
      base_qty:   Math.max(0.0001, p.base_qty),
      unit_price: p.unit_price,
      is_default: p.is_default,
      sort_order: i,
      is_active:  true,
    }));

    const { error: upsErr } = await supabase
      .from("product_presentations")
      .upsert(rows, { onConflict: "tenant_id,product_id,name" });

    if (upsErr) {
      console.error("savePresentationsAction upsert:", upsErr.message);
      return { error: "No se pudieron guardar las presentaciones." };
    }
  }

  revalidateTag("products");
  revalidatePath("/dashboard/inventario/productos");
  revalidatePath("/dashboard/pos");
  return { ok: true };
}
