"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";

export type LinkExchangeResult = { ok?: boolean; error?: string } | null;

/**
 * Links a return record to the exchange (replacement) sale, records how
 * the refund credit was consumed, and optionally creates a cash_out movement
 * when the remaining credit is refunded in cash.
 *
 * Called from checkout-dialog after a successful sale when the POS was
 * opened with exchange_return_id params.
 *
 * @param returnId       ID of the sale_return being linked
 * @param saleId         ID of the new (replacement) sale
 * @param creditApplied  Amount of refund applied as credit to the new sale
 * @param creditRefunded Amount of remaining credit returned to client in cash
 * @param refundInCash   When true AND cashSessionId present: creates a cash_out movement
 * @param cashSessionId  Active cash session (required for cash movement)
 */
export async function linkExchangeSaleAction(
  returnId:       string,
  saleId:         string,
  creditApplied:  number,
  creditRefunded: number,
  refundInCash:   boolean,
  cashSessionId:  string | null
): Promise<LinkExchangeResult> {
  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { error: "Sesión expirada." };

  if (membership.role !== "owner" && membership.role !== "admin") {
    return { error: "Sin permisos para vincular cambios." };
  }

  if (!returnId || !saleId) return { error: "IDs requeridos." };

  const safeApplied  = Math.max(0, Number(creditApplied.toFixed(2)));
  const safeRefunded = Math.max(0, Number(creditRefunded.toFixed(2)));

  const supabase = await createClient();

  // ── 1. Link return → exchange sale + record credit consumption ─────────────
  const { error: updateErr } = await supabase
    .from("sale_returns")
    .update({
      exchange_sale_id:        saleId,
      return_type:             "exchange",
      exchange_credit_applied:  safeApplied,
      exchange_credit_refunded: safeRefunded,
    })
    .eq("id", returnId)
    .eq("tenant_id", membership.tenant_id);

  if (updateErr) {
    console.error("linkExchangeSaleAction [update]:", updateErr.message);
    return { error: "No se pudo vincular el cambio. Verifica que la devolución exista." };
  }

  // ── 2. Cash movement for refunded remainder ────────────────────────────────
  // Only when: cashier chose cash refund + there IS a remainder + session open.
  if (refundInCash && safeRefunded > 0.005 && cashSessionId) {
    const { error: cashErr } = await supabase
      .from("cash_movements")
      .insert({
        tenant_id:       membership.tenant_id,
        cash_session_id: cashSessionId,
        movement_type:   "cash_out",
        direction:       -1,
        amount:          safeRefunded,
        reason:          "Devolución de crédito restante por cambio de producto",
        reference_type:  "sale_return",
        reference_id:    returnId,
        created_by:      user.id,
      });

    if (cashErr) {
      // Non-fatal: sale + return are linked. Log for ops review.
      console.error("linkExchangeSaleAction [cash_movement]:", cashErr.message);
    }
  }

  revalidatePath("/dashboard/reportes/devoluciones");
  revalidatePath("/dashboard/pos/ventas");
  revalidatePath("/dashboard/pos/caja");

  return { ok: true };
}
