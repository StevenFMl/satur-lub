"use client";

import * as React from "react";
import Link from "next/link";
import Big from "big.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { Dialog } from "@/components/ui/dialog";
import { CustomerPicker, type PickedCustomer } from "@/components/dashboard/customer-picker";
import type { PosPermissions } from "@/lib/auth/permissions";
import { PRICE_OVERRIDE_LABELS, type PriceOverrideType } from "@/lib/validations/sale";
import { CheckoutDialog } from "./checkout-dialog";

// ── Types ──────────────────────────────────────────────────────────────────

export type PosPresentation = {
  id:         string;
  name:       string;
  unit_label: string;
  base_qty:   number;
  unit_price: number | null;
  is_default: boolean;
  sort_order: number;
};

export type PosBundleComponent = {
  product_id:  string;
  quantity:    number;
  base_qty:    number;
  sort_order:  number;
};

export type PosProduct = {
  id:              string;
  name:            string;
  sku:             string;
  unit:            string;
  price:           number;      // GROSS (inc. IVA) — PUBLICO tier
  tax_rate:        number;
  has_tax:         boolean;
  track_inventory: boolean;
  product_kind:    string;
  stock:           number;      // in base units (or min-sellable for kits)
  presentations:   PosPresentation[];
  is_kit:          boolean;
  kit_components:  PosBundleComponent[];
  average_cost:    number;      // CPP actual (s/IVA); 0 para servicios
};

export type PosWarehouse = { id: string; name: string };

export type ActiveCashSession = {
  id:             string;
  opening_amount: number;
  opened_at:      string;
};

type CartLine = {
  key:             string;
  product_id:      string | null;
  presentation_id: string | null;
  name:            string;
  unit_label:      string;
  unit_price:      number;      // list GROSS for this presentation
  base_qty:        number;
  tax_rate:        number;
  has_tax:         boolean;
  track_inventory: boolean;
  stock_base:      number;
  quantity:        number;
  discount_amount: number;
  average_cost:    number;      // CPP snapshot from product at add-to-cart time
  // price override
  override_unit_price:   number | null;
  price_override_type:   string | null;
  price_override_reason: string | null;
  price_override_note:   string | null;
  // kit/bundle
  is_kit:          boolean;
  kit_components:  PosBundleComponent[];
};

type OverridePayload = {
  override_unit_price:   number;
  price_override_type:   string | null;
  price_override_reason: string;
  price_override_note:   string | null;
};

// ── Constants ──────────────────────────────────────────────────────────────

const PAGE_SIZE = 24;

const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

const OVERRIDE_OPTIONS = (
  Object.entries(PRICE_OVERRIDE_LABELS) as [PriceOverrideType, string][]
).map(([value, label]) => ({ value, label }));

// ── Math (big.js) ──────────────────────────────────────────────────────────

function effectivePrice(line: CartLine): number {
  return line.override_unit_price ?? line.unit_price;
}

function lineGross(line: CartLine): Big {
  return Big(effectivePrice(line)).times(line.quantity).minus(line.discount_amount);
}

function lineNet(line: CartLine): Big {
  const g = lineGross(line);
  if (!line.has_tax || line.tax_rate <= 0) return g;
  return g.div(Big(1).plus(Big(line.tax_rate).div(100)));
}

function calcTotals(cart: CartLine[]) {
  let gross = Big(0);
  let net   = Big(0);
  for (const l of cart) {
    gross = gross.plus(lineGross(l));
    net   = net.plus(lineNet(l));
  }
  const iva   = gross.minus(net);
  const items = cart.reduce((s, l) => s + l.quantity, 0);
  return {
    gross: gross.round(2, Big.roundHalfUp),
    net:   net.round(2, Big.roundHalfUp),
    iva:   iva.round(2, Big.roundHalfUp),
    items,
  };
}

// ── Presentation helpers ───────────────────────────────────────────────────

function resolvePresentation(
  product: PosProduct,
  pres: PosPresentation | null
): { unit_label: string; unit_price: number; base_qty: number; presentation_id: string | null } {
  if (!pres) {
    return { unit_label: product.unit, unit_price: product.price, base_qty: 1, presentation_id: null };
  }
  return {
    unit_label:      pres.unit_label,
    unit_price:      pres.unit_price ?? product.price,
    base_qty:        pres.base_qty,
    presentation_id: pres.id,
  };
}

function stockForPresentation(baseStock: number, baseQty: number): number {
  if (baseQty <= 0) return baseStock;
  return Math.floor(baseStock / baseQty);
}

function useDebounce<T>(value: T, delay: number): T {
  const [d, setD] = React.useState<T>(value);
  React.useEffect(() => {
    const t = setTimeout(() => setD(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return d;
}

// ── Main component ─────────────────────────────────────────────────────────

export function PosTerminal({
  products,
  warehouses,
  defaultCustomer,
  permissions,
  userName,
  activeCashSession,
}: {
  products:          PosProduct[];
  warehouses:        PosWarehouse[];
  defaultCustomer:   PickedCustomer | null;
  permissions:       PosPermissions;
  userName:          string;
  activeCashSession: ActiveCashSession | null;
}) {
  const [cart, setCart]           = React.useState<CartLine[]>([]);
  const [customer, setCustomer]   = React.useState<PickedCustomer | null>(defaultCustomer);
  const [warehouseId, setWarehouseId] = React.useState<string | null>(
    warehouses.length === 1 ? (warehouses[0]?.id ?? null) : null
  );
  const [searchQuery, setSearchQuery]       = React.useState("");
  const debouncedQuery                      = useDebounce(searchQuery, 150);
  const [page, setPage]                     = React.useState(0);
  const [mobileCartOpen, setMobileCartOpen]   = React.useState(false);
  const [checkoutOpen, setCheckoutOpen]       = React.useState(false);
  const [checkoutMode, setCheckoutMode]       = React.useState<"normal" | "credit">("normal");
  const [flashKeys, setFlashKeys]             = React.useState<Set<string>>(new Set());
  const [manualItemOpen, setManualItemOpen]   = React.useState(false);
  // Presentation picker: set when clicking a product that has presentations
  const [pickingProduct, setPickingProduct]   = React.useState<PosProduct | null>(null);

  const searchInputRef = React.useRef<HTMLInputElement>(null);

  // Map productId → name for kit component display in cart
  const productNameById = React.useMemo(
    () => new Map(products.map((p) => [p.id, p.name])),
    [products]
  );

  React.useEffect(() => setPage(0), [debouncedQuery]);

  // ── Catalog ──────────────────────────────────────────────
  const filteredProducts = React.useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
    );
  }, [products, debouncedQuery]);

  const totalPages   = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const safePage     = Math.min(page, totalPages - 1);
  const pageProducts = filteredProducts.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const addManualToCart = React.useCallback((item: { name: string; unit_price: number; quantity: number; has_tax: boolean; average_cost: number }) => {
    const lineKey = `manual::${crypto.randomUUID()}`;
    setCart((prev) => [
      ...prev,
      {
        key:             lineKey,
        product_id:      null,
        presentation_id: null,
        name:            item.name,
        unit_label:      "unidad",
        unit_price:      item.unit_price,
        base_qty:        1,
        tax_rate:        15,
        has_tax:         item.has_tax,
        track_inventory: false,
        stock_base:      0,
        quantity:        item.quantity,
        discount_amount: 0,
        average_cost:    item.average_cost,
        override_unit_price: null,
        price_override_type: null,
        price_override_reason: null,
        price_override_note: null,
        is_kit:          false,
        kit_components:  [],
      }
    ]);
  }, []);

  const addToCart = React.useCallback((product: PosProduct, pres: PosPresentation | null = null) => {
    const resolved = resolvePresentation(product, pres);
    const lineKey  = `${product.id}::${resolved.presentation_id ?? "base"}`;

    setCart((prev) => {
      const idx = prev.findIndex((l) => l.key === lineKey);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...(updated[idx] as CartLine), quantity: (updated[idx] as CartLine).quantity + 1 };
        return updated;
      }
      return [
        ...prev,
        {
          key:             lineKey,
          product_id:      product.id,
          presentation_id: resolved.presentation_id,
          name:            product.name,
          unit_label:      resolved.unit_label,
          unit_price:      resolved.unit_price,
          base_qty:        resolved.base_qty,
          tax_rate:        product.tax_rate,
          has_tax:         product.has_tax,
          track_inventory: product.track_inventory,
          stock_base:      product.stock,
          quantity:        1,
          discount_amount: 0,
          average_cost:    product.average_cost,
          override_unit_price:   null,
          price_override_type:   null,
          price_override_reason: null,
          price_override_note:   null,
          is_kit:          product.is_kit,
          kit_components:  product.kit_components,
        },
      ];
    });

    setFlashKeys((prev) => { const n = new Set(prev); n.add(lineKey); return n; });
    setTimeout(() => setFlashKeys((prev) => { const n = new Set(prev); n.delete(lineKey); return n; }), 600);
  }, []);

  const setQty = (key: string, qty: number) => {
    if (qty <= 0) setCart((prev) => prev.filter((l) => l.key !== key));
    else setCart((prev) => prev.map((l) => l.key === key ? { ...l, quantity: qty } : l));
  };

  const removeFromCart = React.useCallback((key: string) =>
    setCart((prev) => prev.filter((l) => l.key !== key)), []);

  const applyOverride = (key: string, payload: OverridePayload | null) => {
    setCart((prev) =>
      prev.map((l) =>
        l.key !== key ? l : {
          ...l,
          override_unit_price:   payload?.override_unit_price   ?? null,
          price_override_type:   payload?.price_override_type   ?? null,
          price_override_reason: payload?.price_override_reason ?? null,
          price_override_note:   payload?.price_override_note   ?? null,
        }
      )
    );
  };

  const clearCart = () => {
    setCart([]);
    setCustomer(defaultCustomer);
  };

  // ── Bulk cart actions ────────────────────────────────────
  const applyCourtesy = React.useCallback((reason: string) => {
    setCart((prev) => prev.map((l) => ({
      ...l,
      override_unit_price:   0,
      price_override_type:   "courtesy",
      price_override_reason: reason,
      price_override_note:   null,
    })));
  }, []);

  const applyGlobalDiscount = React.useCallback((pct: number) => {
    setCart((prev) => prev.map((l) => ({
      ...l,
      override_unit_price: Math.max(0,
        Number(Big(l.unit_price).times(Big(100 - pct).div(100)).round(2, Big.roundHalfUp).toString())
      ),
      price_override_type:   "price_set",
      price_override_reason: `Descuento ${pct}%`,
      price_override_note:   null,
    })));
  }, []);

  // ── Keyboard shortcuts ───────────────────────────────────
  // Use refs to read current state inside a stable listener
  const canCheckoutRef = React.useRef(false);
  const checkoutOpenRef = React.useRef(false);
  const cartRef = React.useRef<CartLine[]>([]);
  canCheckoutRef.current = cart.length > 0 && customer != null &&
    !(warehouseId != null && cart.some((l) => (l.track_inventory || (l.is_kit && l.kit_components.length > 0)) && l.quantity * l.base_qty > l.stock_base));
  checkoutOpenRef.current = checkoutOpen;
  cartRef.current = cart;

  React.useEffect(() => {
    function handler(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      const inInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
                      (e.target as HTMLElement).contentEditable === "true";

      if (e.key === "F4") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if (e.key === "F8" && !inInput && canCheckoutRef.current && !checkoutOpenRef.current) {
        e.preventDefault();
        setCheckoutMode("normal");
        setCheckoutOpen(true);
        return;
      }
      if (e.key === "Delete" && !inInput) {
        const last = cartRef.current[cartRef.current.length - 1];
        if (last) setCart((prev) => prev.filter((l) => l.key !== last.key));
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []); // intentionally stable — reads via refs

  // ── Totals ───────────────────────────────────────────────
  const totals = React.useMemo(() => calcTotals(cart), [cart]);

  const hasStockIssue = React.useMemo(() =>
    warehouseId != null &&
    cart.some((l) => (l.track_inventory || (l.is_kit && l.kit_components.length > 0)) && l.quantity * l.base_qty > l.stock_base),
    [cart, warehouseId]
  );

  // Líneas vendidas por debajo del CPP (solo productos con costo > 0)
  const hasBelowCostItems = React.useMemo(() =>
    cart.some((l) => {
      if (l.average_cost <= 0 || l.is_kit) return false;
      const gross   = effectivePrice(l);
      const netLine = l.has_tax && l.tax_rate > 0
        ? gross / (1 + l.tax_rate / 100)
        : gross;
      // Scale by base_qty: a galón (base_qty=0.2) of a $15/caneca product
      // costs $3/galón — compare net price per presentation, not per base unit.
      return netLine < l.average_cost * l.base_qty;
    }),
    [cart]
  );

  const canCheckout = cart.length > 0 && customer != null && !hasStockIssue;

  const openCheckout = (mode: "normal" | "credit") => {
    setCheckoutMode(mode);
    setCheckoutOpen(true);
  };

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="flex w-full flex-col gap-4">
      {/* ── Header ────────────────────────────────────────── */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-3">
        <div className="flex-1 min-w-0">
          <CustomerPicker selected={customer} onSelect={setCustomer} />
        </div>

        {warehouses.length > 1 ? (
          <div className="w-full sm:w-44 shrink-0">
            <Select
              value={warehouseId ?? ""}
              onChange={(e) => setWarehouseId(e.target.value || null)}
              aria-label="Bodega"
            >
              <option value="">— Sin bodega —</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </Select>
          </div>
        ) : null}

        {/* Cash session indicator */}
        <Link
          href="/dashboard/pos/caja"
          className={[
            "hidden shrink-0 items-center gap-1.5 rounded-sm border px-2.5 py-1.5 transition-colors sm:flex",
            activeCashSession
              ? "border-signal-600/40 bg-signal-700/10 hover:bg-signal-700/20"
              : "border-steel-700 bg-steel-900/50 hover:border-steel-600",
          ].join(" ")}
          title="Sesión de caja"
        >
          <CashRegisterIcon className={[
            "h-3.5 w-3.5",
            activeCashSession ? "text-signal-400" : "text-muted-foreground/50",
          ].join(" ")} />
          <span className={[
            "font-mono text-[10px] font-bold uppercase tracking-[0.12em]",
            activeCashSession ? "text-signal-400" : "text-muted-foreground/50",
          ].join(" ")}>
            {activeCashSession ? "Caja abierta" : "Sin caja"}
          </span>
        </Link>

        <div className="hidden shrink-0 items-center gap-1.5 rounded-sm border border-steel-700 bg-steel-900/50 px-2.5 py-1.5 sm:flex">
          <UserIcon className="h-3.5 w-3.5 text-muted-foreground/70" />
          <span className="max-w-[100px] truncate font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            {userName}
          </span>
        </div>
      </div>

      {warehouses.length > 0 && !warehouseId ? (
        <Alert tone="warning">Sin bodega — las ventas no descontarán inventario.</Alert>
      ) : null}

      {/* ── Two-panel layout ──────────────────────────────── */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-5">

        {/* ── CATALOG ─────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar producto (F4)..."
                className="h-11 pl-10"
                autoComplete="off"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <XSmallIcon className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setManualItemOpen(true)}
              className="h-11 shrink-0 bg-steel-900/50 border-steel-700 hover:border-safety-500 hover:text-safety-500"
            >
              + Ítem Manual
            </Button>
          </div>

          {filteredProducts.length === 0 ? (
            <div className="panel flex flex-col items-center gap-3 rounded-sm py-14 text-center">
              <BoxIcon className="h-9 w-9 text-muted-foreground/30" />
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                {products.length === 0 ? "Sin productos en el catálogo" : "Sin resultados"}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {pageProducts.map((product) => {
                const defaultPres = product.presentations.find((p) => p.is_default) ?? null;
                const cartLines   = cart.filter((l) => l.product_id === product.id);
                const totalInCart = cartLines.reduce((s, l) => s + l.quantity, 0);
                const baseInCart  = cartLines.reduce((s, l) => s + l.quantity * l.base_qty, 0);
                const isConfiguredKit = product.is_kit && product.kit_components.length > 0;
                const noStock     = warehouseId != null && (product.track_inventory || isConfiguredKit) && product.stock - baseInCart <= 0;
                const noPrice     = product.price === 0 && !product.presentations.some((p) => p.unit_price);
                const isFlashing  = cartLines.some((l) => flashKeys.has(l.key));

                // Card is a <div role="button"> (not <button>) so we can nest the
                // secondary "Fracción" <button> inside it — valid HTML, no hydration error.
                const hasFractions = product.presentations.length >= 1;

                return (
                  <div
                    key={product.id}
                    role="button"
                    tabIndex={noStock ? -1 : 0}
                    onClick={() => !noStock && addToCart(product, defaultPres)}
                    onKeyDown={(e) => {
                      if (!noStock && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        addToCart(product, defaultPres);
                      }
                    }}
                    className={[
                      "group relative flex min-h-[96px] select-none flex-col rounded-sm border-2 p-3 text-left transition-all duration-150",
                      noStock
                        ? "cursor-not-allowed border-steel-800 bg-steel-900/20 opacity-50"
                        : isFlashing
                          ? "scale-[0.97] border-safety-500 bg-safety-500/10 cursor-pointer"
                          : totalInCart > 0
                            ? "cursor-pointer border-safety-500/40 bg-safety-500/5 hover:border-safety-500/70 hover:bg-safety-500/10"
                            : "cursor-pointer border-steel-700 bg-steel-900 hover:border-safety-500/50 hover:bg-steel-800 active:scale-[0.97]",
                    ].join(" ")}
                  >
                    {/* Cart badge */}
                    {totalInCart > 0 ? (
                      <span className="absolute right-2 top-2 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-safety-500 px-1 font-mono text-[10px] font-bold tabular-nums text-steel-950">
                        {totalInCart}
                      </span>
                    ) : null}

                    <div className="flex-1 space-y-0.5 pr-6">
                      <div className="line-clamp-2 text-[13px] font-semibold leading-tight text-foreground">
                        {product.name}
                      </div>
                      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/60">
                        <span>{product.sku}</span>
                        {product.is_kit ? (
                          <span className="rounded-sm border border-sky-600/50 bg-sky-700/15 px-1 py-px font-mono text-[8px] font-bold uppercase tracking-[0.06em] text-sky-400">
                            {product.product_kind === "bundle" ? "BUNDLE" : "KIT"}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-2 flex items-end justify-between gap-1">
                      <span
                        className={
                          "font-display text-[17px] leading-none tabular-nums " +
                          (noPrice ? "text-muted-foreground/50" : "text-safety-500")
                        }
                      >
                        {noPrice ? "—" : moneyFmt.format(defaultPres?.unit_price ?? product.price)}
                      </span>
                      {product.is_kit && product.kit_components.length === 0 ? (
                        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-amber-500/70">
                          Sin configurar
                        </span>
                      ) : (product.track_inventory || (isConfiguredKit && warehouseId != null)) ? (
                        <span
                          className={
                            "font-mono text-[10px] uppercase tracking-[0.08em] " +
                            (noStock
                              ? "font-bold text-red-400"
                              : product.stock <= 3 * (defaultPres?.base_qty ?? 1)
                                ? "text-safety-500/80"
                                : "text-muted-foreground/50")
                          }
                        >
                          {noStock
                            ? "Sin stock"
                            : `${stockForPresentation(product.stock, defaultPres?.base_qty ?? 1)} disp.`}
                        </span>
                      ) : null}
                    </div>

                    {/* Secondary action: pick a fraction. Valid here because the card
                        is a <div role="button">, not a <button>. stopPropagation
                        prevents triggering the card's own click (add default). */}
                    {hasFractions ? (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setPickingProduct(product); }}
                        onKeyDown={(e) => e.stopPropagation()}
                        className="mt-2 flex w-full items-center justify-center gap-1 rounded-sm border border-steel-600/40 bg-steel-800/30 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground/40 transition-colors hover:border-safety-500/40 hover:bg-safety-500/5 hover:text-safety-500/70"
                      >
                        <LayersIcon className="h-2.5 w-2.5" />
                        Fracción
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          {totalPages > 1 ? (
            <div className="flex items-center justify-between text-[12px] text-muted-foreground">
              <span>
                {safePage * PAGE_SIZE + 1}–
                {Math.min((safePage + 1) * PAGE_SIZE, filteredProducts.length)} de{" "}
                {filteredProducts.length}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="md" disabled={safePage === 0} onClick={() => setPage((p) => p - 1)}>‹</Button>
                <span className="font-mono text-[12px] tabular-nums">{safePage + 1}/{totalPages}</span>
                <Button variant="outline" size="md" disabled={safePage >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>›</Button>
              </div>
            </div>
          ) : null}
        </div>

        {/* ── CART (desktop sticky) ────────────────────────── */}
        <div className="hidden lg:block lg:w-[300px] lg:shrink-0 lg:sticky lg:top-4">
          <CartPanel
            cart={cart}
            totals={totals}
            customer={customer}
            permissions={permissions}
            hasStockIssue={hasStockIssue}
            hasBelowCostItems={hasBelowCostItems}
            canCheckout={canCheckout}
            onSetQty={setQty}
            onRemove={removeFromCart}
            onOverride={applyOverride}
            onClear={clearCart}
            onCheckout={() => openCheckout("normal")}
            onCourtesy={applyCourtesy}
            onGlobalDiscount={applyGlobalDiscount}
            onFiado={() => openCheckout("credit")}
            productNameById={productNameById}
          />
        </div>
      </div>

      {/* ── Mobile: floating cart button ──────────────────── */}
      {cart.length > 0 ? (
        <button
          type="button"
          onClick={() => setMobileCartOpen(true)}
          className="fixed bottom-5 right-5 z-30 flex items-center gap-2.5 rounded-full border-2 border-safety-500 bg-steel-900 px-4 py-2.5 shadow-safety-glow transition-transform active:scale-95 lg:hidden"
        >
          <CartIcon className="h-4 w-4 text-safety-500" />
          <span className="font-mono text-[12px] font-bold tabular-nums text-foreground">{totals.items}</span>
          <span className="font-display text-[15px] leading-none text-safety-500">
            {moneyFmt.format(Number(totals.gross))}
          </span>
        </button>
      ) : null}

      {/* ── Mobile: cart sheet ───────────────────────────── */}
      <Sheet
        open={mobileCartOpen}
        onClose={() => setMobileCartOpen(false)}
        side="right"
        title="Carrito"
        className="w-full max-w-sm"
      >
        <div className="overflow-y-auto">
          <CartPanel
            cart={cart}
            totals={totals}
            customer={customer}
            permissions={permissions}
            hasStockIssue={hasStockIssue}
            hasBelowCostItems={hasBelowCostItems}
            canCheckout={canCheckout}
            onSetQty={setQty}
            onRemove={removeFromCart}
            onOverride={applyOverride}
            onClear={clearCart}
            onCheckout={() => { setMobileCartOpen(false); setTimeout(() => openCheckout("normal"), 200); }}
            onCourtesy={applyCourtesy}
            onGlobalDiscount={applyGlobalDiscount}
            onFiado={() => { setMobileCartOpen(false); setTimeout(() => openCheckout("credit"), 200); }}
            productNameById={productNameById}
          />
        </div>
      </Sheet>

      {/* ── Checkout dialog ───────────────────────────────── */}
      {checkoutOpen ? (
        <CheckoutDialog
          open={checkoutOpen}
          onClose={() => setCheckoutOpen(false)}
          cashSessionId={activeCashSession?.id ?? null}
          initialMode={checkoutMode}
          cart={cart.map((l) => ({
            product_id:            l.product_id,
            name:                  l.name,
            unit_price:            l.unit_price,
            unit_label:            l.unit_label,
            quantity:              l.quantity,
            discount_amount:       l.discount_amount,
            presentation_id:       l.presentation_id,
            base_qty:              l.base_qty,
            override_unit_price:   l.override_unit_price   ?? undefined,
            price_override_type:   l.price_override_type   ?? undefined,
            price_override_reason: l.price_override_reason ?? undefined,
            price_override_note:   l.price_override_note   ?? undefined,
            // Cost data for below-cost detection in checkout
            average_cost: l.average_cost,
            has_tax:      l.has_tax,
            tax_rate:     l.tax_rate,
            // Kit: pass components so create_sale can decrement them atomically
            components: l.is_kit && l.kit_components.length > 0
              ? l.kit_components
              : undefined,
          }))}
          totals={{ gross: Number(totals.gross), net: Number(totals.net), iva: Number(totals.iva) }}
          customerId={customer?.id ?? ""}
          warehouseId={warehouseId}
          onSuccess={clearCart}
        />
      ) : null}

      <ManualItemModal
        open={manualItemOpen}
        onClose={() => setManualItemOpen(false)}
        onAdd={addManualToCart}
      />

      {/* Presentation picker — opens when clicking a product that has presentations */}
      {pickingProduct ? (
        <PresentationPickerDialog
          product={pickingProduct}
          warehouseId={warehouseId}
          cart={cart}
          onPick={(prod, pres) => addToCart(prod, pres)}
          onClose={() => setPickingProduct(null)}
        />
      ) : null}
    </div>
  );
}

// ── PresentationPickerDialog ───────────────────────────────────────────────
// Opens when the user taps a product card that has presentations configured.
// Lives OUTSIDE the product <button>, so there are no nested interactive elements.

const numFmtPres = new Intl.NumberFormat("es-EC", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 4,
});

function PresentationPickerDialog({
  product,
  warehouseId,
  cart,
  onPick,
  onClose,
}: {
  product:     PosProduct;
  warehouseId: string | null;
  cart:        CartLine[];
  onPick:      (product: PosProduct, pres: PosPresentation) => void;
  onClose:     () => void;
}) {
  return (
    <Dialog
      open
      onClose={onClose}
      title={product.name}
      description={`SKU ${product.sku} · Selecciona la presentación a vender`}
      className="max-w-[460px]"
    >
      <div className="space-y-2 px-6 pb-6 pt-4">
        {product.presentations.map((pres) => {
          const presStock   = stockForPresentation(product.stock, pres.base_qty);
          const presNoStock = warehouseId != null && product.track_inventory && presStock <= 0;
          const presPrice   = pres.unit_price ?? product.price;
          const inCart      = cart.find(
            (l) => l.product_id === product.id && l.presentation_id === pres.id
          );

          return (
            <button
              key={pres.id}
              type="button"
              disabled={presNoStock}
              onClick={() => { onPick(product, pres); onClose(); }}
              className={[
                "flex w-full items-center justify-between rounded-sm border-2 px-5 py-4 text-left transition-all active:scale-[0.99]",
                presNoStock
                  ? "cursor-not-allowed border-steel-800 opacity-40"
                  : inCart
                    ? "border-safety-500 bg-safety-500/8"
                    : "border-steel-700 bg-steel-800/40 hover:border-safety-500/60 hover:bg-safety-500/5",
              ].join(" ")}
            >
              {/* Left: label + equivalence */}
              <div className="min-w-0">
                <p className={[
                  "text-[17px] font-bold leading-tight",
                  inCart ? "text-safety-400" : "text-foreground",
                ].join(" ")}>
                  {pres.unit_label}
                  {pres.is_default ? (
                    <span className="ml-2 font-mono text-[9px] font-normal uppercase tracking-[0.1em] text-muted-foreground/40">
                      predeterminada
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/50">
                  = {numFmtPres.format(pres.base_qty)} {product.unit} del inventario
                </p>
                {inCart ? (
                  <p className="mt-0.5 font-mono text-[9.5px] text-safety-500/70">
                    {inCart.quantity} en carrito → toca para sumar 1 más
                  </p>
                ) : null}
              </div>

              {/* Right: stock + price */}
              <div className="flex shrink-0 items-center gap-5 pl-4">
                {product.track_inventory ? (
                  <div className="text-right">
                    <p className={[
                      "font-mono text-[15px] font-bold tabular-nums",
                      presNoStock   ? "text-red-400"
                      : presStock <= 3 ? "text-signal-400"
                      : "text-muted-foreground/60",
                    ].join(" ")}>
                      {presNoStock ? "0" : presStock}
                    </p>
                    <p className="font-mono text-[8.5px] text-muted-foreground/35">disp.</p>
                  </div>
                ) : null}
                <div className="text-right">
                  <p className={[
                    "font-display text-[22px] leading-none tabular-nums",
                    inCart ? "text-safety-400" : "text-safety-500",
                  ].join(" ")}>
                    {moneyFmt.format(presPrice)}
                  </p>
                  <p className="mt-0.5 font-mono text-[8.5px] text-muted-foreground/35">
                    precio sugerido
                  </p>
                </div>
              </div>
            </button>
          );
        })}

        <button
          type="button"
          onClick={onClose}
          className="mt-1 w-full rounded-sm border border-steel-700/60 py-2.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/50 transition-colors hover:border-steel-600 hover:text-muted-foreground/80"
        >
          Cancelar
        </button>
      </div>
    </Dialog>
  );
}

// ── CartPanel ──────────────────────────────────────────────────────────────

type QuickAction = null | "courtesy" | "discount";

function CartPanel({
  cart,
  totals,
  customer,
  permissions,
  hasStockIssue,
  hasBelowCostItems,
  canCheckout,
  onSetQty,
  onRemove,
  onOverride,
  onClear,
  onCheckout,
  onCourtesy,
  onGlobalDiscount,
  onFiado,
  productNameById,
}: {
  cart:               CartLine[];
  totals:             ReturnType<typeof calcTotals>;
  customer:           PickedCustomer | null;
  permissions:        PosPermissions;
  hasStockIssue:      boolean;
  hasBelowCostItems:  boolean;
  canCheckout:        boolean;
  onSetQty:         (key: string, qty: number) => void;
  onRemove:         (key: string) => void;
  onOverride:       (key: string, payload: OverridePayload | null) => void;
  onClear:          () => void;
  onCheckout:       () => void;
  onCourtesy:       (reason: string) => void;
  onGlobalDiscount: (pct: number) => void;
  onFiado:          () => void;
  productNameById:  Map<string, string>;
}) {
  const [editingKey, setEditingKey]     = React.useState<string | null>(null);
  const [quickAction, setQuickAction]   = React.useState<QuickAction>(null);
  const [courtesyReason, setCourtesyReason] = React.useState("");
  const [discountPctStr, setDiscountPctStr] = React.useState("");

  const overrideCount = cart.filter((l) => l.override_unit_price != null).length;

  function commitCourtesy() {
    if (!courtesyReason.trim()) return;
    onCourtesy(courtesyReason.trim());
    setQuickAction(null);
    setCourtesyReason("");
  }

  function commitDiscount() {
    const pct = parseFloat(discountPctStr.replace(",", "."));
    if (!isFinite(pct) || pct <= 0 || pct > 100) return;
    onGlobalDiscount(pct);
    setQuickAction(null);
    setDiscountPctStr("");
  }

  function cancelQuickAction() {
    setQuickAction(null);
    setCourtesyReason("");
    setDiscountPctStr("");
  }

  return (
    <div className="panel flex flex-col rounded-sm overflow-hidden">
      {/* Header */}
      <div className="top-highlight flex items-center justify-between border-b-2 border-steel-700 bg-steel-900/70 px-4 py-2.5">
        <h2 className="font-display text-[15px] tracking-[0.04em]">CARRITO</h2>
        <div className="flex items-center gap-2">
          {cart.length > 0 ? <Badge tone="warning">{totals.items}</Badge> : null}
          {overrideCount > 0 ? (
            <span className="rounded-sm border border-signal-600/40 bg-signal-700/10 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-signal-400">
              {overrideCount} ajuste{overrideCount > 1 ? "s" : ""}
            </span>
          ) : null}
          {cart.length > 0 ? (
            <button
              type="button"
              onClick={onClear}
              className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60 transition-colors hover:text-hazard-500"
            >
              Limpiar
            </button>
          ) : null}
        </div>
      </div>

      {/* Customer */}
      {customer ? (
        <div className="flex items-center gap-2 border-b border-steel-800/70 bg-steel-950/40 px-4 py-2">
          <UserIcon className="h-3 w-3 shrink-0 text-muted-foreground/60" />
          <span className="truncate font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground">
            {customer.full_name}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2 border-b border-steel-800/70 bg-hazard-700/10 px-4 py-2">
          <AlertIcon className="h-3 w-3 shrink-0 text-yellow-400" />
          <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-yellow-400">
            Selecciona un cliente
          </span>
        </div>
      )}

      {/* Lines */}
      <div className="flex-1 overflow-y-auto">
        {cart.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-5 py-10 text-center">
            <CartIcon className="h-7 w-7 text-muted-foreground/25" />
            <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground/50">
              Carrito vacío
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-steel-800/50">
            {cart.map((line) => {
              const gross      = Number(lineGross(line).round(2).toString());
              const stockWarn  = (line.track_inventory || (line.is_kit && line.kit_components.length > 0)) && line.quantity * line.base_qty > line.stock_base;
              const hasOverride = line.override_unit_price != null;
              const isEditing  = editingKey === line.key;
              const discountPct = hasOverride && line.unit_price > 0
                ? (100 * (1 - (line.override_unit_price as number) / line.unit_price))
                : 0;

              return (
                <li key={line.key} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[12.5px] font-semibold leading-tight text-foreground">
                          {line.name}
                        </span>
                        {line.product_id === null ? (
                          <span className="shrink-0 rounded-sm border border-sky-700/50 bg-sky-900/20 px-1 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.08em] text-sky-400/80">
                            Manual
                          </span>
                        ) : null}
                        {hasOverride ? (
                          line.price_override_type === "combo" ? (
                            <span className="shrink-0 rounded-sm border border-emerald-600/50 bg-emerald-700/15 px-1 py-0.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.08em] text-emerald-400">
                              COMBO
                            </span>
                          ) : line.price_override_type === "courtesy" ? (
                            <span className="shrink-0 rounded-sm border border-safety-500/40 bg-safety-500/10 px-1 py-0.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.08em] text-safety-500">
                              CORT.
                            </span>
                          ) : (
                            <span className="shrink-0 rounded-sm border border-signal-600/50 bg-signal-700/15 px-1 py-0.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.08em] text-signal-400">
                              −{discountPct.toFixed(0)}%
                            </span>
                          )
                        ) : null}
                      </div>

                      <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/70">
                        {hasOverride ? (
                          <>
                            <span className="line-through text-muted-foreground/40">
                              {moneyFmt.format(line.unit_price)}
                            </span>
                            <span className="text-signal-400 font-semibold">
                              {moneyFmt.format(line.override_unit_price as number)}
                            </span>
                          </>
                        ) : (
                          <span>{moneyFmt.format(line.unit_price)}</span>
                        )}
                        <span>/</span>
                        <span>{line.unit_label}</span>
                        {line.base_qty !== 1 ? (
                          <span className="text-muted-foreground/50">({line.base_qty} u.b.)</span>
                        ) : null}
                      </div>

                      {stockWarn ? (
                        <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-red-400">
                          Stock insuficiente
                        </div>
                      ) : null}
                    </div>
                    <span className="shrink-0 font-mono text-[13px] font-bold tabular-nums text-foreground">
                      {moneyFmt.format(gross)}
                    </span>
                  </div>

                  {/* Kit/bundle component sub-items — visual only, no fiscal impact */}
                  {line.is_kit && line.kit_components.length > 0 ? (
                    <ul className="mt-1 space-y-px border-l-2 border-sky-700/40 pl-2">
                      {[...line.kit_components]
                        .sort((a, b) => a.sort_order - b.sort_order)
                        .slice(0, 3)
                        .map((c) => {
                          const totalQty = c.quantity * c.base_qty;
                          const display  = totalQty % 1 === 0 ? String(totalQty) : totalQty.toFixed(2);
                          return (
                            <li key={c.product_id} className="flex items-center justify-between gap-1.5 min-w-0">
                              <span className="truncate font-mono text-[9px] leading-4 text-muted-foreground/55">
                                {productNameById.get(c.product_id) ?? "—"}
                              </span>
                              <span className="shrink-0 font-mono text-[9px] tabular-nums text-muted-foreground/40">
                                ×{display}
                              </span>
                            </li>
                          );
                        })}
                      {line.kit_components.length > 3 ? (
                        <li className="font-mono text-[9px] leading-4 text-muted-foreground/35">
                          +{line.kit_components.length - 3} componente{line.kit_components.length - 3 !== 1 ? "s" : ""}
                        </li>
                      ) : null}
                    </ul>
                  ) : null}

                  {/* Qty controls + override toggle + remove */}
                  <div className="mt-2 flex items-center gap-1.5">
                    <div className="flex overflow-hidden rounded-sm border border-steel-700">
                      <button
                        type="button"
                        onClick={() => onSetQty(line.key, line.quantity - 1)}
                        className="h-7 w-7 grid place-items-center font-bold text-muted-foreground transition-colors hover:bg-steel-800 hover:text-foreground"
                        aria-label="Disminuir"
                      >
                        −
                      </button>
                      <span className="w-8 border-x border-steel-700/70 text-center font-mono text-[12px] font-bold tabular-nums text-foreground py-1">
                        {line.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => onSetQty(line.key, line.quantity + 1)}
                        className="h-7 w-7 grid place-items-center font-bold text-muted-foreground transition-colors hover:bg-steel-800 hover:text-foreground"
                        aria-label="Aumentar"
                      >
                        +
                      </button>
                    </div>

                    <div className="flex-1" />

                    {permissions.canEditLinePrice ? (
                      hasOverride ? (
                        <button
                          type="button"
                          onClick={() => setEditingKey(isEditing ? null : line.key)}
                          title="Editar ajuste de precio"
                          className={[
                            "flex h-7 items-center gap-1 rounded-sm border px-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.08em] transition-colors",
                            isEditing
                              ? "border-signal-500 bg-signal-700/20 text-signal-400"
                              : "border-signal-600/40 bg-signal-700/10 text-signal-400 hover:border-signal-500/60",
                          ].join(" ")}
                        >
                          <PencilIcon className="h-2.5 w-2.5" />
                          Ajustado
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditingKey(isEditing ? null : line.key)}
                          title="Ajustar precio"
                          className={[
                            "flex h-7 w-7 items-center justify-center rounded-sm border transition-colors",
                            isEditing
                              ? "border-safety-500/60 bg-safety-500/10 text-safety-500"
                              : "border-steel-700 text-muted-foreground/50 hover:border-steel-600 hover:text-foreground",
                          ].join(" ")}
                        >
                          <PencilIcon className="h-3 w-3" />
                        </button>
                      )
                    ) : null}

                    <button
                      type="button"
                      onClick={() => onRemove(line.key)}
                      className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground/50 transition-colors hover:text-hazard-500"
                      aria-label="Quitar"
                    >
                      <XSmallIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Override editor */}
                  {isEditing ? (
                    <OverrideEditor
                      line={line}
                      onSave={(payload) => {
                        onOverride(line.key, payload);
                        setEditingKey(null);
                      }}
                      onClear={() => {
                        onOverride(line.key, null);
                        setEditingKey(null);
                      }}
                      onCancel={() => setEditingKey(null)}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Totals + Quick actions + Cobrar */}
      {cart.length > 0 ? (
        <div className="space-y-2 border-t-2 border-steel-700 bg-steel-950/60 px-4 py-3">
          <div className="flex justify-between text-[11.5px]">
            <span className="font-mono uppercase tracking-[0.1em] text-muted-foreground/70">Subtotal</span>
            <span className="font-mono tabular-nums text-muted-foreground">{moneyFmt.format(Number(totals.net))}</span>
          </div>
          <div className="flex justify-between text-[11.5px]">
            <span className="font-mono uppercase tracking-[0.1em] text-muted-foreground/70">IVA 15%</span>
            <span className="font-mono tabular-nums text-muted-foreground">{moneyFmt.format(Number(totals.iva))}</span>
          </div>
          <div className="flex items-baseline justify-between border-t border-steel-800/60 pt-2">
            <span className="font-mono text-[12px] font-bold uppercase tracking-[0.12em] text-foreground">Total</span>
            <span className="font-display text-[24px] leading-none tracking-[0.02em] text-safety-500">
              {moneyFmt.format(Number(totals.gross))}
            </span>
          </div>

          {/* ── Quick actions ──────────────────────────────── */}
          <div className="space-y-2 rounded-sm border border-steel-700/60 bg-steel-900/40 p-2">
            {/* Pills row */}
            <div className="grid grid-cols-3 gap-1.5">
              <QuickActionPill
                label="Cortesía"
                active={quickAction === "courtesy"}
                onClick={() => setQuickAction(quickAction === "courtesy" ? null : "courtesy")}
              />
              <QuickActionPill
                label="Dto. %"
                active={quickAction === "discount"}
                onClick={() => setQuickAction(quickAction === "discount" ? null : "discount")}
              />
              <QuickActionPill
                label="Fiado ▶"
                active={false}
                onClick={() => { cancelQuickAction(); onFiado(); }}
              />
            </div>

            {/* Courtesy inline form */}
            {quickAction === "courtesy" ? (
              <div className="space-y-1.5">
                <input
                  type="text"
                  value={courtesyReason}
                  onChange={(e) => setCourtesyReason(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") commitCourtesy(); if (e.key === "Escape") cancelQuickAction(); }}
                  placeholder="Motivo de la cortesía *"
                  maxLength={200}
                  autoFocus
                  className="h-8 w-full rounded-sm border border-steel-700 bg-steel-900 px-2.5 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/40 focus:border-safety-500 focus:outline-none"
                />
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    disabled={!courtesyReason.trim()}
                    onClick={commitCourtesy}
                    className="flex-1 h-7 rounded-sm border border-safety-500 bg-safety-500/10 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-safety-500 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-safety-500/20"
                  >
                    Aplicar a todos
                  </button>
                  <button type="button" onClick={cancelQuickAction}
                    className="h-7 w-7 grid place-items-center rounded-sm border border-steel-700 text-muted-foreground hover:text-foreground">
                    <XSmallIcon className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ) : null}

            {/* Global discount inline form */}
            {quickAction === "discount" ? (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <div className="relative flex-1">
                    <input
                      type="number"
                      min={1} max={100} step="0.5"
                      value={discountPctStr}
                      onChange={(e) => setDiscountPctStr(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") commitDiscount(); if (e.key === "Escape") cancelQuickAction(); }}
                      placeholder="10"
                      autoFocus
                      onFocus={(e) => e.target.select()}
                      className="h-8 w-full rounded-sm border border-steel-700 bg-steel-900 pr-6 pl-2.5 font-mono text-[13px] tabular-nums text-foreground focus:border-safety-500 focus:outline-none"
                    />
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[11px] font-bold text-muted-foreground">%</span>
                  </div>
                  {discountPctStr && isFinite(parseFloat(discountPctStr)) ? (
                    <span className="shrink-0 font-mono text-[10px] text-signal-400">
                      → {moneyFmt.format(Number(Big(totals.gross).times(Big(parseFloat(discountPctStr)).div(100)).round(2).toString()))} dto.
                    </span>
                  ) : null}
                </div>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    disabled={!discountPctStr || !isFinite(parseFloat(discountPctStr)) || parseFloat(discountPctStr) <= 0 || parseFloat(discountPctStr) > 100}
                    onClick={commitDiscount}
                    className="flex-1 h-7 rounded-sm border border-safety-500 bg-safety-500/10 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-safety-500 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-safety-500/20"
                  >
                    Aplicar a todos
                  </button>
                  <button type="button" onClick={cancelQuickAction}
                    className="h-7 w-7 grid place-items-center rounded-sm border border-steel-700 text-muted-foreground hover:text-foreground">
                    <XSmallIcon className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {hasStockIssue ? (
            <p className="rounded-sm border border-hazard-500/40 bg-hazard-700/10 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-red-400">
              Stock insuficiente en un ítem
            </p>
          ) : null}

          {hasBelowCostItems ? (
            <p className="rounded-sm border border-signal-600/40 bg-signal-700/10 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-signal-400">
              ⚠ Precio por debajo del costo estimado
            </p>
          ) : null}

          <Button
            onClick={onCheckout}
            disabled={!canCheckout}
            size="md"
            className="h-11 w-full font-bold"
            title="F8"
          >
            <CashIcon className="mr-1.5 h-4 w-4" />
            Cobrar {moneyFmt.format(Number(totals.gross))}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ── OverrideEditor ─────────────────────────────────────────────────────────

function OverrideEditor({
  line,
  onSave,
  onClear,
  onCancel,
}: {
  line:     CartLine;
  onSave:   (payload: OverridePayload) => void;
  onClear:  () => void;
  onCancel: () => void;
}) {
  const effective = line.override_unit_price ?? line.unit_price;
  const [inputMode, setInputMode] = React.useState<"price" | "pct">("price");
  const [priceStr, setPriceStr] = React.useState(effective.toFixed(2));
  const [pctStr, setPctStr]     = React.useState(
    line.override_unit_price != null && line.unit_price > 0
      ? (100 * (1 - line.override_unit_price / line.unit_price)).toFixed(1)
      : ""
  );
  const [type, setType]         = React.useState<string>(line.price_override_type ?? "price_set");
  const [reason, setReason]     = React.useState<string>(
    line.price_override_reason ??
    PRICE_OVERRIDE_LABELS[(line.price_override_type ?? "price_set") as PriceOverrideType] ??
    ""
  );
  const [note, setNote] = React.useState<string>(line.price_override_note ?? "");

  const priceNum    = parseFloat(priceStr.replace(",", "."));
  const pctNum      = parseFloat(pctStr.replace(",", "."));
  const pctValid    = isFinite(pctNum) && pctNum >= 0 && pctNum <= 100;
  const priceValid  = isFinite(priceNum) && priceNum >= 0;

  // Computed price when in % mode
  const effectivePriceNum = inputMode === "pct" && pctValid
    ? Math.max(0, Number(Big(line.unit_price).times(Big(100 - pctNum).div(100)).round(2, Big.roundHalfUp).toString()))
    : priceNum;
  const effectivePriceValid = inputMode === "pct" ? pctValid : priceValid;
  const canSave = effectivePriceValid && reason.trim().length > 0;

  const discountPct =
    effectivePriceValid && line.unit_price > 0 && effectivePriceNum < line.unit_price
      ? (100 * (1 - effectivePriceNum / line.unit_price))
      : null;

  const handleTypeChange = (val: string) => {
    setType(val);
    const label = PRICE_OVERRIDE_LABELS[val as PriceOverrideType] ?? "";
    if (!reason.trim() || OVERRIDE_OPTIONS.some((o) => o.label === reason)) {
      setReason(label);
    }
  };

  return (
    <div className="mt-2.5 space-y-2 rounded-sm border border-steel-700/80 bg-steel-950/70 p-2.5">
      {/* Mode toggle: Precio / % */}
      <div className="flex overflow-hidden rounded-sm border border-steel-700">
        {(["price", "pct"] as const).map((m) => (
          <button
            key={m} type="button"
            onClick={() => setInputMode(m)}
            className={[
              "flex-1 py-1 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] transition-colors",
              inputMode === m ? "bg-steel-700 text-foreground" : "text-muted-foreground/60 hover:text-muted-foreground",
            ].join(" ")}
          >
            {m === "price" ? "Precio $" : "Descuento %"}
          </button>
        ))}
      </div>

      {/* Price input */}
      <div className="space-y-0.5">
        <label className="block font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground/60">
          {inputMode === "price" ? "Precio ajustado (USD)" : "Descuento (%)"}
        </label>
        {inputMode === "pct" ? (
          <>
            <div className="relative">
              <input
                type="number" min={0} max={100} step="any"
                value={pctStr}
                onChange={(e) => setPctStr(e.target.value)}
                onFocus={(e) => e.target.select()}
                autoFocus
                className="h-8 w-full rounded-sm border border-steel-700 bg-steel-900 pr-8 pl-2.5 text-right font-mono text-[13px] tabular-nums text-foreground focus:border-safety-500 focus:outline-none"
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-[11px] font-bold text-muted-foreground/60">%</span>
            </div>
            {pctValid && line.unit_price > 0 ? (
              <p className="font-mono text-[10px] text-signal-400">
                Precio resultante: {moneyFmt.format(effectivePriceNum)} (−{pctNum.toFixed(1)}%)
              </p>
            ) : null}
          </>
        ) : (
          <>
            <div className="relative">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-[10px] font-bold text-muted-foreground/60">$</span>
              <input
                type="number" min={0} step="any"
                value={priceStr}
                onChange={(e) => setPriceStr(e.target.value)}
                onFocus={(e) => e.target.select()}
                autoFocus
                className="h-8 w-full rounded-sm border border-steel-700 bg-steel-900 pl-6 pr-2 text-right font-mono text-[13px] tabular-nums text-foreground focus:border-safety-500 focus:outline-none"
              />
            </div>
            {discountPct !== null ? (
              <p className="font-mono text-[10px] text-signal-400">
                −{discountPct.toFixed(1)}% del precio de lista
              </p>
            ) : null}
          </>
        )}
      </div>

      {/* Type select */}
      <div className="space-y-0.5">
        <label className="block font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground/60">
          Categoría
        </label>
        <select
          value={type}
          onChange={(e) => handleTypeChange(e.target.value)}
          className="h-8 w-full rounded-sm border border-steel-700 bg-steel-900 px-2 font-mono text-[11px] text-foreground focus:border-safety-500 focus:outline-none"
        >
          {OVERRIDE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Reason */}
      <div className="space-y-0.5">
        <label className="block font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground/60">
          Motivo <span className="text-red-400">*</span>
        </label>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={200}
          placeholder="Descripción del ajuste..."
          className="h-8 w-full rounded-sm border border-steel-700 bg-steel-900 px-2.5 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/40 focus:border-safety-500 focus:outline-none"
        />
      </div>

      {/* Note (optional) */}
      <div className="space-y-0.5">
        <label className="block font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground/60">
          Nota interna <span className="text-muted-foreground/40">(opcional)</span>
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          rows={2}
          placeholder="Para registros internos..."
          className="w-full resize-none rounded-sm border border-steel-700 bg-steel-900 px-2.5 py-1.5 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/40 focus:border-safety-500 focus:outline-none"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() =>
            canSave &&
            onSave({
              override_unit_price:   effectivePriceNum,
              price_override_type:   type || null,
              price_override_reason: reason.trim(),
              price_override_note:   note.trim() || null,
            })
          }
          disabled={!canSave}
          className="flex-1 h-7 rounded-sm border border-safety-500 bg-safety-500/10 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-safety-500 transition-colors hover:bg-safety-500/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Guardar
        </button>
        {line.override_unit_price != null ? (
          <button
            type="button"
            onClick={onClear}
            className="flex-1 h-7 rounded-sm border border-hazard-500/40 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground transition-colors hover:border-hazard-500/60 hover:text-hazard-500"
          >
            Quitar
          </button>
        ) : null}
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 h-7 rounded-sm border border-steel-700 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground transition-colors hover:border-steel-600 hover:text-foreground"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────

function LayersIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function XSmallIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 6 6 18" /><path d="M6 6l12 12" />
    </svg>
  );
}

function CartIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  );
}

function BoxIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <path d="M3.27 6.96 12 12.01l8.73-5.05" /><path d="M12 22.08V12" />
    </svg>
  );
}

function UserIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
    </svg>
  );
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function CashIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  );
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

function CashRegisterIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 7l1-4h14l1 4" />
      <rect x="2" y="7" width="20" height="13" rx="1" />
      <path d="M16 12h.01M12 12h.01M8 12h.01M16 16h.01M12 16h.01M8 16h.01" />
      <path d="M6 7v13" />
    </svg>
  );
}

function QuickActionPill({
  label,
  active,
  onClick,
}: {
  label:   string;
  active:  boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-sm border py-1 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] transition-all",
        active
          ? "border-safety-500/60 bg-safety-500/10 text-safety-500"
          : "border-steel-700 text-muted-foreground/70 hover:border-steel-600 hover:text-foreground",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function ManualItemModal({
  open,
  onClose,
  onAdd,
}: {
  open:    boolean;
  onClose: () => void;
  onAdd:   (item: { name: string; unit_price: number; quantity: number; has_tax: boolean; average_cost: number }) => void;
}) {
  const [name, setName]               = React.useState("");
  const [priceStr, setPriceStr]       = React.useState("");
  const [qtyStr, setQtyStr]           = React.useState("1");
  const [costStr, setCostStr]         = React.useState("");
  const [hasTax, setHasTax]           = React.useState(true);

  React.useEffect(() => {
    if (open) {
      setName("");
      setPriceStr("");
      setQtyStr("1");
      setCostStr("");
      setHasTax(true);
    }
  }, [open]);

  const price = parseFloat(priceStr.replace(",", "."));
  const qty   = parseFloat(qtyStr.replace(",", "."));
  const cost  = costStr.trim() ? parseFloat(costStr.replace(",", ".")) : 0;
  
  const isValid = name.trim().length > 0 && isFinite(price) && price >= 0 && isFinite(qty) && qty > 0 && isFinite(cost) && cost >= 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    onAdd({
      name:         name.trim(),
      unit_price:   price,
      quantity:     qty,
      has_tax:      hasTax,
      average_cost: cost,
    });
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} side="right" title="Agregar Ítem Manual" className="w-full max-w-sm">
      <div className="p-5">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="space-y-1">
            <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/80">Descripción *</label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Filtro de aire especial..."
              className="font-sans text-sm"
              required
            />
          </div>

          <div className="flex gap-3">
            <div className="space-y-1 flex-1">
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/80">Cantidad *</label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={qtyStr}
                onChange={(e) => setQtyStr(e.target.value)}
                className="font-mono text-sm"
                required
              />
            </div>
            <div className="space-y-1 flex-1">
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/80">PVP (con IVA) *</label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={priceStr}
                onChange={(e) => setPriceStr(e.target.value)}
                placeholder="0.00"
                className="font-mono text-sm"
                required
              />
            </div>
          </div>

          <div className="flex gap-3 items-end">
            <div className="space-y-1 flex-1">
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/80">Costo (Rentabilidad)</label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={costStr}
                onChange={(e) => setCostStr(e.target.value)}
                placeholder="0.00 (Opcional)"
                className="font-mono text-sm text-amber-500/80 focus:text-amber-500"
              />
            </div>
            <div className="mb-2 flex items-center gap-2 flex-1 justify-center">
              <input
                type="checkbox"
                id="manual-tax"
                checked={hasTax}
                onChange={(e) => setHasTax(e.target.checked)}
                className="h-4 w-4 rounded border-steel-700 bg-steel-900 text-safety-500 focus:ring-safety-500 focus:ring-offset-steel-950"
              />
              <label htmlFor="manual-tax" className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground cursor-pointer select-none">
                Grava IVA (15%)
              </label>
            </div>
          </div>

          <div className="mt-2 flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancelar
            </Button>
            <Button type="submit" disabled={!isValid} className="flex-1 bg-safety-500 text-steel-950 hover:bg-safety-400">
              Añadir
            </Button>
          </div>
        </form>
      </div>
    </Sheet>
  );
}
