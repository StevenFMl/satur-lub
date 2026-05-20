"use server";

import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import type { CartLine } from "@/lib/domain/pos-math";
import type { PickedCustomer } from "@/actions/customers";

// ── Types ──────────────────────────────────────────────────────────────────

export type HeldCart = {
  id:                string;
  tenant_id:         string;
  created_by:        string;
  created_by_name:   string | null;
  customer_id:       string | null;
  customer_snapshot: PickedCustomer | null;
  cart_lines:        CartLine[];
  gross_amount:      number;
  items_count:       number;
  note:              string | null;
  created_at:        string;
};

// ── Actions ────────────────────────────────────────────────────────────────

/** Returns all held carts for the current tenant, newest first. */
export async function getHeldCarts(): Promise<HeldCart[]> {
  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("held_carts")
    .select("*")
    .eq("tenant_id", membership.tenant_id)
    .order("created_at", { ascending: false })
    .limit(10); // generous ceiling; max-5 enforced on INSERT

  return (data ?? []) as unknown as HeldCart[];
}

/**
 * Parks the current cart.  Enforces the max-5-per-tenant limit.
 * Returns an error string on failure, undefined on success.
 */
export async function holdCart(params: {
  cart:         CartLine[];
  customer:     PickedCustomer | null;
  userName:     string;
  grossAmount:  number;
  note?:        string | null;
}): Promise<string | undefined> {
  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return "No autorizado";

  const supabase = await createClient();

  // Check limit before inserting
  const { count, error: countErr } = await supabase
    .from("held_carts")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", membership.tenant_id);

  if (countErr) return countErr.message;
  if ((count ?? 0) >= 5) {
    return "Máximo 5 ventas aparcadas. Retoma o descarta una antes de continuar.";
  }

  const { error } = await supabase.from("held_carts").insert({
    tenant_id:         membership.tenant_id,
    created_by:        user.id,
    created_by_name:   params.userName,
    customer_id:       params.customer?.id ?? null,
    customer_snapshot: params.customer ?? null,
    cart_lines:        params.cart,
    gross_amount:      params.grossAmount,
    items_count:       params.cart.reduce((s, l) => s + l.quantity, 0),
    note:              params.note?.trim() || null,
  });

  return error?.message;
}

/**
 * Reads the hold, deletes it, and returns the cart data.
 * Atomic enough: if DELETE fails the cart data is still returned so the
 * cashier doesn't lose their work — the hold will appear again on refresh.
 */
export async function resumeHeldCart(id: string): Promise<{
  cart?:     CartLine[];
  customer?: PickedCustomer | null;
  error?:    string;
}> {
  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { error: "No autorizado" };

  const supabase = await createClient();

  const { data, error: fetchErr } = await supabase
    .from("held_carts")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", membership.tenant_id)
    .single();

  if (fetchErr || !data) return { error: "Venta aparcada no encontrada" };

  // Best-effort delete — if it fails the hold reappears; no data is lost.
  await supabase.from("held_carts").delete().eq("id", id);

  const hold = data as unknown as HeldCart;
  return { cart: hold.cart_lines, customer: hold.customer_snapshot };
}

/** Discards (permanently deletes) a held cart. */
export async function discardHeldCart(id: string): Promise<string | undefined> {
  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return "No autorizado";

  const supabase = await createClient();
  const { error } = await supabase
    .from("held_carts")
    .delete()
    .eq("id", id)
    .eq("tenant_id", membership.tenant_id);

  return error?.message;
}
