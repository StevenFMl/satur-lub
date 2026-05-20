/**
 * POS domain math — pure functions, no React, no side-effects.
 *
 * This is the single source of truth for every price, IVA, discount, and
 * below-cost calculation in the terminal.  Both the browser component
 * (pos-terminal.tsx) and any future server-side validation import from here.
 *
 * Rules:
 *   • All monetary results are Big instances (no native +/-/*÷ on money).
 *   • Rounding: HALF_UP (contable estándar Ecuador).
 *   • Money output to DB/UI: toMoney() → 2 decimals.
 *   • Unit-price intermediate values: 4 decimals via Big internal precision.
 *
 * IVA convention for this POS:
 *   unit_price and line_total are GROSS (IVA included).
 *   The net base for SRI = gross / (1 + rate/100).
 */

import Big from "big.js";

// ── Domain types ───────────────────────────────────────────────────────────

export type PosBundleComponent = {
  product_id:  string;
  quantity:    number;
  base_qty:    number;
  sort_order:  number;
};

export type PosPresentation = {
  id:         string;
  name:       string;
  unit_label: string;
  /** Multiplier relative to base unit (e.g. 0.2 for a gallon from a caneca). */
  base_qty:   number;
  unit_price: number | null;   // null → fall back to product list price
  is_default: boolean;
  sort_order: number;
};

export type PosProduct = {
  id:              string;
  name:            string;
  sku:             string;
  unit:            string;
  price:           number;   // GROSS list price (PUBLICO tier, IVA included)
  tax_rate:        number;
  has_tax:         boolean;
  track_inventory: boolean;
  product_kind:    string;
  stock:           number;   // base-unit stock (or 0 for services)
  presentations:   PosPresentation[];
  is_kit:          boolean;
  kit_components:  PosBundleComponent[];
  average_cost:    number;   // CPP net (s/IVA); 0 if unknown
};

export type CartLine = {
  key:             string;
  product_id:      string | null;
  presentation_id: string | null;
  name:            string;
  unit_label:      string;
  /** GROSS list price for this presentation (IVA included). */
  unit_price:      number;
  base_qty:        number;
  tax_rate:        number;
  has_tax:         boolean;
  track_inventory: boolean;
  /** Base-unit stock snapshot at add-to-cart time. */
  stock_base:      number;
  quantity:        number;
  /** Explicit flat discount applied on top of any price override. */
  discount_amount: number;
  /** CPP snapshot from product at add-to-cart time (net, s/IVA). */
  average_cost:    number;
  // price override
  override_unit_price:   number | null;
  price_override_type:   string | null;
  price_override_reason: string | null;
  price_override_note:   string | null;
  // kit / bundle
  is_kit:          boolean;
  kit_components:  PosBundleComponent[];
};

export type OverridePayload = {
  override_unit_price:   number;
  price_override_type:   string | null;
  price_override_reason: string;
  price_override_note:   string | null;
};

/** Result of resolvePresentation — the unit / price values to use for a cart line. */
export type ResolvedPresentation = {
  unit_label:      string;
  unit_price:      number;
  base_qty:        number;
  presentation_id: string | null;
};

export type CartTotals = {
  /** GROSS total (IVA included) — what the customer pays. */
  gross: Big;
  /** NET total (IVA excluded) — subtotal for SRI. */
  net:   Big;
  /** IVA = gross − net. */
  iva:   Big;
  /** Total number of presentation-units across all lines. */
  items: number;
};

// ── Core line math ─────────────────────────────────────────────────────────

/**
 * Selling price per unit for a line — override takes priority.
 * Returns the GROSS unit price (IVA included).
 */
export function effectivePrice(line: CartLine): number {
  return line.override_unit_price ?? line.unit_price;
}

/**
 * GROSS total for one cart line: (effective_price × qty) − discount.
 * Result is exact (Big), unrounded.
 */
export function lineGross(line: CartLine): Big {
  return Big(effectivePrice(line))
    .times(line.quantity)
    .minus(line.discount_amount);
}

/**
 * NET base of one cart line (IVA stripped).
 * For non-taxable lines, net = gross.
 * For taxable lines: net = gross / (1 + tax_rate/100).
 */
export function lineNet(line: CartLine): Big {
  const gross = lineGross(line);
  if (!line.has_tax || line.tax_rate <= 0) return gross;
  return gross.div(Big(1).plus(Big(line.tax_rate).div(100)));
}

/** Convenience: number of base units consumed by a cart line (qty × base_qty). */
export function lineBaseUnits(line: CartLine): number {
  return line.quantity * line.base_qty;
}

// ── Cart totals ────────────────────────────────────────────────────────────

/**
 * Aggregate GROSS / NET / IVA for the whole cart.
 * All monetary results rounded to 2 decimals (HALF_UP).
 */
export function calcTotals(cart: CartLine[]): CartTotals {
  let gross = Big(0);
  let net   = Big(0);
  let items = 0;

  for (const line of cart) {
    gross = gross.plus(lineGross(line));
    net   = net.plus(lineNet(line));
    items += line.quantity;
  }

  return {
    gross: gross.round(2, Big.roundHalfUp),
    net:   net.round(2, Big.roundHalfUp),
    iva:   gross.minus(net).round(2, Big.roundHalfUp),
    items,
  };
}

// ── Presentation helpers ───────────────────────────────────────────────────

/**
 * Resolve the display/price values for a cart line from a product + presentation.
 * If presentation is null, falls back to the product's base unit and list price.
 */
export function resolvePresentation(
  product: PosProduct,
  pres:    PosPresentation | null,
): ResolvedPresentation {
  if (!pres) {
    return {
      unit_label:      product.unit,
      unit_price:      product.price,
      base_qty:        1,
      presentation_id: null,
    };
  }
  return {
    unit_label:      pres.unit_label,
    unit_price:      pres.unit_price ?? product.price,
    base_qty:        pres.base_qty,
    presentation_id: pres.id,
  };
}

/**
 * How many presentation-units can be sold given a base-unit stock.
 *
 * Example: 100 base units (canecas), base_qty = 0.2 (galón) → 500 galones.
 * Always floors to avoid overselling a fraction.
 */
export function stockForPresentation(baseStock: number, baseQty: number): number {
  if (baseQty <= 0) return baseStock;
  return Math.floor(baseStock / baseQty);
}

// ── Discount helpers ───────────────────────────────────────────────────────

/**
 * Apply a percentage discount to a list price.
 * Returns the new GROSS unit price, rounded to 2 decimals.
 *
 * @param listPrice  original GROSS price (IVA included)
 * @param pctOff     discount percentage (0–100)
 */
export function applyPctDiscount(listPrice: number, pctOff: number): number {
  const result = Big(listPrice)
    .times(Big(100).minus(pctOff).div(100))
    .round(2, Big.roundHalfUp);
  return Math.max(0, Number(result.toString()));
}

// ── Below-cost detection ───────────────────────────────────────────────────

/**
 * Returns true when a line's effective net price per presentation-unit
 * is below the product's average cost (CPP) for that presentation size.
 *
 * - Kits are excluded (their net cost depends on component prices).
 * - Lines without cost data (average_cost = 0) are never flagged.
 * - The comparison is: net_per_pres < average_cost × base_qty
 *   (both are per-presentation quantities, accounting for size).
 */
export function isBelowCost(line: CartLine): boolean {
  if (line.average_cost <= 0 || line.is_kit) return false;

  const grossUnit = Big(effectivePrice(line));
  const netUnit   = line.has_tax && line.tax_rate > 0
    ? grossUnit.div(Big(1).plus(Big(line.tax_rate).div(100)))
    : grossUnit;

  const costPerPres = Big(line.average_cost).times(Big(line.base_qty));
  return netUnit.lt(costPerPres);
}
