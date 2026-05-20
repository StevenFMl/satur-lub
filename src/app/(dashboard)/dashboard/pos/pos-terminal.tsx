"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { CustomerPicker, type PickedCustomer } from "@/components/dashboard/customer-picker";
import type { PosPermissions } from "@/lib/auth/permissions";
import { CheckoutDialog } from "./checkout-dialog";
import { ExchangeBanner } from "./exchange-banner";
import { PresentationPickerDialog } from "./presentation-picker-dialog";
import { ManualItemModal } from "./manual-item-modal";
import { CartLineItem } from "./cart-line-item";
import { usePosKeyboard } from "./hooks/use-pos-keyboard";
import { useBarcodeScannerInput } from "./hooks/use-barcode-scanner-input";
import {
  calcTotals,
  resolvePresentation,
  stockForPresentation,
  applyPctDiscount,
  isBelowCost,
  type CartLine,
  type OverridePayload,
  type PosProduct,
  type PosPresentation,
  type PosBundleComponent,
} from "@/lib/domain/pos-math";
import { usePosStore } from "@/lib/stores/pos-store";
import { useShallow } from "zustand/react/shallow";
import { holdCart, getHeldCarts } from "@/actions/holds";
import { HoldsPanel } from "./holds-panel";

// ── Local types (UI-only, not domain math) ─────────────────────────────────

export type { PosProduct, PosPresentation, PosBundleComponent };

export type PosWarehouse = { id: string; name: string };

export type ActiveCashSession = {
  id:             string;
  opening_amount: number;
  opened_at:      string;
};

// ── Constants ──────────────────────────────────────────────────────────────

const PAGE_SIZE = 24;

const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});


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
  exchangeReturnId,
  exchangeCredit,
}: {
  products:          PosProduct[];
  warehouses:        PosWarehouse[];
  defaultCustomer:   PickedCustomer | null;
  permissions:       PosPermissions;
  userName:          string;
  activeCashSession: ActiveCashSession | null;
  exchangeReturnId?: string | null;
  exchangeCredit?:   number;
}) {
  // ── Persistent store (cart + customer survive same-tab navigation) ────────
  const cart     = usePosStore((s) => s.cart);
  const customer = usePosStore((s) => s.customer);
  const {
    addToCart:           storeAddLine,
    removeFromCart:      storeRemoveLine,
    setQty:              storeSetQty,
    applyOverride:       storeApplyOverride,
    applyCourtesy:       storeApplyCourtesy,
    applyGlobalDiscount: storeApplyDiscount,
    clearCart:           storeClearCart,
    replaceCart:         storeReplaceCart,
    setCustomer:         storeSetCustomer,
  } = usePosStore(
    useShallow((s) => ({
      addToCart:           s.addToCart,
      removeFromCart:      s.removeFromCart,
      setQty:              s.setQty,
      applyOverride:       s.applyOverride,
      applyCourtesy:       s.applyCourtesy,
      applyGlobalDiscount: s.applyGlobalDiscount,
      clearCart:           s.clearCart,
      replaceCart:         s.replaceCart,
      setCustomer:         s.setCustomer,
    }))
  );

  const [warehouseId, setWarehouseId] = React.useState<string | null>(
    warehouses.length === 1 ? (warehouses[0]?.id ?? null) : null
  );

  // Rehydrate from sessionStorage once on mount; seed defaultCustomer if nothing stored
  React.useEffect(() => {
    void usePosStore.persist.rehydrate();
    if (!usePosStore.getState().customer && defaultCustomer) {
      usePosStore.getState().setCustomer(defaultCustomer);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    storeAddLine({
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
      override_unit_price:   null,
      price_override_type:   null,
      price_override_reason: null,
      price_override_note:   null,
      is_kit:          false,
      kit_components:  [],
    });
  }, [storeAddLine]);

  const addToCart = React.useCallback((product: PosProduct, pres: PosPresentation | null = null) => {
    const resolved = resolvePresentation(product, pres);
    const lineKey  = `${product.id}::${resolved.presentation_id ?? "base"}`;

    // Build the full CartLine; store handles add-or-increment dedup by key.
    storeAddLine({
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
    });

    setFlashKeys((prev) => { const n = new Set(prev); n.add(lineKey); return n; });
    setTimeout(() => setFlashKeys((prev) => { const n = new Set(prev); n.delete(lineKey); return n; }), 600);
  }, [storeAddLine]);

  // clearCart resets both cart and customer to a clean state after sale.
  const clearCart = () => {
    storeClearCart();
    storeSetCustomer(defaultCustomer);
  };

  // ── Holds (aparcados) ────────────────────────────────────────────────────
  const [holdsOpen, setHoldsOpen]     = React.useState(false);
  const [holdsCount, setHoldsCount]   = React.useState(0);
  const [parkLoading, setParkLoading] = React.useState(false);
  const [parkError, setParkError]     = React.useState<string | null>(null);

  // Fetch hold count on mount so the badge is visible immediately
  React.useEffect(() => {
    getHeldCarts().then((holds) => setHoldsCount(holds.length));
  }, []);

  const handlePark = React.useCallback(async (note: string) => {
    setParkLoading(true);
    setParkError(null);
    const err = await holdCart({
      cart:        usePosStore.getState().cart,
      customer:    usePosStore.getState().customer,
      userName,
      grossAmount: Number(calcTotals(usePosStore.getState().cart).gross),
      note:        note || null,
    });
    setParkLoading(false);
    if (err) {
      setParkError(err);
      return;
    }
    setHoldsCount((n) => n + 1);
    clearCart();
  }, [userName]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleResumed = React.useCallback(
    (resumedCart: import("@/lib/domain/pos-math").CartLine[], resumedCustomer: import("@/actions/customers").PickedCustomer | null) => {
      storeReplaceCart(resumedCart, resumedCustomer);
      setHoldsCount((n) => Math.max(0, n - 1));
    },
    [storeReplaceCart]
  );

  // Stable callback for the presentation picker — passed to memoized ProductCard.
  const handlePickFraction = React.useCallback(
    (product: PosProduct) => setPickingProduct(product),
    []
  );

  // Precompute per-product cart quantities once, avoiding an O(products × cart)
  // scan inside the render loop.  Re-runs only when cart changes.
  const cartSummaryByProductId = React.useMemo(() => {
    const m = new Map<string, { totalInCart: number; baseInCart: number }>();
    for (const line of cart) {
      if (!line.product_id) continue;
      const prev = m.get(line.product_id) ?? { totalInCart: 0, baseInCart: 0 };
      m.set(line.product_id, {
        totalInCart: prev.totalInCart + line.quantity,
        baseInCart:  prev.baseInCart  + line.quantity * line.base_qty,
      });
    }
    return m;
  }, [cart]);

  // Precompute which product IDs have a flash animation in progress.
  const flashProductIds = React.useMemo(() => {
    const ids = new Set<string>();
    for (const line of cart) {
      if (line.product_id && flashKeys.has(line.key)) ids.add(line.product_id);
    }
    return ids;
  }, [cart, flashKeys]);

  // ── Totals (computed before hooks so canCheckout is available) ─────────────
  const totals = React.useMemo(() => calcTotals(cart), [cart]);

  const hasStockIssue = React.useMemo(() =>
    warehouseId != null &&
    cart.some((l) => (l.track_inventory || (l.is_kit && l.kit_components.length > 0)) && l.quantity * l.base_qty > l.stock_base),
    [cart, warehouseId]
  );

  const hasBelowCostItems = React.useMemo(() => cart.some(isBelowCost), [cart]);

  const canCheckout = cart.length > 0 && customer != null && !hasStockIssue;

  // ── Keyboard shortcuts ───────────────────────────────────
  usePosKeyboard({
    searchInputRef,
    canCheckout,
    checkoutOpen,
    onOpenCheckout: React.useCallback(() => {
      setCheckoutMode("normal");
      setCheckoutOpen(true);
    }, []),
    onDeleteLast: React.useCallback(() => {
      const { cart: cartNow, removeFromCart } = usePosStore.getState();
      const last = cartNow[cartNow.length - 1];
      if (last) removeFromCart(last.key);
    }, []),
  });

  // ── Barcode scanner ──────────────────────────────────────
  // Fires when the scanner is used while no input element has focus.
  // When the search input IS focused, the input's own onKeyDown handles it.
  useBarcodeScannerInput({
    isActive: !mobileCartOpen && !checkoutOpen && !manualItemOpen && !pickingProduct,
    onScan: React.useCallback((code: string) => {
      const product = products.find((p) => p.sku === code);
      if (!product) return;
      addToCart(product, product.presentations.find((p) => p.is_default) ?? null);
    }, [products, addToCart]),
  });

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
          <CustomerPicker selected={customer} onSelect={storeSetCustomer} />
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

        {holdsCount > 0 ? (
          <button
            type="button"
            onClick={() => setHoldsOpen(true)}
            className="hidden shrink-0 items-center gap-1.5 rounded-sm border border-signal-600/40 bg-signal-700/10 px-2.5 py-1.5 transition-colors hover:bg-signal-700/20 sm:flex"
            title="Ver ventas aparcadas"
          >
            <PauseCircleIcon className="h-3.5 w-3.5 text-signal-400" />
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-signal-400">
              Aparcados ({holdsCount})
            </span>
          </button>
        ) : null}

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

      {/* ── Exchange banner ───────────────────────────────── */}
      {exchangeReturnId && exchangeCredit && exchangeCredit > 0 ? (
        <ExchangeBanner credit={exchangeCredit} />
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
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  // Read the live DOM value — React state may lag behind a fast
                  // scanner that fills the input before React processes events.
                  const q = (e.currentTarget as HTMLInputElement).value.trim();
                  if (!q) return;

                  // Priority 1: exact case-insensitive SKU match
                  const bySku = products.find(
                    (p) => p.sku.toLowerCase() === q.toLowerCase()
                  );
                  if (bySku) {
                    e.preventDefault();
                    addToCart(bySku, bySku.presentations.find((p) => p.is_default) ?? null);
                    setSearchQuery("");
                    return;
                  }

                  // Priority 2: single unambiguous text result
                  const ql   = q.toLowerCase();
                  const hits = products.filter(
                    (p) => p.name.toLowerCase().includes(ql) || p.sku.toLowerCase().includes(ql)
                  );
                  if (hits.length === 1) {
                    e.preventDefault();
                    addToCart(hits[0]!, hits[0]!.presentations.find((p) => p.is_default) ?? null);
                    setSearchQuery("");
                  }
                }}
                placeholder="Buscar producto (F4) · Enter para añadir..."
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
                const summary = cartSummaryByProductId.get(product.id) ?? { totalInCart: 0, baseInCart: 0 };
                return (
                  <ProductCard
                    key={product.id}
                    product={product}
                    warehouseId={warehouseId}
                    totalInCart={summary.totalInCart}
                    baseInCart={summary.baseInCart}
                    isFlashing={flashProductIds.has(product.id)}
                    onAdd={addToCart}
                    onPickFraction={handlePickFraction}
                  />
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
            onSetQty={storeSetQty}
            onRemove={storeRemoveLine}
            onOverride={storeApplyOverride}
            onClear={clearCart}
            onCheckout={() => openCheckout("normal")}
            onCourtesy={storeApplyCourtesy}
            onGlobalDiscount={storeApplyDiscount}
            onFiado={() => openCheckout("credit")}
            onPark={handlePark}
            parkLoading={parkLoading}
            parkError={parkError}
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
            onSetQty={storeSetQty}
            onRemove={storeRemoveLine}
            onOverride={storeApplyOverride}
            onClear={clearCart}
            onCheckout={() => { setMobileCartOpen(false); setTimeout(() => openCheckout("normal"), 200); }}
            onCourtesy={storeApplyCourtesy}
            onGlobalDiscount={storeApplyDiscount}
            onFiado={() => { setMobileCartOpen(false); setTimeout(() => openCheckout("credit"), 200); }}
            onPark={handlePark}
            parkLoading={parkLoading}
            parkError={parkError}
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
          exchangeReturnId={exchangeReturnId ?? undefined}
          exchangeCredit={exchangeCredit}
          onSuccess={clearCart}
        />
      ) : null}

      <ManualItemModal
        open={manualItemOpen}
        onClose={() => setManualItemOpen(false)}
        onAdd={addManualToCart}
      />

      <HoldsPanel
        open={holdsOpen}
        currentCartHasItems={cart.length > 0}
        onClose={() => setHoldsOpen(false)}
        onResumed={handleResumed}
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

// ── ProductCard ────────────────────────────────────────────────────────────
// Memoized so only the card(s) whose cart-dependent props actually changed
// re-render when the cart updates.  Default comparison is sufficient because:
//   product        — stable server-prop reference
//   totalInCart/baseInCart/isFlashing — primitives, change only for the
//                                       affected product
//   onAdd/onPickFraction — stable useCallback refs

const ProductCard = React.memo(function ProductCard({
  product,
  warehouseId,
  totalInCart,
  baseInCart,
  isFlashing,
  onAdd,
  onPickFraction,
}: {
  product:        PosProduct;
  warehouseId:    string | null;
  totalInCart:    number;
  baseInCart:     number;
  isFlashing:     boolean;
  onAdd:          (product: PosProduct, pres: PosPresentation | null) => void;
  onPickFraction: (product: PosProduct) => void;
}) {
  const defaultPres     = product.presentations.find((p) => p.is_default) ?? null;
  const isConfiguredKit = product.is_kit && product.kit_components.length > 0;
  const noStock         = warehouseId != null && (product.track_inventory || isConfiguredKit) && product.stock - baseInCart <= 0;
  const noPrice         = product.price === 0 && !product.presentations.some((p) => p.unit_price);
  // Card is a <div role="button"> (not <button>) so we can nest the
  // secondary "Fracción" <button> inside it — valid HTML, no hydration error.
  const hasFractions    = product.presentations.length >= 1;

  return (
    <div
      role="button"
      tabIndex={noStock ? -1 : 0}
      onClick={() => !noStock && onAdd(product, defaultPres)}
      onKeyDown={(e) => {
        if (!noStock && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onAdd(product, defaultPres);
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

      {hasFractions ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onPickFraction(product); }}
          onKeyDown={(e) => e.stopPropagation()}
          className="mt-2 flex w-full items-center justify-center gap-1 rounded-sm border border-steel-600/40 bg-steel-800/30 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground/40 transition-colors hover:border-safety-500/40 hover:bg-safety-500/5 hover:text-safety-500/70"
        >
          <LayersIcon className="h-2.5 w-2.5" />
          Fracción
        </button>
      ) : null}
    </div>
  );
});

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
  onPark,
  parkLoading,
  parkError,
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
  /** Called with the optional note when the cashier confirms the park. */
  onPark:           (note: string) => void;
  parkLoading:      boolean;
  parkError:        string | null;
  productNameById:  Map<string, string>;
}) {
  const [editingKey, setEditingKey]     = React.useState<string | null>(null);
  const [quickAction, setQuickAction]   = React.useState<QuickAction | "park">(null);
  const [courtesyReason, setCourtesyReason] = React.useState("");
  const [discountPctStr, setDiscountPctStr] = React.useState("");
  const [parkNoteLocal, setParkNoteLocal]   = React.useState("");

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
    setParkNoteLocal("");
  }

  function commitPark() {
    onPark(parkNoteLocal.trim());
    // don't reset yet — parent clears cart; if error, user can retry
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
            {cart.map((line) => (
              <CartLineItem
                key={line.key}
                line={line}
                isEditing={editingKey === line.key}
                permissions={permissions}
                productNameById={productNameById}
                onSetQty={onSetQty}
                onRemove={onRemove}
                onOverride={onOverride}
                onEditToggle={setEditingKey}
              />
            ))}
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
            <div className="grid grid-cols-4 gap-1.5">
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
                label="Aparcar"
                active={quickAction === "park"}
                onClick={() => setQuickAction(quickAction === "park" ? null : "park")}
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
                      → {moneyFmt.format(Number(totals.gross.times(parseFloat(discountPctStr)).div(100).round(2).toString()))} dto.
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

            {/* Aparcar inline form */}
            {quickAction === "park" ? (
              <div className="space-y-1.5">
                <input
                  type="text"
                  value={parkNoteLocal}
                  onChange={(e) => setParkNoteLocal(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") commitPark(); if (e.key === "Escape") cancelQuickAction(); }}
                  placeholder="Nota (opcional)"
                  maxLength={200}
                  autoFocus
                  className="h-8 w-full rounded-sm border border-steel-700 bg-steel-900 px-2.5 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/40 focus:border-signal-500 focus:outline-none"
                />
                {parkError ? (
                  <p className="font-mono text-[10px] text-hazard-400">{parkError}</p>
                ) : null}
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    disabled={parkLoading}
                    onClick={commitPark}
                    className="flex-1 h-7 rounded-sm border border-signal-500 bg-signal-700/10 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-signal-400 transition-colors hover:bg-signal-700/20 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {parkLoading ? "Aparcando..." : "Aparcar venta"}
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

// ── Icons ──────────────────────────────────────────────────────────────────

function PauseCircleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <rect x="9" y="8" width="2" height="8" rx="0.5" />
      <rect x="13" y="8" width="2" height="8" rx="0.5" />
    </svg>
  );
}

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

