import type { TenantRole } from "@/lib/supabase/types";

/**
 * POS permissions derived from tenant role.
 *
 * Roles:
 *  owner / admin → full access, including price overrides, voiding, reporting.
 *  user          → sell-only: catalog, cart, checkout. No price editing or voids.
 *
 * These are used to:
 *  1. Conditionally render/hide UI elements.
 *  2. Guard server actions (role check on the action itself).
 *  Both checks are required — never rely on hidden UI alone.
 */
export type PosPermissions = {
  canUsePOS: boolean;
  canEditLinePrice: boolean;   // override unit price on a cart line
  canApplyDiscount: boolean;   // apply a manual discount per line
  canVoidSale: boolean;        // cancel a confirmed sale
  canOverrideStock: boolean;   // sell even when stock = 0
  canViewDailyReport: boolean; // see daily totals/summary
};

export function getPosPermissions(role: TenantRole | null | undefined): PosPermissions {
  const isPrivileged = role === "owner" || role === "admin";
  return {
    canUsePOS:          true,               // all authenticated members
    canEditLinePrice:   isPrivileged,
    canApplyDiscount:   isPrivileged,
    canVoidSale:        isPrivileged,
    canOverrideStock:   isPrivileged,
    canViewDailyReport: isPrivileged,
  };
}

/** Shared helper used outside POS (purchases, products, etc.). */
export function canManageCatalog(role: TenantRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}
