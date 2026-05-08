# Arquitectura de Inventario y Compras - SaturLub

Este documento describe la arquitectura, flujo de datos, lógica matemática y reglas de negocio del módulo de Inventario y Compras en el sistema SaturLub. Su propósito es servir como la fuente de verdad técnica para desarrolladores e IAs que trabajen en este dominio.

## 1. Filosofía y Principios de Diseño

1. **Atomicidad en Base de Datos**: Las operaciones que afectan el stock físico (como compras, ajustes, ventas) siempre modifican dos tablas: `inventory_movements` (el historial/kardex) y `inventory_balances` (el saldo consolidado). Esto se hace exclusivamente a través de **procedimientos almacenados (RPCs)** para asegurar que una transacción sea 100% atómica. Nunca se deben hacer inserciones/actualizaciones secuenciales en el backend (Next.js).
2. **Precisión Matemática Estricta**: Todas las operaciones financieras (costos, impuestos, subtotales, totales) se realizan usando la librería `big.js` en el Frontend y tipos `NUMERIC` en PostgreSQL. Se evitan los flotantes nativos (`number` en JS / `float` en SQL) para prevenir errores de redondeo.
3. **Flujo Cero Fricción (Omnicanalidad en UI)**: La interfaz está optimizada para la creación de datos "al vuelo" o "in-place". El usuario no debe abandonar su flujo de trabajo (ej. registrar una factura de compra) para crear un producto faltante o editar uno existente.
4. **Multitenancy**: Todas las entidades incluyen un `tenant_id` obligatorio. El control de acceso a nivel de fila (RLS) garantiza el aislamiento entre diferentes clientes/organizaciones en la misma base de datos.

---

## 2. Modelado de Base de Datos (Esquema)

### 2.1 Tablas Principales

- **`products`** (Catálogo Maestro)
  - `tenant_id` (UUID)
  - `id` (UUID, PK)
  - `name` (VARCHAR)
  - `sku` (VARCHAR, UNIQUE)
  - `unit` (VARCHAR): galón, litro, caneca, unidad, etc.
  - `cost_price` (NUMERIC): Costo referencial (base imponible).
  - `tax_rate` (NUMERIC): Impuesto aplicable (ej. 15.00 o 0.00).

- **`warehouses`** (Bodegas)
  - `tenant_id` (UUID)
  - `id` (UUID, PK)
  - `branch_id` (UUID): FK a Sucursal.
  - `name` (VARCHAR)

- **`purchases` & `purchase_items`** (Ingresos)
  - Representa el documento cabecera de la factura de compra y su detalle.

- **`inventory_movements`** (Kardex / Historial)
  - Registra el movimiento atómico individual (+ o -).
  - Tipo: `PURCHASE`, `SALE`, `ADJUSTMENT`, `TRANSFER`.

- **`inventory_balances`** (Saldo Consolidado)
  - Clave única compuesta: `(tenant_id, warehouse_id, product_id)`.
  - Representa el stock físico actual.

### 2.2 Procedimientos Almacenados (RPC)

Para garantizar la consistencia, se han migrado lógicas transaccionales complejas desde el *Application Layer* hacia el *Database Layer*:

- **`public.record_stock_adjustment`**:
  Toma los datos del ajuste (Bodega, Producto, Cantidad, Costo). Inserta el movimiento (Entrada manual) en `inventory_movements` y actualiza/inserta atómicamente el acumulado en `inventory_balances`. Este RPC se emplea para Saldos Iniciales o Correcciones.

- **`public.receive_purchase`**:
  Procesa de forma atómica la factura de compra. Inserta la cabecera, inserta las líneas de detalle (`purchase_items`), e invoca la lógica de stock para asentar el inventario según la bodega de destino.

---

## 3. Lógica Matemática (Frontend & Backend)

Se emplean funciones abstraídas en `src/lib/math.ts` que hacen uso de `big.js`.

### 3.1 Manejo de Precisión
- **Costo Unitario (4 decimales)**: Conserva fracciones diminutas necesarias para dividir bultos grandes en unidades pequeñas.
- **Totales Financieros (2 decimales)**: Subtotal, Montos de IVA y Total Factura siempre se redondean a 2 decimales para compatibilidad bancaria y tributaria.

### 3.2 IVA por Línea de Producto (Granular)
El cálculo de impuestos ya no es global. 
- Cada fila de compra consulta el `tax_rate` almacenado en el perfil del producto.
- El Subtotal suma el `total_cost` (neto) de todas las filas.
- El IVA Total se obtiene calculando el impuesto fila por fila exclusivamente para aquellos productos donde `tax_rate > 0`.
- Esto permite la coexistencia en una misma factura de productos con IVA 0% e IVA 15%.

---

## 4. Flujo de Experiencia de Usuario (UI/UX)

### 4.1 "Omni-Buscador" (Cabecera de Compras)
En la pantalla de Ingreso de Compras (`purchase-form.tsx`), en lugar de inserciones manuales engorrosas, se dispone de una barra de búsqueda/escáner:
- Reacciona dinámicamente (`onChange`).
- Si encuentra un SKU exacto (Scanner) o si el usuario selecciona con `Enter` un producto de la lista, inyecta la fila al carrito automáticamente.
- Si la fila ya existe, incrementa la cantidad en `+1`.
- Retorna el enfoque (`focus`) inmediatamente para escanear el siguiente producto ininterrumpidamente.

### 4.2 Creación y Edición "In-Place"
- **Crear**: Botón "Crear Producto Rápido" invoca un Dialog (`QuickCreateProductDialog`) sin salir de la vista de Compras. Exige sólo datos mínimos (Nombre, SKU, Unidad, Costo, IVA). Tras guardar, el producto se añade al "Catálogo Local" (`localProducts`) y se inyecta automáticamente al carrito.
- **Editar**: Cada fila del carrito incluye un botón "Pencil" que reabre el mismo Dialog en modo edición. Los cambios se actualizan en Base de Datos e instantáneamente en el catálogo temporal (`localProducts`) de la tabla de compras sin requerir un recargo completo de la página.

### 4.3 Ajustes / Saldo Inicial
En la pestaña de **Stock / Kárdex**:
- Un botón **"Ajuste / Saldo Inicial"** levanta un modal para ingresar stock directo (`InitialBalanceDialog`).
- Al ejecutarse, envía los datos al Server Action `createInitialBalanceAction`, el cual invoca el RPC atómico de ajuste y refleja inmediatamente la nueva existencia.

---

## 5. Resumen del Árbol de Componentes Clave

- `src/actions/products.ts`: Contiene la mutación `quickCreateProductAction` (maneja `insert` y `update`).
- `src/actions/inventory.ts`: Contiene `createInitialBalanceAction` que conecta con `record_stock_adjustment`.
- `src/app/(dashboard)/dashboard/compras/nueva/purchase-form.tsx`: Célula principal de la lógica Omni-Buscador, Carrito de Compras y matemáticas de `big.js`.
- `src/app/(dashboard)/dashboard/compras/nueva/quick-create-product-dialog.tsx`: Modal para inyección *in-place* de nuevos SKUs y edición.
- `src/app/(dashboard)/dashboard/inventario/stock/stock-table.tsx`: Tabla maestra de stock con Micro-Kárdex e ingreso de Saldo Inicial.
- `supabase/migrations/stock_adjustment.sql`: Lógica de base de datos para garantizar que el saldo final en `inventory_balances` corresponda fehacientemente a la sumatoria de movimientos en `inventory_movements`.
