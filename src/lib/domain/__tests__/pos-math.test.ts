import { describe, it, expect } from "vitest";
import Big from "big.js";
import {
  effectivePrice,
  lineGross,
  lineNet,
  calcTotals,
  resolvePresentation,
  stockForPresentation,
  applyPctDiscount,
  isBelowCost,
  type CartLine,
  type PosProduct,
  type PosPresentation,
} from "../pos-math";

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeLine(overrides: Partial<CartLine> = {}): CartLine {
  return {
    key:             "prod-1::base",
    product_id:      "prod-1",
    presentation_id: null,
    name:            "Aceite 20W-50",
    unit_label:      "cuarto",
    unit_price:      5.75,
    base_qty:        1,
    tax_rate:        15,
    has_tax:         true,
    track_inventory: true,
    stock_base:      100,
    quantity:        1,
    discount_amount: 0,
    average_cost:    3.50,
    override_unit_price:   null,
    price_override_type:   null,
    price_override_reason: null,
    price_override_note:   null,
    is_kit:          false,
    kit_components:  [],
    ...overrides,
  };
}

function makeProduct(overrides: Partial<PosProduct> = {}): PosProduct {
  return {
    id:              "prod-1",
    name:            "Aceite 20W-50",
    sku:             "ACT-001",
    unit:            "cuarto",
    price:           5.75,
    tax_rate:        15,
    has_tax:         true,
    track_inventory: true,
    product_kind:    "item",
    stock:           100,
    presentations:   [],
    is_kit:          false,
    kit_components:  [],
    average_cost:    3.50,
    ...overrides,
  };
}

function makePresentation(overrides: Partial<PosPresentation> = {}): PosPresentation {
  return {
    id:         "pres-1",
    name:       "Galón",
    unit_label: "galón",
    base_qty:   4,
    unit_price: 20.00,
    is_default: false,
    sort_order: 1,
    ...overrides,
  };
}

// ── effectivePrice ─────────────────────────────────────────────────────────

describe("effectivePrice", () => {
  it("returns unit_price when no override", () => {
    expect(effectivePrice(makeLine())).toBe(5.75);
  });

  it("returns override_unit_price when set", () => {
    expect(effectivePrice(makeLine({ override_unit_price: 4.00 }))).toBe(4.00);
  });

  it("returns override even when override is 0 (courtesy)", () => {
    expect(effectivePrice(makeLine({ override_unit_price: 0 }))).toBe(0);
  });
});

// ── lineGross ──────────────────────────────────────────────────────────────

describe("lineGross", () => {
  it("qty=1, no discount → unit_price", () => {
    const result = lineGross(makeLine({ quantity: 1, discount_amount: 0 }));
    expect(result.toFixed(2)).toBe("5.75");
  });

  it("qty=3, no discount → 3 × price", () => {
    const result = lineGross(makeLine({ quantity: 3, unit_price: 5.75, discount_amount: 0 }));
    expect(result.toFixed(2)).toBe("17.25");
  });

  it("applies explicit discount_amount", () => {
    const result = lineGross(makeLine({ quantity: 1, unit_price: 10.00, discount_amount: 2.00 }));
    expect(result.toFixed(2)).toBe("8.00");
  });

  it("uses override price when set", () => {
    const result = lineGross(makeLine({ quantity: 2, unit_price: 10.00, override_unit_price: 7.00, discount_amount: 0 }));
    expect(result.toFixed(2)).toBe("14.00");
  });

  it("courtesy line (override=0) → 0 gross", () => {
    const result = lineGross(makeLine({ quantity: 3, override_unit_price: 0, discount_amount: 0 }));
    expect(result.toFixed(2)).toBe("0.00");
  });

  // Floating-point precision guard
  it("avoids IEEE-754 drift: 0.10+0.10+0.10 = 0.30 not 0.30000000000000004", () => {
    const line = makeLine({ quantity: 3, unit_price: 0.10, discount_amount: 0 });
    expect(lineGross(line).toFixed(2)).toBe("0.30");
  });

  it("qty=0 → 0.00", () => {
    expect(lineGross(makeLine({ quantity: 0 })).toFixed(2)).toBe("0.00");
  });
});

// ── lineNet ────────────────────────────────────────────────────────────────

describe("lineNet", () => {
  it("non-taxable line returns gross unchanged", () => {
    const line = makeLine({ has_tax: false, unit_price: 10.00, quantity: 1, discount_amount: 0 });
    expect(lineNet(line).toFixed(2)).toBe("10.00");
  });

  it("has_tax=true but tax_rate=0 returns gross unchanged", () => {
    const line = makeLine({ has_tax: true, tax_rate: 0, unit_price: 10.00, quantity: 1, discount_amount: 0 });
    expect(lineNet(line).toFixed(2)).toBe("10.00");
  });

  it("IVA 15%: strips correctly from gross=1.15 → net=1.00", () => {
    const line = makeLine({ has_tax: true, tax_rate: 15, unit_price: 1.15, quantity: 1, discount_amount: 0 });
    // net = 1.15 / 1.15 = 1.000...
    expect(lineNet(line).toFixed(2)).toBe("1.00");
  });

  it("IVA 15%: gross=10.00 → net=8.70 (≈8.695652...)", () => {
    const line = makeLine({ has_tax: true, tax_rate: 15, unit_price: 10.00, quantity: 1, discount_amount: 0 });
    // 10 / 1.15 = 8.695652... → 8.70 when rounded to 2 dp (but we leave rounding to calcTotals)
    const net = lineNet(line);
    // lineNet itself is unrounded internal — just verify it's the right ballpark
    expect(Number(net.toString())).toBeCloseTo(8.695652, 4);
  });

  it("IVA 15%: qty=4, unit_price=5.75, discount=0", () => {
    const line = makeLine({ has_tax: true, tax_rate: 15, unit_price: 5.75, quantity: 4, discount_amount: 0 });
    // gross = 23.00, net = 23.00/1.15 = 20.00
    expect(lineNet(line).toFixed(2)).toBe("20.00");
  });

  it("override price used in net calculation", () => {
    const line = makeLine({ has_tax: true, tax_rate: 15, unit_price: 10.00, override_unit_price: 5.75, quantity: 2, discount_amount: 0 });
    // gross = 11.50, net = 11.50/1.15 = 10.00
    expect(lineNet(line).toFixed(2)).toBe("10.00");
  });

  it("courtesy line: net = 0", () => {
    const line = makeLine({ has_tax: true, tax_rate: 15, override_unit_price: 0, quantity: 5, discount_amount: 0 });
    expect(lineNet(line).toFixed(2)).toBe("0.00");
  });
});

// ── calcTotals ─────────────────────────────────────────────────────────────

describe("calcTotals", () => {
  it("empty cart returns zeros", () => {
    const t = calcTotals([]);
    expect(t.gross.toFixed(2)).toBe("0.00");
    expect(t.net.toFixed(2)).toBe("0.00");
    expect(t.iva.toFixed(2)).toBe("0.00");
    expect(t.items).toBe(0);
  });

  it("single taxable line, qty=1, price=5.75: gross=5.75, iva≈0.75, net≈5.00", () => {
    // 5.75 / 1.15 = 5.000, iva = 5.75 - 5.00 = 0.75
    const t = calcTotals([makeLine({ quantity: 1, unit_price: 5.75, discount_amount: 0 })]);
    expect(t.gross.toFixed(2)).toBe("5.75");
    expect(t.net.toFixed(2)).toBe("5.00");
    expect(t.iva.toFixed(2)).toBe("0.75");
    expect(t.items).toBe(1);
  });

  it("single non-taxable line: gross = net, iva = 0", () => {
    const line = makeLine({ has_tax: false, unit_price: 10.00, quantity: 2, discount_amount: 0 });
    const t = calcTotals([line]);
    expect(t.gross.toFixed(2)).toBe("20.00");
    expect(t.net.toFixed(2)).toBe("20.00");
    expect(t.iva.toFixed(2)).toBe("0.00");
    expect(t.items).toBe(2);
  });

  it("mixed taxable + non-taxable lines", () => {
    const taxable    = makeLine({ key: "a", has_tax: true,  tax_rate: 15, unit_price: 11.50, quantity: 2, discount_amount: 0 });
    const nonTaxable = makeLine({ key: "b", has_tax: false, unit_price: 5.00,  quantity: 3, discount_amount: 0 });
    // taxable: gross=23.00, net=23/1.15=20.00, iva=3.00
    // nonTax:  gross=15.00, net=15.00, iva=0
    const t = calcTotals([taxable, nonTaxable]);
    expect(t.gross.toFixed(2)).toBe("38.00");
    expect(t.net.toFixed(2)).toBe("35.00");
    expect(t.iva.toFixed(2)).toBe("3.00");
    expect(t.items).toBe(5);
  });

  it("items count sums quantities across all lines", () => {
    const l1 = makeLine({ key: "x", quantity: 4 });
    const l2 = makeLine({ key: "y", quantity: 7 });
    expect(calcTotals([l1, l2]).items).toBe(11);
  });

  it("IVA precision: 3 items at $0.10 each (IVA 15%) → no floating drift", () => {
    const line = makeLine({ has_tax: true, tax_rate: 15, unit_price: 0.10, quantity: 3, discount_amount: 0 });
    const t = calcTotals([line]);
    // gross = 0.30, net = 0.30/1.15 ≈ 0.26, iva ≈ 0.04
    expect(Number(t.gross.toFixed(4))).toBe(0.3);       // exact via Big
    expect(t.iva.lte(t.gross)).toBe(true);
    expect(t.gross.minus(t.net).minus(t.iva).abs().lt(Big("0.01"))).toBe(true);
  });

  it("gross − net − iva should be zero (rounding invariant) for large cart", () => {
    const lines = Array.from({ length: 10 }, (_, i) =>
      makeLine({ key: String(i), quantity: i + 1, unit_price: 1.11 * (i + 1), discount_amount: 0 })
    );
    const t = calcTotals(lines);
    // Due to independent HALF_UP rounding on gross and net, iva is a derived value,
    // so gross - net - iva should be within 1 cent.
    const drift = t.gross.minus(t.net).minus(t.iva).abs();
    expect(drift.lte(Big("0.01"))).toBe(true);
  });
});

// ── resolvePresentation ────────────────────────────────────────────────────

describe("resolvePresentation", () => {
  const product = makeProduct();

  it("null presentation returns product base values", () => {
    const r = resolvePresentation(product, null);
    expect(r.unit_label).toBe("cuarto");
    expect(r.unit_price).toBe(5.75);
    expect(r.base_qty).toBe(1);
    expect(r.presentation_id).toBeNull();
  });

  it("presentation with own price uses its price", () => {
    const pres = makePresentation({ unit_price: 20.00 });
    const r = resolvePresentation(product, pres);
    expect(r.unit_price).toBe(20.00);
    expect(r.unit_label).toBe("galón");
    expect(r.base_qty).toBe(4);
    expect(r.presentation_id).toBe("pres-1");
  });

  it("presentation with null price falls back to product.price", () => {
    const pres = makePresentation({ unit_price: null });
    const r = resolvePresentation(product, pres);
    expect(r.unit_price).toBe(5.75); // product price
  });

  it("presentation with price=0 is a valid price (not fallback)", () => {
    const pres = makePresentation({ unit_price: 0 });
    const r = resolvePresentation(product, pres);
    expect(r.unit_price).toBe(0);
  });
});

// ── stockForPresentation ───────────────────────────────────────────────────

describe("stockForPresentation", () => {
  it("base_qty=1 returns stock unchanged", () => {
    expect(stockForPresentation(100, 1)).toBe(100);
  });

  it("base_qty=0 guard: returns baseStock as-is", () => {
    expect(stockForPresentation(100, 0)).toBe(100);
  });

  it("caneca of 5L, selling in galones (1L): 20 canecas → 100 galones", () => {
    // canecas=20 base units, base_qty_of_gallon=0.2 → 20/0.2 = 100
    expect(stockForPresentation(20, 0.2)).toBe(100);
  });

  it("floor prevents overselling fractional units", () => {
    // 10 base units, base_qty=3 → floor(10/3)=3, not 3.33...
    expect(stockForPresentation(10, 3)).toBe(3);
  });

  it("zero stock returns 0", () => {
    expect(stockForPresentation(0, 1)).toBe(0);
    expect(stockForPresentation(0, 4)).toBe(0);
  });

  it("fractional base_qty: 7 units, base_qty=0.5 → 14 halves", () => {
    expect(stockForPresentation(7, 0.5)).toBe(14);
  });
});

// ── applyPctDiscount ───────────────────────────────────────────────────────

describe("applyPctDiscount", () => {
  it("0% → original price unchanged", () => {
    expect(applyPctDiscount(10.00, 0)).toBe(10.00);
  });

  it("100% → 0 (full discount)", () => {
    expect(applyPctDiscount(10.00, 100)).toBe(0);
  });

  it("10% off $10.00 → $9.00", () => {
    expect(applyPctDiscount(10.00, 10)).toBe(9.00);
  });

  it("25% off $8.00 → $6.00", () => {
    expect(applyPctDiscount(8.00, 25)).toBe(6.00);
  });

  it("10% off $9.99 → $8.99 (correct rounding)", () => {
    // 9.99 × 0.9 = 8.991 → rounds HALF_UP to 8.99
    expect(applyPctDiscount(9.99, 10)).toBe(8.99);
  });

  it("33.33% off $100 → $66.67 (rounds to nearest cent)", () => {
    // 100 × (100 - 33.33)/100 = 66.67
    expect(applyPctDiscount(100, 33.33)).toBe(66.67);
  });

  it("negative result clamped to 0 (pct > 100 guard)", () => {
    expect(applyPctDiscount(5.00, 110)).toBe(0);
  });

  it("no floating point drift: 15% of $5.75", () => {
    // 5.75 × 0.85 = 4.8875 → rounds to 4.89
    expect(applyPctDiscount(5.75, 15)).toBe(4.89);
  });
});

// ── isBelowCost ────────────────────────────────────────────────────────────

describe("isBelowCost", () => {
  it("average_cost=0 → never below cost", () => {
    const line = makeLine({ average_cost: 0, unit_price: 0.01 });
    expect(isBelowCost(line)).toBe(false);
  });

  it("is_kit=true → never below cost (kit cost is composite)", () => {
    const line = makeLine({ is_kit: true, average_cost: 5.00, unit_price: 1.00 });
    expect(isBelowCost(line)).toBe(false);
  });

  it("selling above cost → false", () => {
    // unit_price=5.75 (gross), tax_rate=15 → net=5.00, cost=3.50 × base_qty=1 → ok
    const line = makeLine({ unit_price: 5.75, has_tax: true, tax_rate: 15, average_cost: 3.50, base_qty: 1 });
    expect(isBelowCost(line)).toBe(false);
  });

  it("selling below cost → true", () => {
    // unit_price=2.30 (gross), tax_rate=15 → net=2.00, cost=3.50 → below cost
    const line = makeLine({ unit_price: 2.30, has_tax: true, tax_rate: 15, average_cost: 3.50, base_qty: 1 });
    expect(isBelowCost(line)).toBe(true);
  });

  it("non-taxable: gross is compared directly to cost", () => {
    const line = makeLine({ has_tax: false, unit_price: 3.00, average_cost: 4.00, base_qty: 1 });
    expect(isBelowCost(line)).toBe(true);
  });

  it("base_qty > 1: cost scaled to presentation size", () => {
    // gallon: base_qty=4, average_cost (per base unit) = $1.00
    // cost per gallon = $4.00; selling at $5.75 gross, net=5.00 → ok
    const line = makeLine({ unit_price: 5.75, has_tax: true, tax_rate: 15, average_cost: 1.00, base_qty: 4 });
    // net per gallon = 5.00, cost per gallon = 4.00 → ok
    expect(isBelowCost(line)).toBe(false);
  });

  it("base_qty > 1, below cost: selling gallon at a loss", () => {
    // base_qty=4, cost=$2/unit → cost per gallon=$8; net price=$5 → loss
    const line = makeLine({ unit_price: 5.75, has_tax: true, tax_rate: 15, average_cost: 2.00, base_qty: 4 });
    // net = 5.75/1.15 = 5.00, cost per pres = 2×4=8.00 → below cost
    expect(isBelowCost(line)).toBe(true);
  });

  it("override to courtesy (price=0) → always below cost when cost > 0", () => {
    const line = makeLine({ override_unit_price: 0, average_cost: 3.50, base_qty: 1 });
    expect(isBelowCost(line)).toBe(true);
  });
});
