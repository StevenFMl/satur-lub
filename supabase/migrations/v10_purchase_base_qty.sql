-- ============================================================
-- v10_purchase_base_qty.sql  (rev-2 — corregido)
--
-- Adds base_qty to purchase_order_items and rewrites both RPCs
-- so that every inventory operation is expressed in BASE UNITS,
-- matching the POS decrement semantics (qty × base_qty).
--
-- Fixes applied vs rev-1:
--   1. quantity_bonus IS now persisted in purchase_order_items
--      and is included in the cancel reversal.
--   2. inventory_movements.unit_cost uses v_cost_per_base in BOTH
--      reception and cancellation (same scale: cost per BASE unit).
--   3. CPP intermediate variables use full numeric(14,6) precision;
--      round() is applied only when writing to the database.
--   4. CHECK constraint on base_qty is guarded by a DO $$ block
--      so repeated runs do not create duplicate anonymous constraints.
--   5. v_balance in cancel declared numeric(12,4) to match v_inv_qty.
--
-- Idempotency strategy (same as v7/v8/v9):
--   · ADD COLUMN IF NOT EXISTS  → no-op when column exists
--   · CREATE OR REPLACE FUNCTION → always idempotent
--   · CHECK constraint → DO $$ guard on pg_constraint
-- ============================================================


-- ══════════════════════════════════════════════════════════════
-- 1. Schema patch — purchase_order_items
-- ══════════════════════════════════════════════════════════════

-- 1-A: Add columns (no-op when already present)
ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS base_qty      numeric(12,4) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS quantity_bonus numeric(12,4) NOT NULL DEFAULT 0;

-- 1-B: CHECK constraints via DO block (idempotent — skipped if already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.purchase_order_items'::regclass
       AND contype  = 'c'
       AND conname  = 'purchase_order_items_base_qty_check'
  ) THEN
    ALTER TABLE public.purchase_order_items
      ADD CONSTRAINT purchase_order_items_base_qty_check CHECK (base_qty > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.purchase_order_items'::regclass
       AND contype  = 'c'
       AND conname  = 'purchase_order_items_quantity_bonus_check'
  ) THEN
    ALTER TABLE public.purchase_order_items
      ADD CONSTRAINT purchase_order_items_quantity_bonus_check CHECK (quantity_bonus >= 0);
  END IF;
END $$;


-- ══════════════════════════════════════════════════════════════
-- 2. receive_purchase_order — unified base-unit semantics
-- ══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.receive_purchase_order(
  uuid, uuid, uuid, text, text, date, date, text, jsonb,
  numeric, boolean, numeric, numeric, numeric, numeric
);

CREATE OR REPLACE FUNCTION public.receive_purchase_order(
  p_tenant_id        uuid,
  p_supplier_id      uuid,
  p_warehouse_id     uuid,
  p_payment_method   text,
  p_payment_status   text,
  p_payment_due_date date,
  p_purchase_date    date,
  p_notes            text,
  p_items            jsonb,
  p_tax_rate         numeric,
  p_is_tax_inclusive boolean,
  p_subtotal         numeric,
  p_tax_amount       numeric,
  p_grand_total      numeric,
  p_other_charges    numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id         uuid := auth.uid();
  v_po_id           uuid;
  v_item            jsonb;

  -- Item-level scalars
  v_product_id      uuid;
  v_qty_paid        numeric(12,4);   -- units purchased (billed)
  v_qty_bonus       numeric(12,4);   -- free / bonus units received
  v_qty_received    numeric(12,4);   -- total received = paid + bonus
  v_base_qty        numeric(12,4);   -- multiplier per purchased unit → base units
  v_inv_qty         numeric(12,4);   -- base units entering inventory = qty_received × base_qty
  v_unit_cost       numeric(14,6);   -- NET cost per PURCHASED unit (IVA stripped by caller)
  v_line_total      numeric(14,6);   -- fiscal cost = qty_paid × unit_cost
  v_cost_per_base   numeric(14,6);   -- NET cost per BASE unit = line_total / inv_qty
                                     -- (base units that have a real cost — qty_paid × base_qty)
  v_is_taxable      boolean;
  v_pay_status      text;

  -- CPP (Costo Promedio Ponderado)
  v_stock_total     numeric(14,6);   -- existing base-unit stock across all warehouses
  v_avg_old         numeric(14,6);   -- existing average cost per base unit
  v_avg_new         numeric(14,6);   -- new weighted average (unrounded for precision)
BEGIN
  -- ── Guards ──────────────────────────────────────────────────────────────
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'p_tenant_id es requerido';
  END IF;

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Debe incluir al menos un ítem';
  END IF;

  IF p_payment_method NOT IN ('cash', 'transfer', 'credit') THEN
    RAISE EXCEPTION 'Método de pago inválido: %', p_payment_method;
  END IF;

  IF p_tax_rate IS NULL OR p_tax_rate < 0 OR p_tax_rate > 100 THEN
    RAISE EXCEPTION 'Tasa de IVA inválida';
  END IF;

  IF p_subtotal IS NULL OR p_subtotal < 0
     OR p_tax_amount IS NULL OR p_tax_amount < 0
     OR p_grand_total IS NULL OR p_grand_total < 0 THEN
    RAISE EXCEPTION 'Totales fiscales inválidos';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.business_partners
     WHERE id = p_supplier_id AND tenant_id = p_tenant_id
       AND partner_type = 'supplier' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Proveedor inválido';
  END IF;

  IF p_warehouse_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.warehouses
     WHERE id = p_warehouse_id AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Bodega inválida';
  END IF;

  -- ── Purchase order header ────────────────────────────────────────────────
  v_pay_status := CASE
    WHEN p_payment_method IN ('cash', 'transfer') THEN COALESCE(p_payment_status, 'paid')
    ELSE COALESCE(p_payment_status, 'pending')
  END;

  INSERT INTO public.purchase_orders (
    tenant_id, supplier_id, warehouse_id,
    subtotal, tax_total, total,
    tax_rate, is_tax_inclusive, tax_amount, grand_total, other_charges,
    status, notes, created_by,
    payment_method, payment_status, payment_due_date,
    purchase_date
  ) VALUES (
    p_tenant_id, p_supplier_id, p_warehouse_id,
    p_subtotal, p_tax_amount, p_grand_total,
    p_tax_rate, p_is_tax_inclusive, p_tax_amount, p_grand_total, p_other_charges,
    'received', p_notes, v_user_id,
    p_payment_method, v_pay_status,
    CASE WHEN p_payment_method = 'credit' THEN p_payment_due_date ELSE NULL END,
    p_purchase_date
  )
  RETURNING id INTO v_po_id;

  -- ── Per-item loop ────────────────────────────────────────────────────────
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id  := (v_item->>'product_id')::uuid;
    v_qty_paid    := (v_item->>'quantity')::numeric;
    v_qty_bonus   := COALESCE(NULLIF(trim(COALESCE(v_item->>'quantity_bonus', '')), '')::numeric, 0);
    v_base_qty    := COALESCE(NULLIF((v_item->>'base_qty')::numeric, 0), 1);
    v_unit_cost   := (v_item->>'unit_cost')::numeric;  -- NET, IVA stripped by server action
    v_is_taxable  := COALESCE((v_item->>'is_taxable')::boolean, true);

    -- ── Validations ─────────────────────────────────────────────────────
    IF v_qty_paid IS NULL OR v_qty_paid <= 0 THEN
      RAISE EXCEPTION 'Cantidad pagada debe ser > 0';
    END IF;
    IF v_unit_cost IS NULL OR v_unit_cost < 0 THEN
      RAISE EXCEPTION 'Costo unitario inválido';
    END IF;
    IF v_qty_bonus < 0 THEN
      RAISE EXCEPTION 'Cantidad bonificada no puede ser negativa';
    END IF;
    IF v_base_qty <= 0 THEN
      RAISE EXCEPTION 'base_qty debe ser > 0';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.products
       WHERE id = v_product_id AND tenant_id = p_tenant_id
    ) THEN
      RAISE EXCEPTION 'Producto inválido (%)', v_product_id;
    END IF;

    -- ── Derived quantities ───────────────────────────────────────────────
    --
    -- Terminology used throughout:
    --   qty_paid     = purchased units that generate a cost (e.g. 12 cans)
    --   qty_bonus    = free units from supplier (e.g. 3 cans)
    --   qty_received = total units received (15 cans)
    --   base_qty     = sub-units per purchased unit (e.g. 55 litres per can)
    --   inv_qty      = base units entering the warehouse
    --                = qty_received × base_qty  (e.g. 15 × 55 = 825 litres)
    --   line_total   = fiscal cost = qty_paid × unit_cost  (no bonus)
    --   cost_per_base = cost per base unit that has actual cost
    --                 = line_total / (qty_paid × base_qty)
    --                 (bonus units are "free" — their cost_per_base is 0
    --                  but they ARE included in inventory so the CPP
    --                  average dilutes naturally via v_inv_qty)
    --
    v_qty_received := v_qty_paid + v_qty_bonus;
    v_line_total   := v_qty_paid * v_unit_cost;             -- fiscal only; no round yet
    v_inv_qty      := v_qty_received * v_base_qty;          -- base units into warehouse

    -- Cost per base unit: spread line_total over the PAID base units.
    -- Bonus base units get $0 incremental cost — the CPP formula below
    -- naturally dilutes the average because inv_qty > paid_base_units.
    IF (v_qty_paid * v_base_qty) > 0 THEN
      v_cost_per_base := v_line_total / (v_qty_paid * v_base_qty);
    ELSE
      v_cost_per_base := 0;
    END IF;

    -- ── Persist item (includes both bonus and base_qty) ──────────────────
    INSERT INTO public.purchase_order_items (
      tenant_id, purchase_order_id, product_id,
      quantity, quantity_bonus, unit_cost, line_total, is_taxable, base_qty
    ) VALUES (
      p_tenant_id, v_po_id, v_product_id,
      v_qty_paid, v_qty_bonus,
      round(v_unit_cost,    4),
      round(v_line_total,   2),
      v_is_taxable,
      v_base_qty
    );

    -- ── Inventory movement — always in BASE UNITS, cost per BASE unit ─────
    --
    -- quantity  = inv_qty         (e.g. 825 litres)
    -- unit_cost = cost_per_base   (e.g. $8.00 / litre)
    -- This is the "receipt" movement; the matching "cancel" movement below
    -- uses the same two values so the ledger is always self-consistent.
    --
    INSERT INTO public.inventory_movements (
      tenant_id, warehouse_id, product_id,
      movement_type, quantity, unit_cost, reason,
      reference_type, reference_id, performed_by_user_id, direction
    ) VALUES (
      p_tenant_id, p_warehouse_id, v_product_id,
      'purchase', v_inv_qty, round(v_cost_per_base, 6), 'Recepción de compra',
      'purchase_order', v_po_id, v_user_id, 1
    );

    -- ── CPP (Costo Promedio Ponderado) ───────────────────────────────────
    --
    -- All quantities in BASE UNITS → average is cost per base unit.
    -- Precision: keep numeric(14,6) during computation; round only on UPDATE.
    --
    -- Note: v_stock_total is fetched AFTER the balance insert (below) so we
    -- use the PRE-insert stock for the formula. We fetch it here, before the
    -- inventory_balances upsert.
    --
    PERFORM 1
       FROM public.products
      WHERE id = v_product_id AND tenant_id = p_tenant_id
        FOR UPDATE;   -- row-level lock prevents concurrent CPP drift

    SELECT COALESCE(SUM(quantity_on_hand), 0)
      INTO v_stock_total
      FROM public.inventory_balances
     WHERE tenant_id = p_tenant_id AND product_id = v_product_id;

    SELECT COALESCE(average_cost, 0)
      INTO v_avg_old
      FROM public.products
     WHERE id = v_product_id AND tenant_id = p_tenant_id;

    --
    -- Weighted average formula (all in base units):
    --
    --   new_avg = (existing_stock_value + NEW_MONETARY_COST)
    --             / (existing_stock_units + NEW_BASE_UNITS)
    --
    --   where:
    --     existing_stock_value = v_stock_total * v_avg_old   ($ of current stock)
    --     NEW_MONETARY_COST    = v_line_total                ($ actually paid)
    --     existing_stock_units = v_stock_total               (base units on shelf)
    --     NEW_BASE_UNITS       = v_inv_qty                   (base units entering)
    --
    -- IMPORTANT: the numerator uses v_line_total, NOT (v_inv_qty * v_cost_per_base).
    -- Those two are equal ONLY when quantity_bonus = 0. When bonus > 0:
    --   inv_qty * cost_per_base = (qty_received/qty_paid) * line_total > line_total
    -- Using inv_qty * cost_per_base would inflate the monetary contribution and
    -- cause the CPP to ignore the diluting effect of the free units.
    --
    -- Proof that line_total is correct:
    --   The total monetary value of inventory after this purchase is:
    --     old_value + line_total                     (we only spent line_total)
    --   The total base units on the shelf are:
    --     v_stock_total + v_inv_qty                  (includes bonus base units)
    --   Therefore CPP = (old_value + line_total) / (stock + inv_qty).
    --   Bonus units dilute the average — more units, same extra cost.
    --
    -- v_inv_qty > 0 is guaranteed by validations (qty_paid > 0, base_qty > 0),
    -- so the denominator is always > 0; no division-by-zero guard needed.
    --
    v_avg_new := (  (v_stock_total * v_avg_old)
                  + v_line_total )
               / (v_stock_total + v_inv_qty);

    UPDATE public.products
       SET average_cost       = round(v_avg_new,       4),  -- round only on write
           -- last_purchase_cost = negotiated price per purchased unit (no base_qty, no bonus)
           -- Semantics: "what did we last pay the supplier per ordered unit?"
           -- Used as a reference for the next purchase suggestion.
           last_purchase_cost = round(v_unit_cost,     4),
           last_supplier_id   = p_supplier_id
     WHERE id = v_product_id AND tenant_id = p_tenant_id;

    -- ── Physical balance (base units) ────────────────────────────────────
    IF p_warehouse_id IS NOT NULL THEN
      INSERT INTO public.inventory_balances (
        tenant_id, warehouse_id, product_id, quantity_on_hand
      ) VALUES (
        p_tenant_id, p_warehouse_id, v_product_id, v_inv_qty
      )
      ON CONFLICT (tenant_id, warehouse_id, product_id) DO UPDATE
        SET quantity_on_hand = public.inventory_balances.quantity_on_hand + EXCLUDED.quantity_on_hand,
            updated_at = now();
    END IF;
  END LOOP;

  RETURN v_po_id;
END;
$$;

REVOKE ALL ON FUNCTION public.receive_purchase_order(
  uuid, uuid, uuid, text, text, date, date, text, jsonb,
  numeric, boolean, numeric, numeric, numeric, numeric
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.receive_purchase_order(
  uuid, uuid, uuid, text, text, date, date, text, jsonb,
  numeric, boolean, numeric, numeric, numeric, numeric
) TO authenticated;


-- ══════════════════════════════════════════════════════════════
-- 3. cancel_purchase_order — exact mirror of reception
-- ══════════════════════════════════════════════════════════════
--
-- Reversal semantics MUST match reception:
--   · quantity  = (qty_paid + qty_bonus) × base_qty   (same inv_qty)
--   · unit_cost = line_total / (qty_paid × base_qty)  (same cost_per_base)
-- This ensures inventory_movements is a self-balancing ledger.
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.cancel_purchase_order(
  p_tenant_id uuid,
  p_po_id     uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id       uuid := auth.uid();
  v_warehouse_id  uuid;
  v_status        text;
  v_item          record;
  v_qty_received  numeric(12,4);   -- total units received (paid + bonus)
  v_base_qty      numeric(12,4);
  v_inv_qty       numeric(12,4);   -- base units to remove from inventory
  v_cost_per_base numeric(14,6);   -- same as reception: line_total / (qty_paid × base_qty)
  v_balance       numeric(12,4);   -- current stock in base units (12,4 — not 12,2!)
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'p_tenant_id es requerido';
  END IF;

  SELECT status, warehouse_id
    INTO v_status, v_warehouse_id
    FROM public.purchase_orders
   WHERE id = p_po_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden de compra no encontrada';
  END IF;

  IF v_status <> 'received' THEN
    RAISE EXCEPTION 'Solo se pueden anular órdenes en estado "received". Estado actual: %', v_status;
  END IF;

  -- ── Pre-validation: enough stock to revert every item ───────────────────
  IF v_warehouse_id IS NOT NULL THEN
    FOR v_item IN
      SELECT
        product_id,
        quantity                               AS qty_paid,
        COALESCE(quantity_bonus, 0)            AS qty_bonus,
        COALESCE(base_qty, 1)                  AS base_qty,
        COALESCE(line_total, 0)                AS line_total
      FROM public.purchase_order_items
     WHERE purchase_order_id = p_po_id
       AND tenant_id = p_tenant_id
    LOOP
      v_qty_received := v_item.qty_paid + v_item.qty_bonus;
      v_inv_qty      := v_qty_received * v_item.base_qty;

      SELECT COALESCE(quantity_on_hand, 0)
        INTO v_balance
        FROM public.inventory_balances
       WHERE tenant_id    = p_tenant_id
         AND warehouse_id = v_warehouse_id
         AND product_id   = v_item.product_id;

      IF v_balance < v_inv_qty THEN
        RAISE EXCEPTION
          'Stock insuficiente para anular: producto % requiere % u.base pero solo hay %.',
          v_item.product_id, v_inv_qty, v_balance;
      END IF;
    END LOOP;
  END IF;

  -- ── Mark order cancelled ─────────────────────────────────────────────────
  UPDATE public.purchase_orders
     SET status = 'cancelled'
   WHERE id = p_po_id AND tenant_id = p_tenant_id;

  -- ── Reverse each item ────────────────────────────────────────────────────
  FOR v_item IN
    SELECT
      product_id,
      quantity                               AS qty_paid,
      COALESCE(quantity_bonus, 0)            AS qty_bonus,
      COALESCE(base_qty, 1)                  AS base_qty,
      unit_cost,
      COALESCE(line_total, 0)                AS line_total
    FROM public.purchase_order_items
   WHERE purchase_order_id = p_po_id
     AND tenant_id = p_tenant_id
  LOOP
    v_base_qty     := v_item.base_qty;
    v_qty_received := v_item.qty_paid + v_item.qty_bonus;
    v_inv_qty      := v_qty_received * v_base_qty;

    -- cost_per_base: exact mirror of reception formula
    --   line_total / (qty_paid × base_qty)
    -- This is the cost per base unit that was stored in the receipt movement.
    IF (v_item.qty_paid * v_base_qty) > 0 THEN
      v_cost_per_base := v_item.line_total / (v_item.qty_paid * v_base_qty);
    ELSE
      v_cost_per_base := v_item.unit_cost / v_base_qty;  -- fallback: shouldn't happen
    END IF;

    -- Inventory movement: direction = -1, same quantity + unit_cost scale as reception
    INSERT INTO public.inventory_movements (
      tenant_id, warehouse_id, product_id,
      movement_type, quantity, unit_cost, reason,
      reference_type, reference_id, performed_by_user_id, direction
    ) VALUES (
      p_tenant_id, v_warehouse_id, v_item.product_id,
      'purchase_cancel', v_inv_qty, round(v_cost_per_base, 6), 'Anulación de compra',
      'purchase_order', p_po_id, v_user_id, -1
    );

    -- Physical balance
    IF v_warehouse_id IS NOT NULL THEN
      UPDATE public.inventory_balances
         SET quantity_on_hand = quantity_on_hand - v_inv_qty,
             updated_at = now()
       WHERE tenant_id    = p_tenant_id
         AND warehouse_id = v_warehouse_id
         AND product_id   = v_item.product_id;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_purchase_order(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_purchase_order(uuid, uuid) TO authenticated;
