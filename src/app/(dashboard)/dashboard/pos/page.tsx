import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { getPosPermissions } from "@/lib/auth/permissions";
import {
  PosTerminal,
  type PosProduct,
  type PosPresentation,
  type PosWarehouse,
  type ActiveCashSession,
  type PosBundleComponent,
} from "./pos-terminal";
import type { PickedCustomer } from "@/components/dashboard/customer-picker";

export const metadata: Metadata = { title: "POS · SaturLub" };
export const dynamic = "force-dynamic";

export default async function PosPage({
  searchParams,
}: {
  searchParams: Promise<{ exchange_return_id?: string; exchange_credit?: string }>;
}) {
  const { user, membership } = await getActiveMembership();
  if (!user) redirect("/login");
  if (!membership) redirect("/onboarding");

  const permissions = getPosPermissions(membership.role);
  if (!permissions.canUsePOS) redirect("/dashboard");

  const supabase = await createClient();
  const tenantId = membership.tenant_id;

  // ── Exchange params — validated from DB (trust DB, not URL) ──
  // 1. Return must exist for this tenant.
  // 2. exchange_sale_id must be NULL (not already consumed).
  // 3. Credit amount comes from DB refund_amount, not from the URL.
  const sp = await searchParams;
  let exchangeReturnId: string | null = null;
  let exchangeCredit:   number        = 0;
  if (sp.exchange_return_id) {
    const { data: retRow } = await supabase
      .from("sale_returns")
      .select("id, refund_amount, exchange_sale_id, exchange_credit_applied")
      .eq("id", sp.exchange_return_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (retRow && !retRow.exchange_sale_id) {
      // Not yet consumed — extract credit from DB (ignore URL param value)
      const alreadyApplied = Number(retRow.exchange_credit_applied ?? 0);
      const fullCredit     = Number(retRow.refund_amount ?? 0);
      exchangeReturnId = retRow.id as string;
      exchangeCredit   = Math.max(0, fullCredit - alreadyApplied);
    }
    // If retRow is null or exchange_sale_id is set → silently ignore (no banner)
  }

  // ── Products (base data) ────────────────────────────────────
  const { data: rawProducts } = await supabase
    .from("products")
    .select(
      "id, name, sku, unit, tax_rate, has_tax, track_inventory, product_kind, default_price, average_cost"
    )
    .eq("is_active", true)
    .neq("product_kind", "supply")
    .order("name");

  // ── PUBLICO prices ──────────────────────────────────────────
  const { data: publicPrices } = await supabase
    .from("v_product_active_prices")
    .select("product_id, unit_price")
    .eq("tier_code", "PUBLICO");

  const priceByProduct = new Map<string, number>();
  for (const r of publicPrices ?? []) {
    priceByProduct.set(r.product_id as string, Number(r.unit_price ?? 0));
  }

  // ── Stock (sum across all warehouses) ──────────────────────
  const { data: balances } = await supabase
    .from("inventory_balances")
    .select("product_id, quantity_on_hand");

  const stockByProduct = new Map<string, number>();
  for (const b of balances ?? []) {
    const cur = stockByProduct.get(b.product_id as string) ?? 0;
    stockByProduct.set(b.product_id as string, cur + Number(b.quantity_on_hand ?? 0));
  }

  // ── Bundle items (kit components) ──────────────────────────
  type RawBundleItem = {
    bundle_product_id:    string;
    component_product_id: string;
    quantity:             number;
    base_qty:             number;
    sort_order:           number;
  };

  let kitComponentsByProduct = new Map<string, PosBundleComponent[]>();
  {
    const { data: rawBundles } = await supabase
      .from("bundle_items")
      .select("bundle_product_id, component_product_id, quantity, base_qty, sort_order")
      .eq("tenant_id", tenantId)
      .order("sort_order");

    if (rawBundles) {
      for (const b of rawBundles as unknown as RawBundleItem[]) {
        const arr = kitComponentsByProduct.get(b.bundle_product_id) ?? [];
        arr.push({
          product_id: b.component_product_id,
          quantity:   Number(b.quantity ?? 1),
          base_qty:   Number(b.base_qty  ?? 1),
          sort_order: b.sort_order,
        });
        kitComponentsByProduct.set(b.bundle_product_id, arr);
      }
    }
  }

  // ── Presentations (post-v3 migration, graceful fallback) ───
  type RawPres = {
    id: string;
    product_id: string;
    name: string;
    unit_label: string;
    base_qty: number;
    unit_price: number | null;
    is_default: boolean;
    sort_order: number;
  };

  let presByProduct = new Map<string, PosPresentation[]>();
  {
    const { data: rawPres } = await supabase
      .from("product_presentations")
      .select("id, product_id, name, unit_label, base_qty, unit_price, is_default, sort_order")
      .eq("is_active", true)
      .order("sort_order");

    if (rawPres) {
      for (const p of rawPres as unknown as RawPres[]) {
        const arr = presByProduct.get(p.product_id) ?? [];
        arr.push({
          id:         p.id,
          name:       p.name,
          unit_label: p.unit_label,
          base_qty:   Number(p.base_qty ?? 1),
          unit_price: p.unit_price != null ? Number(p.unit_price) : null,
          is_default: p.is_default,
          sort_order: p.sort_order,
        });
        presByProduct.set(p.product_id, arr);
      }
    }
  }

  // ── Build PosProduct list ───────────────────────────────────
  const products: PosProduct[] = (rawProducts ?? []).map((p) => {
    const pid        = p.id as string;
    const price      = priceByProduct.get(pid) ?? (p.default_price as number | null) ?? 0;
    const isKit      = p.product_kind === "kit" || p.product_kind === "bundle";
    const components = kitComponentsByProduct.get(pid) ?? [];

    // Kit stock = min sellable units based on component availability
    let kitStock = 0;
    if (isKit && components.length > 0) {
      kitStock = Math.floor(
        Math.min(
          ...components.map((c) => {
            const compStock = stockByProduct.get(c.product_id) ?? 0;
            return compStock / (c.quantity * c.base_qty);
          })
        )
      );
    }

    return {
      id:              pid,
      name:            p.name as string,
      sku:             p.sku as string,
      unit:            p.unit as string,
      price:           Number(price),
      tax_rate:        Number(p.tax_rate ?? 15),
      has_tax:         (p.has_tax as boolean | null) ?? true,
      track_inventory: (p.track_inventory as boolean | null) ?? true,
      product_kind:    p.product_kind as string,
      stock:           isKit ? kitStock : (stockByProduct.get(pid) ?? 0),
      presentations:   presByProduct.get(pid) ?? [],
      is_kit:          isKit,
      kit_components:  components,
      average_cost:    Number((p as { average_cost?: number | null }).average_cost ?? 0),
    };
  });

  // ── Warehouses ──────────────────────────────────────────────
  const { data: rawWarehouses } = await supabase
    .from("warehouses")
    .select("id, name")
    .order("name");

  const warehouses: PosWarehouse[] = (rawWarehouses ?? []).map((w) => ({
    id:   w.id as string,
    name: w.name as string,
  }));

  // ── Active cash session for this warehouse ─────────────────
  let activeCashSession: ActiveCashSession | null = null;
  {
    let sessionQuery = supabase
      .from("cash_sessions")
      .select("id, opening_amount, opened_at")
      .eq("tenant_id", tenantId)
      .eq("status", "open");

    // Match warehouse: exact null comparison requires is/filter workaround
    const firstWarehouse = warehouses[0];
    const wid = firstWarehouse?.id ?? null;
    if (wid) {
      sessionQuery = sessionQuery.eq("warehouse_id", wid);
    } else {
      sessionQuery = sessionQuery.is("warehouse_id", null);
    }

    const { data: sessData } = await sessionQuery.maybeSingle();
    if (sessData) {
      activeCashSession = {
        id:             sessData.id as string,
        opening_amount: Number(sessData.opening_amount ?? 0),
        opened_at:      sessData.opened_at as string,
      };
    }
  }

  // ── Default customer: Consumidor Final ─────────────────────
  const { data: defaultCustomerRaw } = await supabase
    .from("business_partners")
    .select("id, full_name, document_type, document_number, phone")
    .eq("document_type", "CONSUMIDOR_FINAL")
    .eq("is_active", true)
    .maybeSingle();

  const defaultCustomer: PickedCustomer | null = defaultCustomerRaw
    ? {
        id:              defaultCustomerRaw.id as string,
        full_name:       defaultCustomerRaw.full_name as string,
        document_type:   defaultCustomerRaw.document_type as string,
        document_number: defaultCustomerRaw.document_number as string,
        phone:           defaultCustomerRaw.phone as string | null,
      }
    : null;

  return (
    <PosTerminal
      products={products}
      warehouses={warehouses}
      defaultCustomer={defaultCustomer}
      permissions={permissions}
      userName={
        (user.user_metadata?.full_name as string | undefined) ?? user.email ?? ""
      }
      activeCashSession={activeCashSession}
      exchangeReturnId={exchangeReturnId}
      exchangeCredit={exchangeCredit > 0 ? exchangeCredit : undefined}
    />
  );
}
