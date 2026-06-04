-- ============================================================
-- supabase/migrations/v41_work_orders.sql
-- ============================================================

-- ── 1. Tabla de Órdenes de Trabajo (work_orders) ──────────────────────────

CREATE TABLE IF NOT EXISTS public.work_orders (
  id              uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  branch_id       uuid,
  customer_id     uuid           NOT NULL,
  vehicle_id      uuid,
  mileage         numeric(12,2)  CHECK (mileage >= 0),
  status          text           NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'awaiting_approval', 'in_progress', 'completed', 'billed', 'cancelled')),
  notes           text,
  total           numeric(12,2)  NOT NULL DEFAULT 0.00 CHECK (total >= 0),
  created_by      uuid,
  created_at      timestamptz    NOT NULL DEFAULT now(),
  updated_at      timestamptz    NOT NULL DEFAULT now(),

  -- Constraint UNIQUE para posibilitar FKs compuestas en detalles de forma segura
  CONSTRAINT uq_work_orders_tenant_id UNIQUE (tenant_id, id),

  -- FK Compuesta de integridad física corporativa para el cliente
  CONSTRAINT fk_work_orders_customer FOREIGN KEY (tenant_id, customer_id)
    REFERENCES public.business_partners (tenant_id, id) ON DELETE RESTRICT,

  -- FK Simple para vehículos (no posee UNIQUE (tenant_id, id) en el esquema base de vehículos)
  CONSTRAINT fk_work_orders_vehicle FOREIGN KEY (vehicle_id)
    REFERENCES public.vehicles (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_work_orders_tenant_status
  ON public.work_orders (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_work_orders_tenant_vehicle
  ON public.work_orders (tenant_id, vehicle_id)
  WHERE vehicle_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_work_orders_tenant_customer
  ON public.work_orders (tenant_id, customer_id);

-- Trigger updated_at (ejecutado en último orden alfabético)
DROP TRIGGER IF EXISTS z_trg_work_orders_updated_at ON public.work_orders;
CREATE TRIGGER z_trg_work_orders_updated_at
  BEFORE UPDATE ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ── 2. Tabla de Ítems de Órdenes de Trabajo (work_order_items) ──────────────

CREATE TABLE IF NOT EXISTS public.work_order_items (
  id                uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  work_order_id     uuid           NOT NULL,
  product_id        uuid,          -- NULL si es un repuesto o servicio manual
  item_name         text           NOT NULL,
  quantity          numeric(12,4)  NOT NULL CHECK (quantity > 0),
  unit_price        numeric(12,2)  NOT NULL CHECK (unit_price >= 0),
  discount_amount   numeric(12,2)  NOT NULL DEFAULT 0.00 CHECK (discount_amount >= 0),
  line_total        numeric(12,2)  NOT NULL DEFAULT 0.00 CHECK (line_total >= 0),
  technician_id     uuid,          -- Técnico asignado para ejecutar esta línea
  created_at        timestamptz    NOT NULL DEFAULT now(),

  -- Columnas reservadas para arquitectura futura de stock
  stock_reserved    boolean        NOT NULL DEFAULT false,
  reserved_quantity numeric(12,4)  NOT NULL DEFAULT 0.0000 CHECK (reserved_quantity >= 0),

  -- FK compuesta estricta para asegurar alineación de tenant
  CONSTRAINT fk_work_order_items_work_order FOREIGN KEY (tenant_id, work_order_id)
    REFERENCES public.work_orders (tenant_id, id) ON DELETE CASCADE,

  -- FK compuesta estricta con products (posee UNIQUE (tenant_id, id) en db.sql)
  CONSTRAINT fk_work_order_items_product FOREIGN KEY (tenant_id, product_id)
    REFERENCES public.products (tenant_id, id) ON DELETE RESTRICT,

  -- FK compuesta estricta con technicians (posee UNIQUE (tenant_id, id) en db.sql)
  CONSTRAINT fk_work_order_items_technician FOREIGN KEY (tenant_id, technician_id)
    REFERENCES public.technicians (tenant_id, id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_work_order_items_order
  ON public.work_order_items (tenant_id, work_order_id);


-- ── 3. Triggers de Validación de Negocio e Integridad Física (BEFORE) ────────

-- A. Validaciones de relaciones y máquina de estados robusta (BEFORE UPDATE/INSERT)
CREATE OR REPLACE FUNCTION public.fn_validate_work_orders_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 1. Prevenir alteración del tenant_id
  IF TG_OP = 'UPDATE' AND OLD.tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'No está permitido cambiar el tenant_id de una orden de trabajo.';
  END IF;

  -- 2. Validar que el vehículo (si existe) pertenezca estrictamente al mismo tenant
  IF NEW.vehicle_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.vehicles
     WHERE id = NEW.vehicle_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'El vehículo asignado no pertenece al tenant de esta orden de trabajo.';
  END IF;

  -- 3. Reglas de transición de estados y bloqueo de edición
  IF TG_OP = 'UPDATE' THEN
    -- A. Bloquear cambios si la orden está en estado terminal (billed, cancelled)
    IF OLD.status IN ('billed', 'cancelled') THEN
      IF ROW(OLD.status, OLD.customer_id, OLD.vehicle_id, OLD.mileage, OLD.total, OLD.notes) IS DISTINCT FROM ROW(NEW.status, NEW.customer_id, NEW.vehicle_id, NEW.mileage, NEW.total, NEW.notes) THEN
        RAISE EXCEPTION 'No se puede modificar una orden de trabajo en estado terminal %.', OLD.status;
      END IF;
    END IF;

    -- B. Congelación operativa al completar (status = completed)
    -- Se excluye 'total' y 'updated_at' de la comparación para permitir actualizaciones internas automáticas
    -- y asegurar que no haya conflicto circular con el trigger de totales en items.
    IF OLD.status = 'completed' THEN
      IF ROW(OLD.customer_id, OLD.vehicle_id, OLD.mileage) IS DISTINCT FROM ROW(NEW.customer_id, NEW.vehicle_id, NEW.mileage) THEN
        RAISE EXCEPTION 'Trabajo terminado y congelado. Solo se permiten editar observaciones/notas.';
      END IF;
    END IF;

    -- C. Validación determinista de la máquina de estados
    IF OLD.status <> NEW.status THEN
      IF OLD.status = 'open' AND NEW.status NOT IN ('awaiting_approval', 'in_progress', 'cancelled') THEN
        RAISE EXCEPTION 'Transición de estado inválida desde open hacia %.', NEW.status;
      ELSIF OLD.status = 'awaiting_approval' AND NEW.status NOT IN ('in_progress', 'cancelled') THEN
        RAISE EXCEPTION 'Transición de estado inválida desde awaiting_approval hacia %.', NEW.status;
      ELSIF OLD.status = 'in_progress' AND NEW.status NOT IN ('completed', 'cancelled') THEN
        RAISE EXCEPTION 'Transición de estado inválida desde in_progress hacia %.', NEW.status;
      ELSIF OLD.status = 'completed' AND NEW.status NOT IN ('billed', 'cancelled') THEN
        RAISE EXCEPTION 'Transición de estado inválida desde completed hacia %.', NEW.status;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Prefijo a_ para forzar ejecución prioritaria sobre el trigger updated_at
DROP TRIGGER IF EXISTS a_trg_work_orders_validate_integrity ON public.work_orders;
CREATE TRIGGER a_trg_work_orders_validate_integrity
  BEFORE INSERT OR UPDATE ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.fn_validate_work_orders_integrity();


-- B. Calcular e inmutabilizar line_total en ITEMS antes de guardar
CREATE OR REPLACE FUNCTION public.fn_calculate_work_order_item_line_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_status text;
BEGIN
  -- 1. Consultar estado actual de la cabecera
  SELECT status INTO v_order_status
    FROM public.work_orders
   WHERE id = NEW.work_order_id AND tenant_id = NEW.tenant_id;

  -- 2. Bloquear cualquier modificación física de ítems si la OT ya no es editable
  IF v_order_status IN ('completed', 'billed', 'cancelled') THEN
    RAISE EXCEPTION 'No se pueden agregar o modificar ítems de una orden de trabajo en estado %.', v_order_status;
  END IF;

  -- 3. Calcular matemáticamente line_total (ignora importes manuales del frontend/API)
  NEW.line_total := ROUND(
    (NEW.quantity * NEW.unit_price) - COALESCE(NEW.discount_amount, 0),
    2
  );
  
  IF NEW.line_total < 0 THEN
    NEW.line_total := 0.00;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS a_trg_work_order_items_calculate_line_total ON public.work_order_items;
CREATE TRIGGER a_trg_work_order_items_calculate_line_total
  BEFORE INSERT OR UPDATE ON public.work_order_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_calculate_work_order_item_line_total();


-- C. Bloquear eliminaciones físicas de ítems en estados no editables
CREATE OR REPLACE FUNCTION public.fn_prevent_work_order_item_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_status text;
BEGIN
  SELECT status INTO v_order_status
    FROM public.work_orders
   WHERE id = OLD.work_order_id AND tenant_id = OLD.tenant_id;

  IF v_order_status IN ('completed', 'billed', 'cancelled') THEN
    RAISE EXCEPTION 'No se pueden eliminar ítems de una orden de trabajo en estado %.', v_order_status;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS a_trg_work_order_items_prevent_delete ON public.work_order_items;
CREATE TRIGGER a_trg_work_order_items_prevent_delete
  BEFORE DELETE ON public.work_order_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_work_order_item_delete();


-- ── 4. Trigger de Sincronización Atómica de Totales (AFTER) ──────────────────

CREATE OR REPLACE FUNCTION public.fn_sync_work_orders_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 1. Si es INSERT o UPDATE (recalcular NEW si existe)
  -- TG_OP es evaluado de forma segura y se previene acceder a NEW en DELETE
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.work_order_id IS NOT NULL THEN
    UPDATE public.work_orders
       SET total = (
             SELECT COALESCE(SUM(line_total), 0.00)
               FROM public.work_order_items
              WHERE work_order_id = NEW.work_order_id AND tenant_id = NEW.tenant_id
           ),
           updated_at = now()
     WHERE id = NEW.work_order_id AND tenant_id = NEW.tenant_id;
  END IF;

  -- 2. Si es DELETE o UPDATE con reasignación (recalcular OLD si la orden cambió o se eliminó la línea)
  IF TG_OP = 'DELETE' AND OLD.work_order_id IS NOT NULL THEN
    UPDATE public.work_orders
       SET total = (
             SELECT COALESCE(SUM(line_total), 0.00)
               FROM public.work_order_items
              WHERE work_order_id = OLD.work_order_id AND tenant_id = OLD.tenant_id
           ),
           updated_at = now()
     WHERE id = OLD.work_order_id AND tenant_id = OLD.tenant_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.work_order_id IS NOT NULL AND OLD.work_order_id <> NEW.work_order_id THEN
    UPDATE public.work_orders
       SET total = (
             SELECT COALESCE(SUM(line_total), 0.00)
               FROM public.work_order_items
              WHERE work_order_id = OLD.work_order_id AND tenant_id = OLD.tenant_id
           ),
           updated_at = now()
     WHERE id = OLD.work_order_id AND tenant_id = OLD.tenant_id;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS a_trg_work_order_items_sync_order_total ON public.work_order_items;
CREATE TRIGGER a_trg_work_order_items_sync_order_total
  AFTER INSERT OR UPDATE OR DELETE ON public.work_order_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_work_orders_total();


-- ── 5. Modificación Aditiva en Ventas (sales) ────────────────────────────────

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS work_order_id uuid
    REFERENCES public.work_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sales_work_order
  ON public.sales (tenant_id, work_order_id)
  WHERE work_order_id IS NOT NULL;


-- ── 6. Seguridad y Aislamiento Multi-Tenant (RLS con WITH CHECK) ────────────

ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_items ENABLE ROW LEVEL SECURITY;

-- Políticas para work_orders
DROP POLICY IF EXISTS "tenant_members_select_work_orders" ON public.work_orders;
CREATE POLICY "tenant_members_select_work_orders"
  ON public.work_orders FOR SELECT TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_memberships tm
       WHERE tm.user_id = auth.uid() AND tm.is_active = true
    )
  );

DROP POLICY IF EXISTS "tenant_members_insert_work_orders" ON public.work_orders;
CREATE POLICY "tenant_members_insert_work_orders"
  ON public.work_orders FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_memberships tm
       WHERE tm.user_id = auth.uid() AND tm.is_active = true
    )
  );

DROP POLICY IF EXISTS "tenant_members_update_work_orders" ON public.work_orders;
CREATE POLICY "tenant_members_update_work_orders"
  ON public.work_orders FOR UPDATE TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_memberships tm
       WHERE tm.user_id = auth.uid() AND tm.is_active = true
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_memberships tm
       WHERE tm.user_id = auth.uid() AND tm.is_active = true
    )
  );

-- Políticas para work_order_items
DROP POLICY IF EXISTS "tenant_members_select_work_order_items" ON public.work_order_items;
CREATE POLICY "tenant_members_select_work_order_items"
  ON public.work_order_items FOR SELECT TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_memberships tm
       WHERE tm.user_id = auth.uid() AND tm.is_active = true
    )
  );

DROP POLICY IF EXISTS "tenant_members_insert_work_order_items" ON public.work_order_items;
CREATE POLICY "tenant_members_insert_work_order_items"
  ON public.work_order_items FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_memberships tm
       WHERE tm.user_id = auth.uid() AND tm.is_active = true
    )
  );

DROP POLICY IF EXISTS "tenant_members_update_work_order_items" ON public.work_order_items;
CREATE POLICY "tenant_members_update_work_order_items"
  ON public.work_order_items FOR UPDATE TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_memberships tm
       WHERE tm.user_id = auth.uid() AND tm.is_active = true
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_memberships tm
       WHERE tm.user_id = auth.uid() AND tm.is_active = true
    )
  );

DROP POLICY IF EXISTS "tenant_members_delete_work_order_items" ON public.work_order_items;
CREATE POLICY "tenant_members_delete_work_order_items"
  ON public.work_order_items FOR DELETE TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_memberships tm
       WHERE tm.user_id = auth.uid() AND tm.is_active = true
    )
  );


-- ── 7. Permisos / Superficie de Escritura Externa ────────────────────────────

-- Revocación de DELETE física sobre la cabecera. Una OT no se elimina, se cancela comercialmente.
REVOKE ALL ON public.work_orders FROM public, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.work_orders TO authenticated;

-- Edición flexible de presupuesto en items
REVOKE ALL ON public.work_order_items FROM public, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_order_items TO authenticated;
