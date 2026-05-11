"use client";

import * as React from "react";
import Big from "big.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { CustomerPicker, type PickedCustomer } from "@/components/dashboard/customer-picker";
import type { PosPermissions } from "@/lib/auth/permissions";
import { CheckoutDialog } from "./checkout-dialog";

// ── Types ──────────────────────────────────────────────────────────────────

export type PosPresentation = {
  id:         string;
  name:       string;
  unit_label: string;   // "Galón", "Caneca 5 gal", "Litro"
  base_qty:   number;   // base units per 1 of this presentation
  unit_price: number | null; // null → use product's PUBLICO price
  is_default: boolean;
  sort_order: number;
};

export type PosProduct = {
  id:              string;
  name:            string;
  sku:             string;
  unit:            string;      // base unit (e.g. "litro", "unidad")
  price:           number;      // GROSS (inc. IVA) — PUBLICO tier
  tax_rate:        number;
  has_tax:         boolean;
  track_inventory: boolean;
  product_kind:    string;
  stock:           number;      // in base units, total across warehouses
  presentations:   PosPresentation[];
};

export type PosWarehouse = { id: string; name: string };

type CartLine = {
  key:             string;      // `${product_id}::${presentation_id ?? 'base'}`
  product_id:      string;
  presentation_id: string | null;
  name:            string;
  unit_label:      string;      // what the user sees ("Galón", "Litro", product.unit)
  unit_price:      number;      // GROSS for this presentation
  base_qty:        number;      // base units per sold unit
  tax_rate:        number;
  has_tax:         boolean;
  track_inventory: boolean;
  stock_base:      number;      // total base units available
  quantity:        number;
  discount_amount: number;
};

// ── Constants ──────────────────────────────────────────────────────────────

const PAGE_SIZE = 24;

const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

// ── Math (big.js) ──────────────────────────────────────────────────────────

function lineGross(line: CartLine): Big {
  return Big(line.unit_price).times(line.quantity).minus(line.discount_amount);
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

/** Available stock of this presentation = floor(base_stock / base_qty). */
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
}: {
  products:        PosProduct[];
  warehouses:      PosWarehouse[];
  defaultCustomer: PickedCustomer | null;
  permissions:     PosPermissions;
  userName:        string;
}) {
  const [cart, setCart]           = React.useState<CartLine[]>([]);
  const [customer, setCustomer]   = React.useState<PickedCustomer | null>(defaultCustomer);
  const [warehouseId, setWarehouseId] = React.useState<string | null>(
    warehouses.length === 1 ? (warehouses[0]?.id ?? null) : null
  );
  const [searchQuery, setSearchQuery]   = React.useState("");
  const debouncedQuery                  = useDebounce(searchQuery, 150);
  const [page, setPage]                 = React.useState(0);
  const [mobileCartOpen, setMobileCartOpen] = React.useState(false);
  const [checkoutOpen, setCheckoutOpen] = React.useState(false);
  const [flashKeys, setFlashKeys]       = React.useState<Set<string>>(new Set());

  React.useEffect(() => setPage(0), [debouncedQuery]);

  // ── Catalog ──────────────────────────────────────────────────
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

  // ── Cart operations ──────────────────────────────────────────
  const addToCart = React.useCallback((product: PosProduct, pres: PosPresentation | null = null) => {
    const resolved  = resolvePresentation(product, pres);
    const lineKey   = `${product.id}::${resolved.presentation_id ?? "base"}`;

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
        },
      ];
    });

    // Flash
    setFlashKeys((prev) => {
      const next = new Set(prev); next.add(lineKey); return next;
    });
    setTimeout(() => setFlashKeys((prev) => {
      const next = new Set(prev); next.delete(lineKey); return next;
    }), 600);
  }, []);

  const setQty = (key: string, qty: number) => {
    if (qty <= 0) setCart((prev) => prev.filter((l) => l.key !== key));
    else setCart((prev) => prev.map((l) => l.key === key ? { ...l, quantity: qty } : l));
  };

  const removeFromCart = (key: string) =>
    setCart((prev) => prev.filter((l) => l.key !== key));

  const clearCart = () => {
    setCart([]);
    setCustomer(defaultCustomer);
  };

  // ── Totals ───────────────────────────────────────────────────
  const totals = React.useMemo(() => calcTotals(cart), [cart]);

  const hasStockIssue = React.useMemo(() =>
    warehouseId != null &&
    cart.some((l) => l.track_inventory && l.quantity * l.base_qty > l.stock_base),
    [cart, warehouseId]
  );

  const canCheckout = cart.length > 0 && customer != null && !hasStockIssue;

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="flex w-full flex-col gap-4">
      {/* ── Header ────────────────────────────────────────────── */}
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

        <div className="hidden shrink-0 items-center gap-1.5 rounded-sm border border-steel-700 bg-steel-900/50 px-2.5 py-1.5 sm:flex">
          <UserIcon className="h-3.5 w-3.5 text-muted-foreground/70" />
          <span className="max-w-[100px] truncate font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            {userName}
          </span>
        </div>
      </div>

      {warehouses.length > 0 && !warehouseId ? (
        <Alert tone="warning">
          Sin bodega — las ventas no descontarán inventario.
        </Alert>
      ) : null}

      {/* ── Two-panel layout ──────────────────────────────────── */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-5">

        {/* ── CATALOG ─────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {/* Search */}
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar producto por nombre o SKU..."
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

          {/* Grid */}
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
                const defaultPres    = product.presentations.find((p) => p.is_default) ?? null;
                const cartLines      = cart.filter((l) => l.product_id === product.id);
                const totalInCart    = cartLines.reduce((s, l) => s + l.quantity, 0);
                const baseInCart     = cartLines.reduce((s, l) => s + l.quantity * l.base_qty, 0);
                const noStock        = warehouseId != null && product.track_inventory && product.stock - baseInCart <= 0;
                const noPrice        = product.price === 0 && !product.presentations.some((p) => p.unit_price);

                const isFlashing     = cartLines.some((l) => flashKeys.has(l.key));

                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => !noStock && addToCart(product, defaultPres)}
                    disabled={noStock}
                    className={[
                      "group relative flex min-h-[96px] flex-col rounded-sm border-2 p-3 text-left transition-all duration-150",
                      noStock
                        ? "cursor-not-allowed border-steel-800 bg-steel-900/20 opacity-50"
                        : isFlashing
                          ? "scale-[0.97] border-safety-500 bg-safety-500/10"
                          : totalInCart > 0
                            ? "border-safety-500/40 bg-safety-500/5 hover:border-safety-500/70 hover:bg-safety-500/10"
                            : "border-steel-700 bg-steel-900 hover:border-safety-500/50 hover:bg-steel-800 active:scale-[0.97]",
                    ].join(" ")}
                  >
                    {/* Cart qty badge */}
                    {totalInCart > 0 ? (
                      <span className="absolute right-2 top-2 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-safety-500 px-1 font-mono text-[10px] font-bold tabular-nums text-steel-950">
                        {totalInCart}
                      </span>
                    ) : null}

                    {/* Name + SKU */}
                    <div className="flex-1 space-y-0.5 pr-6">
                      <div className="line-clamp-2 text-[13px] font-semibold leading-tight text-foreground">
                        {product.name}
                      </div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/60">
                        {product.sku}
                      </div>
                    </div>

                    {/* Price + stock */}
                    <div className="mt-2 flex items-end justify-between gap-1">
                      <span
                        className={
                          "font-display text-[17px] leading-none tabular-nums " +
                          (noPrice ? "text-muted-foreground/50" : "text-safety-500")
                        }
                      >
                        {noPrice
                          ? "—"
                          : moneyFmt.format(defaultPres?.unit_price ?? product.price)}
                      </span>
                      {product.track_inventory ? (
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

                    {/* Presentation chips — stop propagation so card tap uses default */}
                    {product.presentations.length > 1 ? (
                      <div
                        className="mt-2 flex flex-wrap gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {product.presentations.map((pres) => {
                          const inCart    = cart.find((l) => l.product_id === product.id && l.presentation_id === pres.id);
                          const presStock = stockForPresentation(product.stock, pres.base_qty);
                          const presNoStock = warehouseId != null && product.track_inventory && presStock <= 0;
                          return (
                            <button
                              key={pres.id}
                              type="button"
                              disabled={presNoStock}
                              onClick={() => !presNoStock && addToCart(product, pres)}
                              title={`${pres.unit_label} · ${moneyFmt.format(pres.unit_price ?? product.price)}`}
                              className={[
                                "rounded-sm border px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.08em] transition-colors",
                                presNoStock
                                  ? "cursor-not-allowed border-steel-800 text-muted-foreground/30"
                                  : inCart
                                    ? "border-safety-500 bg-safety-500/20 text-safety-500"
                                    : "border-steel-600 text-muted-foreground hover:border-safety-500/50 hover:text-foreground",
                              ].join(" ")}
                            >
                              {pres.unit_label}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 ? (
            <div className="flex items-center justify-between text-[12px] text-muted-foreground">
              <span>
                {safePage * PAGE_SIZE + 1}–
                {Math.min((safePage + 1) * PAGE_SIZE, filteredProducts.length)} de{" "}
                {filteredProducts.length}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="md" disabled={safePage === 0} onClick={() => setPage((p) => p - 1)}>
                  ‹
                </Button>
                <span className="font-mono text-[12px] tabular-nums">{safePage + 1}/{totalPages}</span>
                <Button variant="outline" size="md" disabled={safePage >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
                  ›
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        {/* ── CART (desktop sticky) ────────────────────────────── */}
        <div className="hidden lg:block lg:w-[300px] lg:shrink-0 lg:sticky lg:top-4">
          <CartPanel
            cart={cart}
            totals={totals}
            customer={customer}
            hasStockIssue={hasStockIssue}
            canCheckout={canCheckout}
            onSetQty={setQty}
            onRemove={removeFromCart}
            onClear={clearCart}
            onCheckout={() => setCheckoutOpen(true)}
          />
        </div>
      </div>

      {/* ── Mobile: floating cart button ──────────────────────── */}
      {cart.length > 0 ? (
        <button
          type="button"
          onClick={() => setMobileCartOpen(true)}
          className="fixed bottom-5 right-5 z-30 flex items-center gap-2.5 rounded-full border-2 border-safety-500 bg-steel-900 px-4 py-2.5 shadow-safety-glow transition-transform active:scale-95 lg:hidden"
        >
          <CartIcon className="h-4 w-4 text-safety-500" />
          <span className="font-mono text-[12px] font-bold tabular-nums text-foreground">
            {totals.items}
          </span>
          <span className="font-display text-[15px] leading-none text-safety-500">
            {moneyFmt.format(Number(totals.gross))}
          </span>
        </button>
      ) : null}

      {/* ── Mobile: cart sheet ───────────────────────────────── */}
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
            hasStockIssue={hasStockIssue}
            canCheckout={canCheckout}
            onSetQty={setQty}
            onRemove={removeFromCart}
            onClear={clearCart}
            onCheckout={() => {
              setMobileCartOpen(false);
              setTimeout(() => setCheckoutOpen(true), 200);
            }}
          />
        </div>
      </Sheet>

      {/* ── Checkout dialog ───────────────────────────────────── */}
      {checkoutOpen ? (
        <CheckoutDialog
          open={checkoutOpen}
          onClose={() => setCheckoutOpen(false)}
          cart={cart.map((l) => ({
            product_id:      l.product_id,
            quantity:        l.quantity,
            discount_amount: l.discount_amount,
            presentation_id: l.presentation_id,
            base_qty:        l.base_qty,
          }))}
          totals={{ gross: Number(totals.gross), net: Number(totals.net), iva: Number(totals.iva) }}
          customerId={customer?.id ?? ""}
          warehouseId={warehouseId}
          onSuccess={clearCart}
        />
      ) : null}
    </div>
  );
}

// ── CartPanel ──────────────────────────────────────────────────────────────

function CartPanel({
  cart,
  totals,
  customer,
  hasStockIssue,
  canCheckout,
  onSetQty,
  onRemove,
  onClear,
  onCheckout,
}: {
  cart:          CartLine[];
  totals:        ReturnType<typeof calcTotals>;
  customer:      PickedCustomer | null;
  hasStockIssue: boolean;
  canCheckout:   boolean;
  onSetQty:      (key: string, qty: number) => void;
  onRemove:      (key: string) => void;
  onClear:       () => void;
  onCheckout:    () => void;
}) {
  return (
    <div className="panel flex flex-col rounded-sm overflow-hidden">
      {/* Header */}
      <div className="top-highlight flex items-center justify-between border-b-2 border-steel-700 bg-steel-900/70 px-4 py-2.5">
        <h2 className="font-display text-[15px] tracking-[0.04em]">CARRITO</h2>
        <div className="flex items-center gap-2">
          {cart.length > 0 ? <Badge tone="warning">{totals.items}</Badge> : null}
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
              const gross    = Number(lineGross(line).round(2).toString());
              const stockWarn = line.track_inventory && line.quantity * line.base_qty > line.stock_base;
              return (
                <li key={line.key} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px] font-semibold leading-tight text-foreground">
                        {line.name}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/70">
                        <span>{moneyFmt.format(line.unit_price)}</span>
                        <span>/</span>
                        <span>{line.unit_label}</span>
                        {line.base_qty !== 1 ? (
                          <span className="text-muted-foreground/50">
                            ({line.base_qty} u.b.)
                          </span>
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

                  {/* Qty controls */}
                  <div className="mt-2 flex items-center justify-between">
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
                    <button
                      type="button"
                      onClick={() => onRemove(line.key)}
                      className="h-6 w-6 grid place-items-center rounded-sm text-muted-foreground/50 transition-colors hover:text-hazard-500"
                      aria-label="Quitar"
                    >
                      <XSmallIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Totals + Cobrar */}
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

          {hasStockIssue ? (
            <p className="rounded-sm border border-hazard-500/40 bg-hazard-700/10 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-red-400">
              Stock insuficiente en un ítem
            </p>
          ) : null}

          <Button
            onClick={onCheckout}
            disabled={!canCheckout}
            size="md"
            className="h-11 w-full font-bold"
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
