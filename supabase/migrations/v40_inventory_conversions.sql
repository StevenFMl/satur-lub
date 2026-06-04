-- ============================================================
-- v40_inventory_conversions.sql
--
-- Fraccionamiento / conversión de inventario entre SKUs.
--
-- Tablas nuevas:
--   · product_conversion_rules  — factores de conversión válidos por tenant
--   · inventory_conversions     — registro inmutable de cada operación
--
-- Función nueva:
--   · convert_inventory(tenant, warehouse, src, dst, src_qty, dst_qty, notes)
--       → uuid (conversion_id)
--
-- Fixes aplicados antes de deploy:
--   1. RLS separada FOR SELECT / FOR INSERT en inventory_conversions
--   2. RLS completa en product_conversion_rules (read all, write owner/admin)
--   3. Validación de regla activa + ratio con tolerancia ±0.1 %
--   4. Denominador WAC global (SUM sobre todas las bodegas) — products.average_cost es global
--   5. Lock fila de bodega destino con PERFORM ... FOR UPDATE antes del UPSERT
--   6. DROP POLICY IF EXISTS antes de cada CREATE POLICY (idempotencia en re-deploy)
--   7. FOR UPDATE en SELECT del producto destino — average_cost leído y bloqueado
--      en el mismo paso; evita TOCTOU entre lectura y UPDATE del promedio ponderado
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- 1. product_conversion_rules
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.product_conversion_rules (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid          NOT NULL REFERENCES public.tenants(id),
  source_product_id uuid          NOT NULL,
  dest_product_id   uuid          NOT NULL,
  -- Unidades de destino por unidad de origen (ej: 1 galón → 4 cuartos → factor = 4)
  factor            numeric(12,6) NOT NULL CHECK (factor > 0),
  is_active         boolean       NOT NULL DEFAULT true,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT uq_conv_pair  UNIQUE  (tenant_id, source_product_id, dest_product_id),
  CONSTRAINT fk_conv_src   FOREIGN KEY (tenant_id, source_product_id)
                             REFERENCES public.products(tenant_id, id),
  CONSTRAINT fk_conv_dst   FOREIGN KEY (tenant_id, dest_product_id)
                             REFERENCES public.products(tenant_id, id),
  CONSTRAINT conv_no_self  CHECK (source_product_id <> dest_product_id)
);

CREATE INDEX IF NOT EXISTS idx_conv_rules_tenant
  ON public.product_conversion_rules(tenant_id);

CREATE INDEX IF NOT EXISTS idx_conv_rules_pair
  ON public.product_conversion_rules(tenant_id, source_product_id, dest_product_id);

ALTER TABLE public.product_conversion_rules ENABLE ROW LEVEL SECURITY;

-- Todos los miembros activos pueden leer (dialog de conversión necesita listar reglas)
DROP POLICY IF EXISTS conv_rules_select ON public.product_conversion_rules;
CREATE POLICY conv_rules_select ON public.product_conversion_rules
  FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_memberships
       WHERE user_id = auth.uid() AND is_active = true
    )
  );

-- Solo owner/admin pueden crear reglas
DROP POLICY IF EXISTS conv_rules_insert ON public.product_conversion_rules;
CREATE POLICY conv_rules_insert ON public.product_conversion_rules
  FOR INSERT
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_memberships
       WHERE user_id = auth.uid() AND is_active = true
         AND role IN ('owner', 'admin')
    )
  );

-- Solo owner/admin pueden desactivar / editar factor
DROP POLICY IF EXISTS conv_rules_update ON public.product_conversion_rules;
CREATE POLICY conv_rules_update ON public.product_conversion_rules
  FOR UPDATE
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_memberships
       WHERE user_id = auth.uid() AND is_active = true
         AND role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_memberships
       WHERE user_id = auth.uid() AND is_active = true
         AND role IN ('owner', 'admin')
    )
  );

-- Sin policy DELETE → operación denegada por defecto.
-- Para "eliminar" una regla se usa is_active = false.

-- ══════════════════════════════════════════════════════════════
-- 2. inventory_conversions  (registro inmutable)
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.inventory_conversions (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid          NOT NULL REFERENCES public.tenants(id),
  warehouse_id      uuid          NOT NULL REFERENCES public.warehouses(id),
  source_product_id uuid          NOT NULL,
  dest_product_id   uuid          NOT NULL,
  source_qty        numeric(12,4) NOT NULL CHECK (source_qty > 0),
  dest_qty          numeric(12,4) NOT NULL CHECK (dest_qty > 0),
  notes             text,
  performed_by      uuid          NOT NULL REFERENCES auth.users(id),
  converted_at      timestamptz   NOT NULL DEFAULT now(),
  created_at        timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT fk_iconv_src FOREIGN KEY (tenant_id, source_product_id)
                            REFERENCES public.products(tenant_id, id),
  CONSTRAINT fk_iconv_dst FOREIGN KEY (tenant_id, dest_product_id)
                            REFERENCES public.products(tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_inv_conv_tenant
  ON public.inventory_conversions(tenant_id);

CREATE INDEX IF NOT EXISTS idx_inv_conv_src
  ON public.inventory_conversions(tenant_id, source_product_id);

CREATE INDEX IF NOT EXISTS idx_inv_conv_dst
  ON public.inventory_conversions(tenant_id, dest_product_id);

CREATE INDEX IF NOT EXISTS idx_inv_conv_warehouse
  ON public.inventory_conversions(tenant_id, warehouse_id);

CREATE INDEX IF NOT EXISTS idx_inv_conv_converted_at
  ON public.inventory_conversions(tenant_id, converted_at DESC);

ALTER TABLE public.inventory_conversions ENABLE ROW LEVEL SECURITY;

-- SELECT: cualquier miembro activo del tenant puede leer el historial
DROP POLICY IF EXISTS inv_conv_select ON public.inventory_conversions;
CREATE POLICY inv_conv_select ON public.inventory_conversions
  FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_memberships
       WHERE user_id = auth.uid() AND is_active = true
    )
  );

-- INSERT: solo owner/admin pueden registrar conversiones directamente.
-- El RPC también enforce esto internamente (belt-and-suspenders).
DROP POLICY IF EXISTS inv_conv_insert ON public.inventory_conversions;
CREATE POLICY inv_conv_insert ON public.inventory_conversions
  FOR INSERT
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_memberships
       WHERE user_id = auth.uid() AND is_active = true
         AND role IN ('owner', 'admin')
    )
  );

-- Sin policies UPDATE ni DELETE → ambas operaciones denegadas.
-- inventory_conversions es un audit trail inmutable.

-- ══════════════════════════════════════════════════════════════
-- 3. convert_inventory
-- ══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.convert_inventory(uuid, uuid, uuid, uuid, numeric, numeric, text);

CREATE OR REPLACE FUNCTION public.convert_inventory(
  p_tenant_id         uuid,
  p_warehouse_id      uuid,
  p_source_product_id uuid,
  p_dest_product_id   uuid,
  p_source_qty        numeric,
  p_dest_qty          numeric,
  p_notes             text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id           uuid;
  v_is_privileged     boolean;
  v_factor            numeric(12,6);
  v_src_track         boolean;
  v_dst_track         boolean;
  v_src_balance       numeric(12,4);
  v_src_avg_cost      numeric(12,4);
  v_dst_avg_cost      numeric(12,4);
  v_dst_current_qty   numeric(12,4);
  v_allocated_cost    numeric(12,4);
  v_new_dst_avg_cost  numeric(12,4);
  v_conversion_id     uuid;
BEGIN
  -- ── 1. Authenticate ────────────────────────────────────────────────────────
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado.'; END IF;

  -- ── 2. Privilege check ─────────────────────────────────────────────────────
  SELECT CASE WHEN role IN ('owner', 'admin') THEN true ELSE false END
    INTO v_is_privileged
    FROM public.tenant_memberships
   WHERE tenant_id = p_tenant_id AND user_id = v_user_id AND is_active = true;

  IF v_is_privileged IS NULL THEN RAISE EXCEPTION 'Sin acceso a este tenant.'; END IF;
  IF NOT v_is_privileged    THEN RAISE EXCEPTION 'Sin permisos para convertir inventario.'; END IF;

  -- ── 3. Basic parameter validation ──────────────────────────────────────────
  IF p_source_qty <= 0 THEN
    RAISE EXCEPTION 'La cantidad de origen debe ser positiva.';
  END IF;
  IF p_dest_qty <= 0 THEN
    RAISE EXCEPTION 'La cantidad de destino debe ser positiva.';
  END IF;
  IF p_source_product_id = p_dest_product_id THEN
    RAISE EXCEPTION 'El producto origen y destino no pueden ser el mismo.';
  END IF;

  -- ── 3.5. Validate registered conversion rule + ratio ───────────────────────
  --
  -- Solo pares registrados en product_conversion_rules son válidos.
  -- La tolerancia del 0.1 % permite cantidades fraccionarias sin falsos positivos
  -- por punto flotante (ej: 0.5 galones → 2 cuartos con factor = 4.0).
  SELECT factor INTO v_factor
    FROM public.product_conversion_rules
   WHERE tenant_id         = p_tenant_id
     AND source_product_id = p_source_product_id
     AND dest_product_id   = p_dest_product_id
     AND is_active         = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe una regla de conversión activa para estos productos.';
  END IF;

  IF ABS((p_dest_qty / p_source_qty) - v_factor) > (v_factor * 0.001) THEN
    RAISE EXCEPTION
      'Cantidad destino inválida (%). Factor registrado: %. Para % unidades origen se esperan % unidades destino.',
      p_dest_qty, v_factor, p_source_qty, ROUND(p_source_qty * v_factor, 4);
  END IF;

  -- ── 4. Validate warehouse belongs to tenant and is active ───────────────────
  IF NOT EXISTS (
    SELECT 1 FROM public.warehouses
     WHERE id = p_warehouse_id AND tenant_id = p_tenant_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Bodega no encontrada o inactiva.';
  END IF;

  -- ── 5. Load source product (read-only) ─────────────────────────────────────
  SELECT COALESCE(track_inventory, false), COALESCE(average_cost, 0)
    INTO v_src_track, v_src_avg_cost
    FROM public.products
   WHERE id = p_source_product_id AND tenant_id = p_tenant_id AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto origen no encontrado o inactivo.';
  END IF;
  IF NOT v_src_track THEN
    RAISE EXCEPTION 'El producto origen no tiene control de inventario habilitado.';
  END IF;

  -- ── 5.5. Load + lock destination product ───────────────────────────────────
  --
  -- FOR UPDATE aquí sirve dos propósitos:
  --   a) Garantiza que leemos el average_cost más reciente antes de calcular WAC.
  --   b) Serializa dos conversiones concurrentes que apunten al mismo destino:
  --      la segunda leerá el average_cost ya actualizado por la primera.
  --
  -- Orden de locks en esta función:
  --   products[dest]          (este step)
  --   inventory_balances[src] (step 6)
  --   inventory_balances[dst] (step 6.5)
  -- Todas las transacciones respetan este orden → sin deadlock entre ellas.
  SELECT COALESCE(track_inventory, false), COALESCE(average_cost, 0)
    INTO v_dst_track, v_dst_avg_cost
    FROM public.products
   WHERE id = p_dest_product_id AND tenant_id = p_tenant_id AND is_active = true
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto destino no encontrado o inactivo.';
  END IF;
  IF NOT v_dst_track THEN
    RAISE EXCEPTION 'El producto destino no tiene control de inventario habilitado.';
  END IF;

  -- ── 6. Check source stock + lock source balance row ────────────────────────
  SELECT quantity_on_hand
    INTO v_src_balance
    FROM public.inventory_balances
   WHERE tenant_id    = p_tenant_id
     AND warehouse_id = p_warehouse_id
     AND product_id   = p_source_product_id
   FOR UPDATE;

  IF NOT FOUND THEN v_src_balance := 0; END IF;

  IF v_src_balance < p_source_qty THEN
    RAISE EXCEPTION
      'Stock insuficiente del producto origen. Disponible: %, solicitado: %.',
      v_src_balance, p_source_qty;
  END IF;

  -- ── 6.5. Lock destination balance row (no-op if it doesn't exist yet) ──────
  --
  -- Previene que dos conversiones concurrentes lean el mismo saldo del destino
  -- y calculen un WAC incorrecto por doble conteo en el denominador.
  -- Si la fila aún no existe el PERFORM no falla; el UPSERT posterior es atómico.
  PERFORM 1 FROM public.inventory_balances
   WHERE tenant_id    = p_tenant_id
     AND warehouse_id = p_warehouse_id
     AND product_id   = p_dest_product_id
   FOR UPDATE;

  -- ── 7. WAC calculation ─────────────────────────────────────────────────────
  --
  -- products.average_cost es GLOBAL (un valor por producto, no por bodega).
  -- El denominador es la cantidad total en TODAS las bodegas del tenant.
  -- v_dst_avg_cost fue leído bajo lock en step 5.5 → valor garantizado fresco.
  SELECT COALESCE(SUM(quantity_on_hand), 0)
    INTO v_dst_current_qty
    FROM public.inventory_balances
   WHERE tenant_id  = p_tenant_id
     AND product_id = p_dest_product_id;

  v_allocated_cost := v_src_avg_cost * p_source_qty;

  IF (v_dst_current_qty + p_dest_qty) > 0 THEN
    v_new_dst_avg_cost :=
      ( (v_dst_current_qty * v_dst_avg_cost) + v_allocated_cost )
      / (v_dst_current_qty + p_dest_qty);
  ELSE
    v_new_dst_avg_cost := CASE
      WHEN p_dest_qty > 0 THEN v_allocated_cost / p_dest_qty
      ELSE 0
    END;
  END IF;

  -- ── 8. Record conversion (audit trail) ─────────────────────────────────────
  INSERT INTO public.inventory_conversions (
    tenant_id, warehouse_id,
    source_product_id, dest_product_id,
    source_qty, dest_qty,
    notes, performed_by
  ) VALUES (
    p_tenant_id, p_warehouse_id,
    p_source_product_id, p_dest_product_id,
    p_source_qty, p_dest_qty,
    NULLIF(trim(COALESCE(p_notes, '')), ''), v_user_id
  )
  RETURNING id INTO v_conversion_id;

  -- ── 9. Inventory movements (dos entradas ligadas por reference_id) ──────────
  INSERT INTO public.inventory_movements (
    tenant_id, warehouse_id, product_id,
    movement_type, quantity, reason,
    direction, reference_type, reference_id, performed_by_user_id
  ) VALUES (
    p_tenant_id, p_warehouse_id, p_source_product_id,
    'conversion_out', p_source_qty, 'Conversión de inventario - salida',
    -1, 'conversion', v_conversion_id, v_user_id
  );

  INSERT INTO public.inventory_movements (
    tenant_id, warehouse_id, product_id,
    movement_type, quantity, reason,
    direction, reference_type, reference_id, performed_by_user_id
  ) VALUES (
    p_tenant_id, p_warehouse_id, p_dest_product_id,
    'conversion_in', p_dest_qty, 'Conversión de inventario - entrada',
    1, 'conversion', v_conversion_id, v_user_id
  );

  -- ── 10. Update inventory balances ──────────────────────────────────────────

  -- Deduct source (row already locked in step 6)
  UPDATE public.inventory_balances
     SET quantity_on_hand = quantity_on_hand - p_source_qty,
         updated_at       = now()
   WHERE tenant_id    = p_tenant_id
     AND warehouse_id = p_warehouse_id
     AND product_id   = p_source_product_id;

  -- Credit destination (upsert; row lock acquired in step 6.5)
  INSERT INTO public.inventory_balances (
    tenant_id, warehouse_id, product_id, quantity_on_hand
  ) VALUES (
    p_tenant_id, p_warehouse_id, p_dest_product_id, p_dest_qty
  )
  ON CONFLICT (tenant_id, warehouse_id, product_id)
  DO UPDATE SET
    quantity_on_hand = public.inventory_balances.quantity_on_hand + EXCLUDED.quantity_on_hand,
    updated_at       = now();

  -- ── 11. Update global average_cost on destination product ──────────────────
  -- Row was locked in step 5.5; no concurrent transaction can overwrite this.
  UPDATE public.products
     SET average_cost = ROUND(v_new_dst_avg_cost, 4),
         updated_at   = now()
   WHERE id        = p_dest_product_id
     AND tenant_id = p_tenant_id;

  RETURN v_conversion_id;
END;
$$;

REVOKE ALL  ON FUNCTION public.convert_inventory(uuid, uuid, uuid, uuid, numeric, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convert_inventory(uuid, uuid, uuid, uuid, numeric, numeric, text) TO authenticated;
