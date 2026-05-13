-- ============================================================
-- v9_customer_receivables.sql
--
-- Soporte para ventas FIADAS con abonos (cuenta corriente cliente).
--
-- Nuevas tablas:
--   customer_receivables          — una fila por venta fiada
--   customer_receivable_payments  — historial de abonos
--
-- Nuevos RPCs:
--   add_receivable_payment        — registrar abono posterior
--
-- Nueva vista:
--   v_customer_receivables        — saldos con estado dinámico
--
-- Modificación de create_sale:
--   Añade parámetros opcionales p_is_credit, p_initial_payment, etc.
--   Retrocompatible: DEFAULT NULL/false en todos los nuevos params.
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- 1. customer_receivables
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.customer_receivables (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid          NOT NULL REFERENCES public.tenants(id)  ON DELETE CASCADE,
  sale_id       uuid          NOT NULL REFERENCES public.sales(id)    ON DELETE RESTRICT,
  customer_id   uuid          NOT NULL,
  total_amount  numeric(12,2) NOT NULL CHECK (total_amount > 0),
  paid_amount   numeric(12,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  balance_due   numeric(12,2) GENERATED ALWAYS AS (total_amount - paid_amount) STORED,
  status        text          NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','partial','paid','overdue','cancelled')),
  due_date      date,
  notes         text,
  created_by    uuid          NOT NULL,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT uq_receivable_sale UNIQUE (sale_id)
);

ALTER TABLE public.customer_receivables
  ADD COLUMN IF NOT EXISTS due_date   date,
  ADD COLUMN IF NOT EXISTS notes      text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_receivables_tenant_customer
  ON public.customer_receivables(tenant_id, customer_id);

CREATE INDEX IF NOT EXISTS idx_receivables_status
  ON public.customer_receivables(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_receivables_due_date
  ON public.customer_receivables(tenant_id, due_date)
  WHERE status NOT IN ('paid','cancelled');

ALTER TABLE public.customer_receivables ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'customer_receivables'
       AND policyname = 'receivables_tenant_access'
  ) THEN
    CREATE POLICY "receivables_tenant_access" ON public.customer_receivables
      FOR ALL
      USING (
        tenant_id IN (
          SELECT tenant_id FROM public.tenant_memberships
           WHERE user_id = auth.uid() AND is_active = true
        )
      )
      WITH CHECK (
        tenant_id IN (
          SELECT tenant_id FROM public.tenant_memberships
           WHERE user_id = auth.uid() AND is_active = true
        )
      );
  END IF;
END $$;


-- ══════════════════════════════════════════════════════════════
-- 2. customer_receivable_payments
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.customer_receivable_payments (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid          NOT NULL REFERENCES public.tenants(id)              ON DELETE CASCADE,
  receivable_id   uuid          NOT NULL REFERENCES public.customer_receivables(id) ON DELETE RESTRICT,
  amount          numeric(12,2) NOT NULL CHECK (amount > 0),
  payment_method  text          NOT NULL
                    CHECK (payment_method IN ('cash','card','transfer')),
  payment_date    date          NOT NULL DEFAULT CURRENT_DATE,
  reference       text,
  notes           text,
  registered_by   uuid          NOT NULL,
  created_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_receivable_payments_receivable
  ON public.customer_receivable_payments(tenant_id, receivable_id);

ALTER TABLE public.customer_receivable_payments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'customer_receivable_payments'
       AND policyname = 'rec_payments_tenant_access'
  ) THEN
    CREATE POLICY "rec_payments_tenant_access" ON public.customer_receivable_payments
      FOR ALL
      USING (
        tenant_id IN (
          SELECT tenant_id FROM public.tenant_memberships
           WHERE user_id = auth.uid() AND is_active = true
        )
      )
      WITH CHECK (
        tenant_id IN (
          SELECT tenant_id FROM public.tenant_memberships
           WHERE user_id = auth.uid() AND is_active = true
        )
      );
  END IF;
END $$;


-- ══════════════════════════════════════════════════════════════
-- 3. Vista v_customer_receivables
-- ══════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS public.v_customer_receivables;

CREATE VIEW public.v_customer_receivables
WITH (security_invoker = true)
AS
SELECT
  cr.id,
  cr.tenant_id,
  cr.sale_id,
  cr.customer_id,
  bp.full_name        AS customer_name,
  bp.document_number  AS customer_document,
  bp.phone            AS customer_phone,
  s.sale_date,
  s.document_kind,
  cr.total_amount,
  cr.paid_amount,
  cr.balance_due,
  cr.status,
  cr.due_date,
  -- is_overdue calculado en tiempo real
  CASE
    WHEN cr.due_date IS NOT NULL
     AND cr.due_date < CURRENT_DATE
     AND cr.status NOT IN ('paid','cancelled')
    THEN true
    ELSE false
  END AS is_overdue,
  cr.notes,
  cr.created_by,
  cr.created_at,
  cr.updated_at
FROM public.customer_receivables cr
JOIN public.sales s
  ON s.id = cr.sale_id
JOIN public.business_partners bp
  ON bp.id = cr.customer_id
 AND bp.tenant_id = cr.tenant_id;

GRANT SELECT ON public.v_customer_receivables TO authenticated;


-- ══════════════════════════════════════════════════════════════
-- 4. RPC add_receivable_payment
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.add_receivable_payment(
  p_tenant_id       uuid,
  p_receivable_id   uuid,
  p_amount          numeric,
  p_payment_method  text,
  p_payment_date    date    DEFAULT CURRENT_DATE,
  p_reference       text    DEFAULT NULL,
  p_notes           text    DEFAULT NULL,
  p_cash_session_id uuid    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id      uuid := auth.uid();
  v_rec          record;
  v_new_paid     numeric(12,2);
  v_new_balance  numeric(12,2);
  v_new_status   text;
  v_payment_id   uuid;
  v_sess_status  text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM tenant_memberships
     WHERE tenant_id = p_tenant_id AND user_id = v_user_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Sin acceso a este tenant.';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'El monto del abono debe ser mayor que cero.';
  END IF;

  IF p_payment_method NOT IN ('cash','card','transfer') THEN
    RAISE EXCEPTION 'Método de pago inválido: %.', p_payment_method;
  END IF;

  -- Bloquear la fila de la cuenta por cobrar
  SELECT cr.*, cr.balance_due AS bal
    INTO v_rec
    FROM customer_receivables cr
   WHERE cr.id = p_receivable_id AND cr.tenant_id = p_tenant_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cuenta por cobrar no encontrada.';
  END IF;

  IF v_rec.status = 'paid' THEN
    RAISE EXCEPTION 'Esta cuenta ya está completamente pagada.';
  END IF;

  IF v_rec.status = 'cancelled' THEN
    RAISE EXCEPTION 'Esta cuenta está cancelada.';
  END IF;

  IF p_amount > v_rec.bal THEN
    RAISE EXCEPTION 'El abono ($%) supera el saldo pendiente ($%). Ingresa un monto menor o igual al saldo.',
      p_amount, v_rec.bal;
  END IF;

  -- Validar sesión de caja si se provee
  IF p_cash_session_id IS NOT NULL THEN
    SELECT status INTO v_sess_status
      FROM cash_sessions
     WHERE id = p_cash_session_id AND tenant_id = p_tenant_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sesión de caja no encontrada.'; END IF;
    IF v_sess_status <> 'open' THEN RAISE EXCEPTION 'La sesión de caja no está abierta.'; END IF;
  END IF;

  -- Registrar abono
  INSERT INTO customer_receivable_payments (
    tenant_id, receivable_id, amount, payment_method,
    payment_date, reference, notes, registered_by
  ) VALUES (
    p_tenant_id, p_receivable_id, p_amount, p_payment_method,
    COALESCE(p_payment_date, CURRENT_DATE),
    NULLIF(trim(COALESCE(p_reference, '')), ''),
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    v_user_id
  )
  RETURNING id INTO v_payment_id;

  -- Actualizar totales
  v_new_paid    := v_rec.paid_amount + p_amount;
  v_new_balance := v_rec.total_amount - v_new_paid;

  IF v_new_balance <= 0 THEN
    v_new_status := 'paid';
  ELSIF v_rec.due_date IS NOT NULL AND v_rec.due_date < CURRENT_DATE THEN
    v_new_status := 'overdue';
  ELSE
    v_new_status := 'partial';
  END IF;

  UPDATE customer_receivables
     SET paid_amount = v_new_paid,
         status      = v_new_status,
         updated_at  = now()
   WHERE id = p_receivable_id AND tenant_id = p_tenant_id;

  -- Registrar en caja si pago en efectivo
  IF p_payment_method = 'cash' AND p_cash_session_id IS NOT NULL THEN
    INSERT INTO cash_movements (
      tenant_id, cash_session_id, movement_type, direction,
      amount, reason, reference_type, reference_id, created_by
    ) VALUES (
      p_tenant_id, p_cash_session_id, 'cash_in', 1,
      p_amount, 'Abono a cuenta por cobrar',
      'customer_receivable', p_receivable_id, v_user_id
    );
  END IF;

  RETURN v_payment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.add_receivable_payment FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_receivable_payment TO authenticated;


-- ══════════════════════════════════════════════════════════════
-- 5. create_sale — version v9 con soporte fiado
--    Retrocompatible: todos los params nuevos tienen DEFAULT.
-- ══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.create_sale(uuid,uuid,uuid,jsonb,jsonb,text,text,date,uuid);

CREATE OR REPLACE FUNCTION public.create_sale(
  p_tenant_id              uuid,
  p_customer_id            uuid,
  p_warehouse_id           uuid,
  p_items                  jsonb,
  p_payments               jsonb,
  p_notes                  text    DEFAULT NULL,
  p_document_kind          text    DEFAULT 'ticket',
  p_sale_date              date    DEFAULT NULL,
  p_cash_session_id        uuid    DEFAULT NULL,
  -- Parámetros de fiado (todos opcionales — retrocompatible)
  p_is_credit              boolean DEFAULT false,
  p_initial_payment        numeric DEFAULT NULL,
  p_initial_payment_method text    DEFAULT NULL,
  p_initial_payment_ref    text    DEFAULT NULL,
  p_due_date               date    DEFAULT NULL,
  p_credit_notes           text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id          uuid;
  v_sale_id          uuid;
  v_tier_id          uuid;
  v_is_privileged    boolean;
  v_item             jsonb;
  v_payment          jsonb;
  v_product_id       uuid;
  v_presentation_id  uuid;
  v_quantity         numeric(12,4);
  v_base_qty         numeric(12,4);
  v_inv_qty          numeric(12,4);
  v_discount         numeric(12,2);
  v_unit_price       numeric(12,2);
  v_original_price   numeric(12,2);
  v_override_price   numeric(12,2);
  v_override_type    text;
  v_override_reason  text;
  v_override_note    text;
  v_tax_rate         numeric(5,2);
  v_has_tax          boolean;
  v_track_inv        boolean;
  v_line_gross       numeric(12,2);
  v_line_net         numeric(12,2);
  v_line_iva         numeric(12,2);
  v_product_name     text;
  v_stock_avail      numeric(12,2);
  v_total_gross      numeric(12,2) := 0;
  v_total_net        numeric(12,2) := 0;
  v_total_iva        numeric(12,2) := 0;
  v_total_disc       numeric(12,2) := 0;
  v_pmt_total        numeric(12,2) := 0;
  v_cash_total       numeric(12,2) := 0;
  v_sess_status      text;
  v_sess_wh_id       uuid;
  v_credit_status    text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado.'; END IF;

  SELECT CASE WHEN role IN ('owner','admin') THEN true ELSE false END
    INTO v_is_privileged
    FROM tenant_memberships
   WHERE tenant_id = p_tenant_id AND user_id = v_user_id AND is_active = true;

  IF v_is_privileged IS NULL THEN RAISE EXCEPTION 'Sin acceso a este tenant.'; END IF;

  -- Validar sesión de caja
  IF p_cash_session_id IS NOT NULL THEN
    SELECT status, warehouse_id
      INTO v_sess_status, v_sess_wh_id
      FROM cash_sessions
     WHERE id = p_cash_session_id AND tenant_id = p_tenant_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sesión de caja no encontrada.'; END IF;
    IF v_sess_status <> 'open' THEN RAISE EXCEPTION 'La sesión de caja no está abierta.'; END IF;
    IF NOT (
      (v_sess_wh_id IS NULL     AND p_warehouse_id IS NULL) OR
      (v_sess_wh_id IS NOT NULL AND p_warehouse_id IS NOT NULL AND v_sess_wh_id = p_warehouse_id)
    ) THEN
      RAISE EXCEPTION 'La sesión de caja no corresponde a la bodega de esta venta.';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM business_partners
     WHERE id = p_customer_id AND tenant_id = p_tenant_id AND is_active = true
  ) THEN RAISE EXCEPTION 'Cliente no encontrado o inactivo.'; END IF;

  IF p_warehouse_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM warehouses WHERE id = p_warehouse_id AND tenant_id = p_tenant_id
  ) THEN RAISE EXCEPTION 'Bodega no válida.'; END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La venta requiere al menos un ítem.';
  END IF;

  -- Validaciones específicas de fiado
  IF p_is_credit THEN
    IF p_initial_payment IS NULL OR p_initial_payment < 0 THEN
      RAISE EXCEPTION 'Pago inicial inválido para venta fiada.';
    END IF;
    IF p_initial_payment > 0 AND p_initial_payment_method NOT IN ('cash','card','transfer') THEN
      RAISE EXCEPTION 'Método de pago inicial inválido.';
    END IF;
  END IF;

  SELECT id INTO v_tier_id FROM price_tiers
   WHERE tenant_id = p_tenant_id AND code = 'PUBLICO' LIMIT 1;

  -- Pre-validación de stock
  IF p_warehouse_id IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity   := (v_item->>'quantity')::numeric;
      v_base_qty   := COALESCE((v_item->>'base_qty')::numeric, 1);
      v_inv_qty    := v_quantity * v_base_qty;

      SELECT p.track_inventory, p.name INTO v_track_inv, v_product_name
        FROM products p
       WHERE p.id = v_product_id AND p.tenant_id = p_tenant_id AND p.is_active = true;

      IF v_product_name IS NULL THEN
        RAISE EXCEPTION 'Producto % no encontrado o inactivo.', v_product_id;
      END IF;

      IF v_track_inv THEN
        SELECT COALESCE(quantity_on_hand, 0) INTO v_stock_avail
          FROM inventory_balances
         WHERE product_id = v_product_id AND warehouse_id = p_warehouse_id AND tenant_id = p_tenant_id;
        v_stock_avail := COALESCE(v_stock_avail, 0);
        IF v_stock_avail < v_inv_qty THEN
          RAISE EXCEPTION 'Stock insuficiente para "%": disponible %, solicitado %.',
            v_product_name, v_stock_avail, v_inv_qty;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- Insertar cabecera de venta
  INSERT INTO sales (
    tenant_id, customer_id, warehouse_id, created_by_user_id,
    document_kind, status, notes, sale_date,
    subtotal, discount_total, tax_total, total
  ) VALUES (
    p_tenant_id, p_customer_id, p_warehouse_id, v_user_id,
    COALESCE(p_document_kind, 'ticket'), 'confirmed', p_notes,
    COALESCE(p_sale_date, CURRENT_DATE), 0, 0, 0, 0
  ) RETURNING id INTO v_sale_id;

  -- Insertar ítems
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id      := (v_item->>'product_id')::uuid;
    v_presentation_id := (v_item->>'presentation_id')::uuid;
    v_quantity        := (v_item->>'quantity')::numeric;
    v_base_qty        := COALESCE((v_item->>'base_qty')::numeric, 1);
    v_inv_qty         := v_quantity * v_base_qty;
    v_discount        := COALESCE((v_item->>'discount_amount')::numeric, 0);
    v_override_price  := NULLIF(v_item->>'override_unit_price', '')::numeric;
    v_override_type   := v_item->>'price_override_type';
    v_override_reason := v_item->>'price_override_reason';
    v_override_note   := v_item->>'price_override_note';

    SELECT COALESCE(pres.unit_price, pp.unit_price, p.default_price, 0),
           COALESCE(p.tax_rate, 15), COALESCE(p.has_tax, true),
           COALESCE(p.track_inventory, true), p.name
      INTO v_unit_price, v_tax_rate, v_has_tax, v_track_inv, v_product_name
      FROM products p
      LEFT JOIN product_prices pp
             ON pp.product_id = p.id AND pp.price_tier_id = v_tier_id
            AND pp.valid_to IS NULL AND pp.tenant_id = p_tenant_id
      LEFT JOIN product_presentations pres
             ON pres.id = v_presentation_id AND pres.product_id = p.id
            AND pres.tenant_id = p_tenant_id AND pres.is_active = true
     WHERE p.id = v_product_id AND p.tenant_id = p_tenant_id;

    IF v_override_price IS NOT NULL THEN
      IF v_override_price < 0 THEN
        RAISE EXCEPTION 'Precio de ajuste no puede ser negativo para "%".', v_product_name;
      END IF;
      IF trim(COALESCE(v_override_reason, '')) = '' THEN
        RAISE EXCEPTION 'Se requiere una razón al ajustar el precio de "%".', v_product_name;
      END IF;
      IF NOT v_is_privileged AND v_unit_price > 0 THEN
        IF v_override_price < v_unit_price * 0.70 THEN
          RAISE EXCEPTION 'Descuento máximo permitido es 30%% del precio de lista para "%".', v_product_name;
        END IF;
      END IF;
      v_original_price := v_unit_price;
      v_unit_price     := v_override_price;
    ELSE
      v_original_price := NULL;
    END IF;

    v_line_gross := GREATEST(ROUND(v_quantity * v_unit_price - v_discount, 2), 0);
    v_total_disc := v_total_disc + v_discount;

    IF v_has_tax AND v_tax_rate > 0 THEN
      v_line_net := ROUND(v_line_gross / (1 + v_tax_rate / 100), 2);
      v_line_iva := ROUND(v_line_gross - v_line_net, 2);
    ELSE
      v_line_net := v_line_gross;
      v_line_iva := 0;
    END IF;

    v_total_gross := v_total_gross + v_line_gross;
    v_total_net   := v_total_net   + v_line_net;
    v_total_iva   := v_total_iva   + v_line_iva;

    INSERT INTO sale_items (
      tenant_id, sale_id, product_id, presentation_id, base_qty,
      quantity, unit_price, discount_amount, tax_rate, line_total, is_taxable,
      original_unit_price, price_override_type, price_override_reason, price_override_note,
      price_override_by, price_override_at
    ) VALUES (
      p_tenant_id, v_sale_id, v_product_id, v_presentation_id, v_base_qty,
      v_quantity, v_unit_price, v_discount,
      CASE WHEN v_has_tax THEN v_tax_rate ELSE 0 END,
      v_line_gross, v_has_tax, v_original_price,
      v_override_type, v_override_reason, v_override_note,
      CASE WHEN v_original_price IS NOT NULL THEN v_user_id ELSE NULL END,
      CASE WHEN v_original_price IS NOT NULL THEN now()     ELSE NULL END
    );

    IF v_track_inv AND p_warehouse_id IS NOT NULL THEN
      INSERT INTO inventory_movements (
        tenant_id, warehouse_id, product_id, movement_type, quantity, reason,
        direction, reference_type, reference_id, performed_by_user_id
      ) VALUES (
        p_tenant_id, p_warehouse_id, v_product_id, 'sale', v_inv_qty, 'Venta POS',
        -1, 'sale', v_sale_id, v_user_id
      );
      UPDATE inventory_balances
         SET quantity_on_hand = quantity_on_hand - v_inv_qty, updated_at = now()
       WHERE tenant_id = p_tenant_id AND warehouse_id = p_warehouse_id AND product_id = v_product_id;
    END IF;
  END LOOP;

  UPDATE sales
     SET subtotal = v_total_net, discount_total = v_total_disc,
         tax_total = v_total_iva, total = v_total_gross
   WHERE id = v_sale_id;

  -- ── Manejo de pagos: normal vs fiado ────────────────────────
  IF p_is_credit THEN
    -- Venta fiada: pago inicial puede ser 0
    -- Validar que no supere el total
    IF p_initial_payment > v_total_gross THEN
      RAISE EXCEPTION 'El pago inicial ($%) supera el total de la venta ($%).',
        p_initial_payment, v_total_gross;
    END IF;

    -- Registrar pago inicial si es > 0
    IF p_initial_payment > 0 THEN
      INSERT INTO sale_payments (tenant_id, sale_id, payment_method, amount, reference)
      VALUES (p_tenant_id, v_sale_id,
              p_initial_payment_method, p_initial_payment,
              NULLIF(trim(COALESCE(p_initial_payment_ref, '')), ''));

      -- Registrar en caja si pago en efectivo
      IF p_initial_payment_method = 'cash' AND p_cash_session_id IS NOT NULL THEN
        INSERT INTO cash_movements (
          tenant_id, cash_session_id, movement_type, direction,
          amount, reason, reference_type, reference_id, created_by
        ) VALUES (
          p_tenant_id, p_cash_session_id, 'cash_in', 1,
          p_initial_payment, 'Abono inicial fiado', 'sale', v_sale_id, v_user_id
        );
      END IF;
    END IF;

    -- Calcular status inicial de la cuenta
    IF p_initial_payment >= v_total_gross THEN
      v_credit_status := 'paid';
    ELSIF p_initial_payment > 0 THEN
      v_credit_status := 'partial';
    ELSE
      v_credit_status := 'pending';
    END IF;

    -- Crear cuenta por cobrar
    INSERT INTO customer_receivables (
      tenant_id, sale_id, customer_id,
      total_amount, paid_amount, status,
      due_date, notes, created_by
    ) VALUES (
      p_tenant_id, v_sale_id, p_customer_id,
      v_total_gross, COALESCE(p_initial_payment, 0), v_credit_status,
      p_due_date,
      NULLIF(trim(COALESCE(p_credit_notes, '')), ''),
      v_user_id
    );

  ELSE
    -- Venta normal: pago debe cubrir el total
    FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
      v_pmt_total := v_pmt_total + COALESCE((v_payment->>'amount')::numeric, 0);
      IF v_payment->>'method' = 'cash' THEN
        v_cash_total := v_cash_total + COALESCE((v_payment->>'amount')::numeric, 0);
      END IF;
      INSERT INTO sale_payments (tenant_id, sale_id, payment_method, amount, reference)
      VALUES (p_tenant_id, v_sale_id,
              v_payment->>'method',
              (v_payment->>'amount')::numeric,
              v_payment->>'reference');
    END LOOP;

    IF v_pmt_total < v_total_gross - 0.01 THEN
      RAISE EXCEPTION 'Pago insuficiente: pagado $%, total $%.', v_pmt_total, v_total_gross;
    END IF;

    IF p_cash_session_id IS NOT NULL AND v_cash_total > 0 THEN
      INSERT INTO cash_movements (
        tenant_id, cash_session_id, movement_type, direction,
        amount, reason, reference_type, reference_id, created_by
      ) VALUES (
        p_tenant_id, p_cash_session_id, 'cash_in', 1,
        v_cash_total, 'Venta en efectivo', 'sale', v_sale_id, v_user_id
      );
    END IF;
  END IF;

  RETURN v_sale_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_sale FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_sale TO authenticated;
