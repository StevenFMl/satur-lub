


Prompt de Arquitectura SaaS Senior (Versión 2026)
​Rol: Actúa como un Senior Cloud Architect y Fullstack Developer experto en sistemas ERP Multi-tenant (SaaS).
​Objetivo: Diseñar la arquitectura técnica de "SaturnLub", un SaaS especializado en lubricadoras, mecánicas y distribuidores de repuestos. El sistema debe permitir que cualquier dueño de negocio se registre, configure su local y empiece a gestionar inventario y ventas.
​Stack Requerido:
​Backend: Node.js con NestJS (para asegurar modularidad y escalabilidad).
​Base de Datos: PostgreSQL en Supabase usando una arquitectura de "Shared Database, Isolated Schema" o Row Level Security (RLS) para multi-tenancy.
​Frontend: Next.js 15 (App Router) + Tailwind CSS.
​Requerimientos Críticos para el SaaS:
​Arquitectura Multi-tenant: * Explica cómo estructurar la base de datos para que la "Lubricadora A" nunca vea los datos de la "Mecánica B".
​Diseña la tabla de Tenants (Empresas) que incluya configuración de marca, tipo de contribuyente (Ecuador) y suscripción.
​Lógica Híbrida de Ventas e Identificación:
​El sistema debe identificar clientes por Cédula/RUC.
​Lógica de Precios: Define el esquema para que un producto tenga precio_minorista y precio_distribuidor. El sistema debe aplicar el precio según el perfil del cliente al ingresar la cédula.
​Documentos: Capacidad de generar Notas de Venta (formato ticket 80mm) y Facturación Electrónica (XML firmado) como módulos independientes.
​Gestión de Inventario Compleja:
​Soporte para Kits/Combos (Ej: Cambio de aceite que descuenta 4L de aceite y 1 filtro).
​Registro de movimientos de stock con auditoría (quién, cuándo y por qué).
​Estructura de Código (NestJS):
​Proporciona la estructura de carpetas siguiendo los principios de Clean Architecture.
​Sugiere cómo manejar los Webhooks para la facturación electrónica en Ecuador.
​Entregable: 1. Diagrama de Base de Datos (ERD) en Mermaid.
2. Guía paso a paso para implementar el aislamiento de datos (Multi-tenancy) de forma segura.
3. Recomendaciones para que los datos sean exportables a Power BI mediante una API segura para cada Tenant.
2 pasos completados
Sí: para SaturnLub te recomiendo una arquitectura SaaS multi-tenant con shared database + RLS como base, dejando schema-per-tenant solo para clientes enterprise o casos regulatorios especiales. Esa combinación encaja mejor con Supabase, simplifica migraciones y reduce el riesgo de fugas por olvidar filtros en la app, porque la política vive en PostgreSQL y se aplica a todas las consultas.

Arquitectura propuesta
El stack queda así: Next.js 15 App Router para frontend, NestJS como backend modular/BFF, Supabase PostgreSQL para persistencia, Supabase Auth o JWT propio para identidad, y módulos desacoplados de documentos para ticket 80mm y facturación electrónica XML firmada. En multi-tenancy, la opción más segura para un SaaS SMB como SaturnLub es que casi todas las tablas de negocio tengan tenant_id, RLS habilitado y un contexto por request que fije el tenant actual en la conexión antes de ejecutar queries.

Flujo recomendado por request:

El usuario inicia sesión.

NestJS valida JWT y resuelve su tenant_id activo.

NestJS fija app.tenant_id y app.user_id en PostgreSQL para esa transacción o sesión corta.

PostgreSQL aplica RLS automáticamente en SELECT, INSERT, UPDATE y DELETE.

Modelo de datos
La separación correcta entre “Lubricadora A” y “Mecánica B” se logra porque cada fila operativa pertenece a un tenant y las políticas RLS solo permiten acceder a filas cuyo tenant_id coincide con el contexto actual de la conexión. Además, debes evitar que el backend use roles superuser o propietarios de tablas en runtime, porque PostgreSQL permite que esos roles salten RLS si no se configura correctamente.

Entidades núcleo
Entidad	Propósito
tenants	Empresa/negocio, branding, RUC, régimen, plan, estado.
tenant_users	Membresías por tenant, rol y estado.
customers	Clientes por cédula/RUC, tipo de precio y datos fiscales.
products	Repuestos, lubricantes, filtros, servicios.
product_prices	Lista de precios por tipo de cliente.
inventory_items	Existencia por sucursal/almacén/lote si aplica.
stock_movements	Kardex auditable.
sales / sale_items	Venta, totalización, cliente y detalle.
kits / kit_items	Combos que consumen componentes.
electronic_documents	XML, estados SRI, claves de acceso, autorizaciones.
print_documents	Tickets/notas de venta generadas.
subscriptions	Plan, renovación, límites y estado.
Tabla tenants
sql
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  commercial_name text not null,
  slug text unique not null,
  ruc varchar(13) unique not null,
  contributor_type text not null, -- persona_natural, sociedad, rimpe, etc.
  taxpayer_regime text,           -- régimen tributario Ecuador
  business_type text not null,    -- lubricadora, mecanica, repuestos, distribuidor
  brand_primary_color text,
  brand_secondary_color text,
  logo_url text,
  address jsonb,
  settings jsonb not null default '{}'::jsonb,
  subscription_plan text not null default 'trial',
  subscription_status text not null default 'active',
  billing_email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
Esta tabla concentra identidad empresarial, personalización visual y facturación del SaaS; además, te conviene guardar configuración tributaria y de documentos para Ecuador en settings, por ejemplo ambiente SRI, establecimiento, punto de emisión, secuenciales y rutas de firma. La suscripción debe ir aquí solo como snapshot de acceso rápido; los eventos de cobro y renovaciones detalladas conviene llevarlos en subscriptions y subscription_events para auditoría interna.

Precios y perfil del cliente
Para la lógica híbrida de ventas, identifica al cliente por document_type y document_number con unicidad por tenant, y resuelve su perfil comercial antes de calcular líneas de venta. Lo más limpio es separar el maestro del producto del precio por canal, en vez de meter demasiadas columnas en products.

sql
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  document_type text not null, -- cedula, ruc, pasaporte, consumidor_final
  document_number varchar(20) not null,
  full_name text not null,
  email text,
  phone text,
  customer_category text not null default 'minorista', -- minorista, distribuidor
  tax_profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, document_type, document_number)
);
sql
create table public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  sku text not null,
  barcode text,
  name text not null,
  product_type text not null, -- simple, servicio, kit
  unit text not null default 'unidad',
  tax_vat_rate numeric(5,2) not null default 15.00,
  track_inventory boolean not null default true,
  is_active boolean not null default true,
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, sku)
);
sql
create table public.product_prices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  product_id uuid not null references public.products(id) on delete cascade,
  price_type text not null, -- minorista, distribuidor
  currency text not null default 'USD',
  unit_price numeric(12,2) not null,
  valid_from timestamptz default now(),
  valid_to timestamptz,
  unique (tenant_id, product_id, price_type, valid_from)
);
Si el usuario ingresa una cédula/RUC en POS, el backend busca al cliente dentro del tenant, lee customer_category y selecciona el precio activo de product_prices; si no existe cliente registrado, puedes caer en minorista por defecto. Si insistes en tener columnas directas, puedes materializar precio_minorista y precio_distribuidor en una vista o caché, pero la tabla separada te da historial y más flexibilidad.

Kits y movimientos de inventario
Los combos deben modelarse como una venta de producto tipo kit, pero con explosión interna a componentes para descontar inventario real. Eso evita inconsistencias entre lo vendido al cliente y lo consumido en bodega.

sql
create table public.kits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (tenant_id, product_id)
);

create table public.kit_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  kit_id uuid not null references public.kits(id) on delete cascade,
  component_product_id uuid not null references public.products(id),
  quantity numeric(12,3) not null,
  unique (tenant_id, kit_id, component_product_id)
);
sql
create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  product_id uuid not null references public.products(id),
  warehouse_id uuid,
  movement_type text not null, -- in, out, adjustment, transfer, sale, sale_kit_component, purchase, return
  quantity numeric(12,3) not null,
  unit_cost numeric(12,4),
  reason text not null,
  reference_type text,
  reference_id uuid,
  performed_by_user_id uuid not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
La auditoría sale de tres piezas: performed_by_user_id, created_at y reason, más referencias al documento origen como venta, compra, ajuste o transferencia. Para blindarlo mejor, usa inserciones append-only en stock_movements y calcula existencias con vista materializada o tabla de saldos actualizada por triggers/eventos.

ERD en Mermaid
text
erDiagram
    TENANTS ||--o{ TENANT_USERS : has
    TENANTS ||--o{ CUSTOMERS : has
    TENANTS ||--o{ PRODUCTS : has
    TENANTS ||--o{ PRODUCT_PRICES : has
    TENANTS ||--o{ WAREHOUSES : has
    TENANTS ||--o{ INVENTORY_BALANCES : has
    TENANTS ||--o{ STOCK_MOVEMENTS : has
    TENANTS ||--o{ SALES : has
    TENANTS ||--o{ SALE_ITEMS : has
    TENANTS ||--o{ KITS : has
    TENANTS ||--o{ KIT_ITEMS : has
    TENANTS ||--o{ ELECTRONIC_DOCUMENTS : has
    TENANTS ||--o{ PRINT_DOCUMENTS : has
    TENANTS ||--o{ SUBSCRIPTIONS : has

    PRODUCTS ||--o{ PRODUCT_PRICES : priced_as
    PRODUCTS ||--o{ INVENTORY_BALANCES : stocked_as
    PRODUCTS ||--o{ STOCK_MOVEMENTS : moved_as
    PRODUCTS ||--o{ SALE_ITEMS : sold_as
    PRODUCTS ||--o| KITS : may_be
    KITS ||--o{ KIT_ITEMS : contains
    PRODUCTS ||--o{ KIT_ITEMS : component

    CUSTOMERS ||--o{ SALES : places
    SALES ||--o{ SALE_ITEMS : contains
    SALES ||--o| ELECTRONIC_DOCUMENTS : may_generate
    SALES ||--o| PRINT_DOCUMENTS : may_generate

    TENANTS {
      uuid id PK
      text legal_name
      text commercial_name
      text slug
      varchar ruc
      text contributor_type
      text taxpayer_regime
      text business_type
      text subscription_plan
      text subscription_status
      jsonb settings
    }

    TENANT_USERS {
      uuid id PK
      uuid tenant_id FK
      uuid auth_user_id
      text role
      boolean is_active
    }

    CUSTOMERS {
      uuid id PK
      uuid tenant_id FK
      text document_type
      varchar document_number
      text full_name
      text customer_category
    }

    PRODUCTS {
      uuid id PK
      uuid tenant_id FK
      text sku
      text name
      text product_type
      boolean track_inventory
    }

    PRODUCT_PRICES {
      uuid id PK
      uuid tenant_id FK
      uuid product_id FK
      text price_type
      numeric unit_price
      timestamptz valid_from
      timestamptz valid_to
    }

    WAREHOUSES {
      uuid id PK
      uuid tenant_id FK
      text name
    }

    INVENTORY_BALANCES {
      uuid id PK
      uuid tenant_id FK
      uuid warehouse_id FK
      uuid product_id FK
      numeric quantity_on_hand
    }

    STOCK_MOVEMENTS {
      uuid id PK
      uuid tenant_id FK
      uuid product_id FK
      uuid warehouse_id FK
      text movement_type
      numeric quantity
      text reason
      uuid performed_by_user_id
      timestamptz created_at
    }

    SALES {
      uuid id PK
      uuid tenant_id FK
      uuid customer_id FK
      text document_kind
      text status
      numeric subtotal
      numeric tax_total
      numeric total
      uuid created_by_user_id
      timestamptz created_at
    }

    SALE_ITEMS {
      uuid id PK
      uuid tenant_id FK
      uuid sale_id FK
      uuid product_id FK
      numeric quantity
      numeric unit_price
      numeric line_total
      boolean is_kit
    }

    KITS {
      uuid id PK
      uuid tenant_id FK
      uuid product_id FK
    }

    KIT_ITEMS {
      uuid id PK
      uuid tenant_id FK
      uuid kit_id FK
      uuid component_product_id FK
      numeric quantity
    }

    ELECTRONIC_DOCUMENTS {
      uuid id PK
      uuid tenant_id FK
      uuid sale_id FK
      text sri_status
      text access_key
      text xml_signed_url
      text authorization_number
    }

    PRINT_DOCUMENTS {
      uuid id PK
      uuid tenant_id FK
      uuid sale_id FK
      text print_format
      text payload_snapshot
    }

    SUBSCRIPTIONS {
      uuid id PK
      uuid tenant_id FK
      text plan_code
      text status
      timestamptz current_period_end
    }
Multi-tenancy segura
La guía segura es: no depender de filtros manuales WHERE tenant_id = ... en cada servicio, sino usar RLS con contexto de sesión/transaction y roles de aplicación que no sean superuser ni owner de tablas. Ese patrón reduce el riesgo humano, porque si olvidas un filtro en una query, la base sigue bloqueando filas ajenas.

Paso a paso
Agrega tenant_id a toda tabla de negocio compartida, incluyendo tablas puente y detalles, no solo cabeceras.

Crea funciones de contexto, por ejemplo current_tenant_id() y current_app_user_id(), leyendo current_setting('app.tenant_id', true) y current_setting('app.user_id', true).

Habilita RLS en cada tabla compartida con ALTER TABLE ... ENABLE ROW LEVEL SECURITY.

Crea políticas por operación; ejemplo base: USING (tenant_id = current_tenant_id()) y en inserts WITH CHECK (tenant_id = current_tenant_id()).

Usa un rol de app dedicado; no ejecutes NestJS con el owner de tablas ni con credenciales que bypassen RLS.

En NestJS, fija el contexto al abrir cada transacción: SET LOCAL app.tenant_id = '...' y SET LOCAL app.user_id = '...'; SET LOCAL es preferible para evitar fugas entre requests en conexiones reutilizadas.

Limpia el contexto por request o usa transacciones por unidad de trabajo, porque una de las trampas conocidas es reusar contexto de una petición previa en entornos con pooling/thread reuse.

Escribe pruebas de integración multi-tenant para cada endpoint crítico: lectura, inserción, actualización, borrado, exportación y reportes.

Ejemplo SQL base
sql
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

alter table public.customers enable row level security;

create policy customers_tenant_select
on public.customers
for select
using (tenant_id = public.current_tenant_id());

create policy customers_tenant_insert
on public.customers
for insert
with check (tenant_id = public.current_tenant_id());

create policy customers_tenant_update
on public.customers
for update
using (tenant_id = public.current_tenant_id())
with check (tenant_id = public.current_tenant_id());
¿RLS o schema aislado?
Para SaturnLub usaría RLS como estándar, porque en Supabase y SaaS SMB ofrece mejor mantenibilidad y menor complejidad operativa que migrar cientos de esquemas por tenant. Reservaría “shared database, isolated schema” para franquicias grandes, cadenas con personalizaciones profundas o clientes que exijan aislamiento lógico más fuerte por contrato.

Estructura NestJS
Te sugiero una Clean Architecture pragmática, donde dominio y casos de uso no dependan de Supabase ni de NestJS directamente. NestJS actúa como framework de entrada y wiring, mientras infraestructura implementa repositorios, gateways de SRI, firma XML y almacenamiento.

text
src/
  main.ts
  app.module.ts

  modules/
    auth/
      application/
      domain/
      infrastructure/
      presentation/

    tenants/
      application/
        use-cases/
        dto/
      domain/
        entities/
        repositories/
        services/
      infrastructure/
        persistence/
          entities/
          repositories/
        rls/
        mappers/
      presentation/
        controllers/
        serializers/

    customers/
    products/
    pricing/
    inventory/
    sales/
    billing/
    documents/
    electronic-invoicing/
    reporting/
    subscriptions/

  shared/
    domain/
      base/
      events/
      value-objects/
    application/
      interfaces/
      cqrs/
    infrastructure/
      database/
        postgres/
        migrations/
      queue/
      cache/
      storage/
      observability/
    presentation/
      guards/
      interceptors/
      filters/
      decorators/

  tenancy/
    application/
      resolve-tenant.use-case.ts
    infrastructure/
      tenant-context.service.ts
      tenant-sql-context.service.ts
    presentation/
      tenant.guard.ts
      tenant.decorator.ts
Separación clave:

tenancy/ resuelve tenant activo y setea contexto SQL.

pricing/ decide minorista vs distribuidor.

documents/ genera ticket/nota de venta.

electronic-invoicing/ arma XML, firma, envía al proveedor/SRI y procesa callbacks.

inventory/ publica eventos de stock tras ventas y kits.

Documentos y facturación electrónica
Conviene tratar ticket 80mm y facturación electrónica como módulos independientes porque no toda venta necesita terminar en el mismo flujo documental. Una venta puede nacer como POS, generar ticket de impresión inmediata y luego, según reglas fiscales o solicitud del cliente, disparar el módulo de comprobante electrónico.

Módulos
documents-print: render de ticket 80mm, nota de venta, formatos ESC/POS o HTML-to-print.

electronic-invoicing: construcción de XML, firma, envío, recepción de estado, autorización, almacenamiento del XML autorizado y metadatos fiscales.

sales: orquesta la venta, pero no conoce detalle técnico de impresión o firma.

Para Ecuador, el emisor necesita estar autorizado en ambiente de producción por SRI y gestionar el trámite en SRI en línea con identificación y clave, seleccionando facturación electrónica y autorización en producción. También debe contar con un sistema que genere comprobantes electrónicos XML y una firma electrónica vigente, que en la práctica debes modelar como credenciales/certificados por tenant y nunca como configuración global.

Webhooks Ecuador
La recomendación más sólida es no exponer la lógica SRI dentro del módulo de ventas, sino manejar callbacks/webhooks en un bounded context electronic-invoicing con cola interna y procesamiento idempotente. Así puedes recibir estados como “recibido”, “devuelto”, “autorizado” o “rechazado”, persistirlos y después notificar a sales sin bloquear el POS.

Diseño sugerido
POST /webhooks/e-invoicing/:provider recibe callback del proveedor integrador o tu pasarela fiscal.

Validas firma/HMAC/IP allowlist del proveedor.

Aplicás idempotencia con event_id único.

Guardás payload raw en electronic_document_events.

Actualizás electronic_documents.

Emitís evento interno electronic_document.authorized o ...rejected.

sales actualiza estado comercial del comprobante y habilita reimpresión/descarga.

Buenas prácticas:

Cola asíncrona con BullMQ o RabbitMQ.

Reintentos exponenciales.

Correlation IDs.

Tabla de eventos inmutable.

Alertas si un documento queda “pendiente” demasiado tiempo.

Exportación a Power BI
Lo más seguro no es dar acceso directo a la base de datos por tenant, sino una API analítica segura, versionada y con vistas estables por tenant. RLS también ayuda aquí, porque las vistas expuestas por la API siguen devolviendo solo filas del tenant autenticado si el contexto SQL está bien fijado.

Recomendación
Crea un módulo reporting con:

Vistas SQL estables: v_sales_daily, v_inventory_current, v_top_products, v_receivables.

Endpoints firmados por tenant: /api/v1/reporting/sales-daily, /inventory, /customers.

Autenticación M2M por tenant con client credentials o API keys rotables.

Filtros de fecha, paginación cursor y export CSV/JSON.

Patrón seguro
Cada API key pertenece a un tenant_id.

NestJS convierte esa key a contexto SQL de tenant.

La API nunca acepta tenant_id por query string como fuente de verdad.

Los reportes leen de vistas/materialized views con RLS o tablas ya agregadas por tenant.

Para Power BI, usa incremental refresh con endpoints por rango de fechas.

Vistas útiles
Vista/API	Uso en Power BI
v_sales_daily	Ventas por día, sucursal, canal, tipo de documento.
v_sales_by_customer_category	Minorista vs distribuidor.
v_inventory_current	Stock actual, costo, rotación y quiebres.
v_stock_movements	Kardex y auditoría.
v_top_products	Repuestos/lubricantes más vendidos.
Decisiones clave
Usa RLS como estrategia default de aislamiento, no filtros manuales dispersos.

Usa tenant_id en todas las tablas de negocio compartidas.

No ejecutes el backend con roles que bypassen RLS.

Separa ventas, inventario y documentos en módulos independientes para mantener el dominio limpio.

Modela precios por tipo de cliente en tabla separada para soportar minorista/distribuidor con historial.

Implementa kits como BOM comercial con consumo de componentes reales de stock.

Expón reporting por API/vistas seguras para Power BI, no acceso libre a tablas operativas.

Ejemplo de flujo POS
Cuando el cajero ingresa una cédula o RUC, NestJS busca el cliente dentro del tenant actual, determina si es minorista o distribuidor, arma el carrito con los precios correctos y al confirmar la venta genera sale, sale_items y stock_movements; si el ítem es kit, explota sus componentes y descuenta inventario real. Luego, según el tipo documental, el sistema manda a imprimir ticket 80mm o envía la venta al módulo de facturación electrónica para firmar XML, solicitar autorización y actualizar el estado cuando llegue la respuesta del flujo fiscal.

¿Quieres que en el siguiente paso te lo convierta en un documento técnico más formal, con DDL inicial de PostgreSQL y módulos NestJS listos para arrancar el proyecto?

y que tipo de publicidad como debería hacer la publicidad en el cartel pero ojo es mecánica y eso de ventas de lubricantes creo que me w lubricadora
2 pasos completados
Sí: en tu caso el cartel debería vender mecánica + lubricación + repuestos, pero con una jerarquía clara para que no se vea como “solo lubricadora” si el fuerte es el taller. Para talleres mecánicos funciona mejor un mensaje local, directo y visual, con servicios concretos, ubicación y una oferta de entrada; además, mostrar trabajos reales y promociones puntuales suele atraer más que un cartel genérico.

Enfoque del cartel
Si el negocio es más mecánica que lubricadora, el cartel debe poner primero la confianza y el servicio, y dejar “lubricantes” como una línea de apoyo. Lo ideal es que el titular diga algo como: “Taller Mecánico y Lubricación” o “Mecánica rápida, cambio de aceite y repuestos”, no solo “lubricadora”.

Si el negocio sí vende bastante aceite y filtros, entonces el cartel puede usar una propuesta mixta: mecánica general + lubricación + venta de repuestos, para no confundir al cliente.

Qué poner en el cartel
Pon solo lo que el cliente entiende en 3 segundos:

Nombre del negocio.

Servicios principales: mecánica rápida, cambio de aceite, frenos, suspensión, afinación, diagnóstico, venta de repuestos.

Oferta clara: “Cambio de aceite desde $X” o “Chequeo preventivo gratis”.

WhatsApp, dirección y horario.

Si aplica, “Facturación” y “Atención a flotillas”.

Mensaje recomendado
Te conviene elegir una sola idea central según el tipo de cliente que quieres atraer:

Si quieres más autos de mantenimiento: “Cambio de aceite, filtros y mecánica rápida”.

Si quieres más reparación: “Tu taller de confianza para diagnóstico y reparación”.

Si quieres vender lubricantes también: “Mecánica, lubricación y repuestos en un solo lugar”.

Diseño visual
Usa fotos reales del taller, del mecánico trabajando y de productos reales, porque eso transmite confianza mejor que ilustraciones genéricas. Para talleres, los anuncios con contenido visual real y local suelen funcionar mejor, especialmente en redes y carteles cercanos a la zona de servicio.

Evita llenar el cartel de texto; mejor pocos mensajes grandes y muy legibles desde lejos.

Texto ejemplo
Puedes usar una de estas versiones:

Taller Mecánico y Lubricación
Cambio de aceite · Frenos · Suspensión · Diagnóstico
WhatsApp: XXX XXX XXX
Dirección: …

Mecánica Rápida + Repuestos
Mantenimiento preventivo · Lubricantes · Filtros · Baterías

Tu taller de confianza
Revisión, reparación y cambio de aceite para autos y motos

Si quieres, te armo 3 propuestas de cartel listas para imprimir: una más “mecánica”, una más “lubricadora” y una mixta para SaturnLub.

si algo así de cambios de aceite o venta de aceites mecánica y así?

Sí, por ahí va: el mensaje debe sonar a “mecánica + cambio de aceite + venta de lubricantes”, porque eso le dice rápido al cliente qué haces y evita que te vean solo como una lubricadora.

Enfoque ideal
Para este tipo de negocio, lo más fuerte suele ser vender mantenimiento rápido y confianza, no solo el producto aceite. Un mensaje como “Cambio de aceite, mecánica rápida y lubricantes” funciona mejor porque combina servicio + producto + solución concreta.

Qué debería decir
Te conviene usar frases cortas, grandes y fáciles de leer desde lejos, porque un cartel debe comunicar el servicio principal en segundos.

Opciones buenas:

Cambio de aceite y mecánica rápida

Venta de aceites, filtros y servicio mecánico

Lubricantes, mantenimiento y reparación automotriz

Más vida para tu motor con un buen cambio de aceite

Fórmula para el cartel
La estructura más clara sería:

Arriba: nombre del negocio.

En el centro: servicio principal grande, por ejemplo “Cambio de aceite y mecánica rápida”.

Debajo: 3 a 5 servicios, como frenos, filtros, baterías, suspensión, escáner.

Abajo: WhatsApp, dirección y promoción.

Ejemplos listos
Puedes usar textos como estos:

Opción 1
Cambio de aceite y mecánica rápida
Aceites · Filtros · Frenos · Suspensión
Atención rápida y confiable

Opción 2
Venta de lubricantes y servicio mecánico
Cambio de aceite · Revisión general · Repuestos

Opción 3
Todo para el cuidado de tu motor
Lubricantes, filtros y mantenimiento automotriz

Recomendación práctica
Si quieres atraer más clientes de calle, el mejor gancho suele ser “cambio de aceite” porque es un servicio frecuente, fácil de entender y además te abre la puerta para vender filtros, aditivos y otros trabajos mecánicos. Después, en letra secundaria, agregas “mecánica rápida” o “venta de lubricantes” para ampliar la oferta sin confundir.

Te dejo una versión bastante buena para negocio real:

SATURNLUB
Cambio de aceite, mecánica rápida y venta de lubricantes
Filtros · Frenos · Baterías · Repuestos
WhatsApp: XXXXXXXX

¿Quieres que te escriba ahora 10 frases publicitarias más “pegajosas” para cartel, Facebook y volante?

Diagnóstico y Fix del Loop de Redirección (Auth & Onboarding)
El problema de que un usuario con un tenant registrado termine atrapado en /onboarding se debe a una desincronización entre el estado real de la base de datos y los claims del JWT, combinado con la incapacidad del Server Component de propagar nuevas cookies de sesión.
1. Diagnóstico de Causa Raíz
Actualmente el flujo de autenticación y redirección depende en exceso del Custom Access Token Hook de Supabase para inyectar el claim tenant_id en el JWT.
¿Dónde y por qué falla?
resolvePostAuthRoute (en loginAction): Tras un inicio de sesión exitoso, revisa si el JWT tiene tenant_id. Si el hook en Supabase falla, es lento, o no está activado, el JWT no tendrá este claim. Al no tenerlo (incluso tras intentar un refreshSession), el código asume empíricamente que el usuario no tiene tenant y retorna la ruta /onboarding.
getActiveMembership (en layouts y pages): Tiene un comentario que afirma que "el RLS requiere el claim tenant_id". Aunque el archivo db.sql muestra que la política RLS solo requiere user_id = auth.uid(), si en la base de datos viva se alteró el RLS para requerir auth.jwt()->>'tenant_id', el query a tenant_memberships retornará 0 filas.
El problema del Refresh en Server Components: getActiveMembership intenta hacer supabase.auth.refreshSession() para forzar la inyección del claim. Sin embargo, al ejecutarse en un Server Component, no puede escribir cookies. Esto significa que aunque consiga un nuevo token temporal en memoria, el navegador sigue enviando el token viejo en las siguientes peticiones.
Conclusión del Diagnóstico: El loop ocurre porque el sistema toma decisiones de enrutamiento basándose en un JWT que puede estar "stale" (desactualizado) o sin claims debido a fallos del hook, en lugar de consultar la base de datos como fuente de la verdad para el redireccionamiento post-login.
2. Flujo Correcto Post-Login
El flujo robusto no debe confiar a ciegas en el JWT para el redireccionamiento inicial.
Login exitoso: Se autentica al usuario.
Decidir ruta (resolvePostAuthRoute):
Se revisan los claims del JWT como vía rápida (optimización).
Si el claim falta, en lugar de enviarlo ciegamente a /onboarding, SE CONSULTA LA BASE DE DATOS (tenant_memberships).
Si la DB confirma que tiene membresía, se redirige a /dashboard (y el layout del dashboard se encargará de refrescar la sesión si es estrictamente necesario para RLS).
Si la DB dice que NO tiene membresía, entonces sí va a /onboarding.
Fuente de verdad: La base de datos (tabla tenant_memberships) debe ser siempre la fuente de verdad absoluta para decidir si el onboarding está completo. El JWT es solo una caché para optimizar lecturas (por ejemplo en el middleware.ts).
3. Revisión de Esquema y Políticas
Fuente de verdad: La existencia de una fila activa en tenant_memberships para el user.id.
Política RLS Recomendada: La tabla tenant_memberships NO DEBE requerir el claim tenant_id en el JWT para que un usuario pueda leer sus propias membresías. La política en db.sql actual es correcta: user_id = auth.uid() OR EXISTS (...) Debemos asegurarnos de que esta sea la política aplicada en producción, permitiendo que el usuario consulte si pertenece a un tenant usando únicamente su identidad base (auth.uid()).
4. Debug Checklist
Para verificar en producción, ejecuta estos pasos:
Verificar estado en DB: SELECT * FROM tenant_memberships WHERE user_id = 'tu-uuid'; (Debe retornar fila).
Verificar JWT: Inicia sesión, abre DevTools, copia la cookie sb-xxx-auth-token y decodifícala (ej. en jwt.io). Revisa si existe el claim tenant_id. Si no existe, el Custom Token Hook está fallando o inactivo.
Verificar RLS: Intenta hacer un SELECT a tenant_memberships desde el editor SQL de Supabase usando el rol authenticated y el user_id para confirmar que el RLS no está bloqueando por falta del claim.
IMPORTANT
Requiere Revisión de Usuario: ¿Estás de acuerdo con mover la lógica de decisión primaria de routing hacia la base de datos y usar el JWT solo como caché/optimización en lugar de bloqueo estricto?
5. Proposed Changes (Fix Recomendado)
Vamos a desacoplar el enrutamiento del Custom Token Hook para estabilizar el sistema hoy mismo.
[MODIFY] src/actions/auth.ts
Actualizaremos resolvePostAuthRoute para que, en caso de faltar el claim en el JWT, consulte directamente la base de datos en lugar de hacer refreshSession() o enviarlo a /onboarding.
[MODIFY] src/lib/supabase/membership.ts
Limpiaremos getActiveMembership para evitar llamadas a refreshSession() dentro del Server Component (que fallan al intentar setear cookies) y confiaremos en la consulta directa a tenant_memberships aprovechando que el RLS usa auth.uid().
[MODIFY] src/app/(dashboard)/dashboard/layout.tsx
Si el layout detecta que la base de datos confirma el tenant pero el JWT no tiene el claim (por ejemplo, recién terminó el onboarding y la cookie no se actualizó bien), aquí sí podemos forzar un componente de cliente que haga refreshSession() para que la cookie se escriba y el resto del sistema (y el middleware) vean el JWT fresco.
6. Verification Plan
Iniciar sesión con un usuario existente.
Confirmar que aterriza en /dashboard inmediatamente, incluso si el hook de Supabase está desactivado o la cookie no tiene el claim.
Verificar que el login sea estable y no se introduzcan loops adicionales. Esto me dio

Sí, ese diagnóstico va mucho mejor encaminado, y con el SQL que tienes la conclusión más fuerte es esta: tu redirect no debería depender del claim tenant_id del JWT para saber si el usuario ya pertenece a un tenant, porque en tu esquema actual la verdad ya está en tenantmemberships y tenants.onboardingcompleted. Además, tus políticas RLS para tenantmemberships y tenants sí están diseñadas para permitir lectura usando auth.uid() y membresía activa, no obligatoriamente un claim tenant_id, así que si el login sigue mandando a onboarding, el fallo es mucho más probable en la lógica de app que en el modelo SQL base.

Lo que veo en tu base
En tus versiones más recientes del esquema, la tabla tenants tiene onboardingcompleted boolean not null default false, y tenantmemberships guarda la relación usuario-tenant con userid, tenantid, role e isactive. También la política selecttenantmemberships permite que el usuario lea su propia membresía con userid = auth.uid() y la política selecttenants permite leer el tenant si existe una membresía activa asociada.

Eso significa que el post-login correcto debería ser:

usuario autenticado,

buscar su membresía activa,

leer el tenant asociado,

revisar onboardingcompleted,

ir a /dashboard si está completo, o a /onboarding si no lo está.

Causa más probable
La causa más probable es una de estas dos:

resolvePostAuthRoute está usando el JWT como criterio principal y cuando no ve tenant_id manda a onboarding demasiado pronto, aunque la membresía sí exista en DB.

getActiveMembership o la consulta equivalente devuelve null por un bug de código, mala selección de columnas, mala lectura de cookies/sesión en SSR, o porque está intentando refrescar sesión dentro de un Server Component y luego actúa sobre un token que no persiste al navegador.

Con el SQL que compartiste, no parece que tu RLS base esté exigiendo el claim tenant_id para leer la membresía; al contrario, está montado alrededor de auth.uid() y EXISTS sobre la propia tabla tenantmemberships.

Fix profesional
Yo lo arreglaría así:

El JWT claim tenant_id se queda como optimización, no como fuente de verdad.

resolvePostAuthRoute() debe consultar DB si el claim falta.

getActiveMembership() nunca debe hacer refreshSession() en Server Component.

El dashboard layout debe basarse en membresía + tenant + onboardingcompleted.

Solo usar refresh del lado cliente o en callback donde sí puedas propagar cookies.

La condición de negocio final debe ser literalmente:

Sin sesión → /login

Sesión + sin membresía activa → /onboarding

Sesión + membresía + tenant.onboardingcompleted = false → /onboarding

Sesión + membresía + tenant.onboardingcompleted = true → /dashboard

Prompt definitivo
Pégale esto a Gemini para que te lo convierta en arreglo de código o para que te responda directamente si ya no usarás Claude:

text
Actúa como un Senior Fullstack Engineer experto en Next.js 15 App Router, Supabase SSR, autenticación multi-tenant, RLS y debugging profundo de flujos auth/onboarding.

Necesito que audites y propongas el fix definitivo para un loop de redirección en SaturnLub.

Contexto real:
- Stack: Next.js 15 App Router + TypeScript + Supabase + @supabase/ssr.
- Hay login/register/onboarding/dashboard.
- Existe arquitectura multi-tenant.
- Se usa custom access token hook para inyectar tenant_id en el JWT, pero quiero dejar de depender de eso como fuente principal de verdad.
- El bug actual: un usuario ya registrado, con tenant existente y onboarding ya completado, sigue siendo enviado a /onboarding después del login.
- También hubo intentos de usar refreshSession() para arreglarlo, pero eso no resolvió el problema.

Base de datos actual relevante:
1. Tabla public.tenants:
- id
- businessname
- slug
- onboardingcompleted boolean not null default false
- isactive boolean not null default true

2. Tabla public.users:
- id references auth.users(id)
- email
- defaulttenantid
- isactive

3. Tabla public.tenantmemberships:
- id
- tenantid
- userid
- role
- isowner
- isactive
- unique (tenantid, userid)

4. Función createTenantForOwner() crea tenant y luego inserta membresía owner.

RLS actual importante:
- tenantmemberships SELECT permite leer si userid = auth.uid() o si eres owner/admin del mismo tenant.
- tenants SELECT permite leer si existe una membresía activa donde tm.tenantid = tenants.id y tm.userid = auth.uid().
- O sea: en teoría, NO se necesita tenant_id en el JWT para leer tu propia membresía ni tu tenant.

Diagnóstico esperado:
Quiero que partas de esta hipótesis:
“El loop no está en el modelo SQL principal sino en la lógica de app que decide mal el redirect post-login, porque depende demasiado del JWT claim tenant_id o intenta refreshSession() en lugares donde no persiste cookies”.

Quiero que me devuelvas una solución concreta y profesional con estos entregables:

1. Diagnóstico técnico preciso
- Explica por qué el usuario puede caer en /onboarding aunque sí tenga tenant y onboardingcompleted = true.
- Señala los puntos probables:
  - resolvePostAuthRoute
  - getActiveMembership
  - dashboard layout
  - middleware
  - callback auth
- Explica por qué refreshSession() dentro de Server Components no es una solución fiable.

2. Nuevo criterio de verdad
Quiero que propongas el flujo correcto:
- sesión válida
- buscar membresía activa en DB
- buscar tenant asociado
- leer tenant.onboardingcompleted
- decidir redirect final
- usar tenant_id del JWT solo como optimización, nunca como criterio único

3. Código recomendado
Quiero que escribas código o pseudocódigo muy cercano a producción para:
- resolvePostAuthRoute()
- getActiveMembership()
- requireActiveMembership()
- app/(dashboard)/layout.tsx
- middleware.ts

4. Reglas exactas del redirect
Necesito que el sistema haga esto:
- sin sesión -> /login
- con sesión pero sin membresía activa -> /onboarding
- con sesión + membresía activa + onboardingcompleted = false -> /onboarding
- con sesión + membresía activa + onboardingcompleted = true -> /dashboard

5. Queries SQL de auditoría
Dame queries exactas para verificar:
- si el usuario autenticado tiene fila en users
- si tiene membresía activa en tenantmemberships
- si el tenant existe
- si onboardingcompleted está en true
- si defaulttenantid coincide o no
- si hay datos inconsistentes entre users.defaulttenantid, tenantmemberships y tenants

6. Plan de fix mínimo hoy
Quiero una propuesta de cambios mínimos para estabilizar el sistema hoy mismo:
- qué archivo tocar primero
- qué lógica eliminar
- qué lógica reemplazar
- cómo evitar loops infinitos
- cómo loguear el flujo para depuración

7. No quiero teoría vaga
- Quiero una respuesta orientada a implementación.
- Quiero que asumas que la base SQL principal está relativamente bien.
- Quiero que encuentres el error probable en la capa de aplicación.
- Quiero que el resultado final deje al usuario ya onboarded entrando directo al dashboard.

Importante:
- No uses SERVICE_ROLE_KEY local.
- No uses createAdminClient para esto.
- No dependas de que refreshSession arregle mágicamente el flujo.
- Prioriza simplicidad, SSR correcto y una fuente única de verdad en base de datos.
Mi recomendación final
Yo haría el fix con esta idea central: el onboarding se decide por DB, no por claims. De hecho, en tu esquema, el indicador más fuerte ya existe: tenants.onboardingcompleted, así que sería un error seguir tratando al JWT como árbitro final de navegación.

Primero audita con SQL si el usuario realmente tiene:

una fila en users,

una fila activa en tenantmemberships,

un tenant visible,

y onboardingcompleted = true.

Si todo eso existe, entonces el bug casi seguro está en resolvePostAuthRoute() o en el layout del dashboard que vuelve a mandar al usuario a onboarding por una lectura incompleta o mal sincronizada de sesión/membresía. Si quieres, en el siguiente mensaje te doy yo mismo el código base exacto de resolvePostAuthRoute y getActiveMembership ya aterrizado para Next.js + Supabase SSR.

Diagnóstico y Fix Definitivo del Loop de Redirección (Auth & Onboarding)
Esta es la auditoría profunda y la propuesta de refactorización para solucionar el loop de /onboarding en SaturnLub, estableciendo una única fuente de verdad en la base de datos y dejando el JWT solo como una optimización.
1. Diagnóstico Técnico Preciso
El problema real (Causa Raíz): El loop no está en la base de datos (el RLS permite leer la membresía usando auth.uid()), sino en la capa de aplicación. Ocurre por un encadenamiento de decisiones basadas en un estado obsoleto y el mal uso de refreshSession() en Server Components:
resolvePostAuthRoute asume demasiado: Tras el login, si el JWT carece del claim tenant_id (porque el Custom Hook falló, es lento o está desactivado), la acción decide unilateralmente que el usuario no tiene tenant y retorna /onboarding.
refreshSession() en Server Components falla silenciosamente: Cuando el usuario llega a /onboarding o /dashboard, la función getActiveMembership() intenta forzar un refreshSession(). Pero en un entorno de Server Component (Next.js App Router), no se pueden sobrescribir cookies en un layout o page. El token refrescado se queda en memoria, el navegador nunca se entera, y en la siguiente navegación (o redirección) se vuelve a enviar el JWT viejo sin claims.
El Criterio Incorrecto: Actualmente se usa la simple presencia de una membresía (membership?.tenant_id) para decidir si alguien completó el onboarding, en lugar de validar explícitamente el flag onboarding_completed de la tabla tenants.
2. Nuevo Criterio de Verdad (Flujo Correcto)
La base de datos será la única autoridad para decidir a dónde va el usuario. El claim del JWT solo se usará para evitar consultas a la DB cuando estemos 100% seguros de que ya completó el flujo.
Reglas Exactas de Redirect:
Sin sesión → /login
Con sesión pero sin membresía activa (membership == null) → /onboarding
Con sesión + membresía activa + onboarding_completed == false → /onboarding
Con sesión + membresía activa + onboarding_completed == true → /dashboard
3. Código Recomendado (Pseudo-código / Producción)
src/actions/auth.ts -> resolvePostAuthRoute()
typescript
async function resolvePostAuthRoute(requested: string): Promise<string> {
const supabase = await createClient();
const { data: { session } } = await supabase.auth.getSession();
if (!session) return "/login";
// Vía Rápida (Optimización): Si el JWT dice que completó el onboarding, ir al dashboard.
let claims = decodeJwtPayload<AccessClaims>(session.access_token);
if (claims?.tenant_id && claims?.onboarding_completed) {
return isSafeRedirectPath(requested) ? requested : "/dashboard";
}
// Vía Segura (DB-First): El JWT no tiene el claim o dice que no lo completó.
const { data: { user } } = await supabase.auth.getUser();
if (!user) return "/login";
const { data: membership } = await supabase
.from("tenant_memberships")
.select(`tenant_id, tenants!inner ( onboarding_completed )`)
.eq("user_id", user.id)
.eq("is_active", true)
.limit(1)
.maybeSingle();
// Decisión final basada en DB
if (membership?.tenant_id && membership.tenants?.onboarding_completed) {
return isSafeRedirectPath(requested) ? requested : "/dashboard";
}
return "/onboarding";
}
src/lib/supabase/membership.ts -> getActiveMembership()
typescript
export const getActiveMembership = cache(async (): Promise<MembershipContext> => {
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) return { user: null, membership: null, trial: { kind: "no-tenant" } };
// ELIMINAMOS el `refreshSession()` de aquí. No funciona en RSC y oculta bugs.
// Confiamos en el RLS que usa auth.uid().
const { data } = await supabase
.from("tenant_memberships")
.select(`
tenant_id, role,
tenants!inner (
id, business_name, slug, onboarding_completed,
subscription_status, subscription_plan_code, trial_ends_at
)
`)
.eq("user_id", user.id)
.eq("is_active", true)
.limit(1)
.maybeSingle();
const membership = (data as unknown as ActiveMembership | null) ?? null;
const trial = evaluateTrial(
membership?.tenants
? {
tenant_id: membership.tenant_id,
subscription_status: membership.tenants.subscription_status,
trial_ends_at: membership.tenants.trial_ends_at,
}
: null
);
return { user, membership, trial };
});
// NUEVO HELPER para los layouts del dashboard
export async function requireActiveMembership() {
const context = await getActiveMembership();

if (!context.user) redirect("/login");

// Guard 1: Sin membresía o onboarding incompleto
if (!context.membership || !context.membership.tenants?.onboarding_completed) {
redirect("/onboarding");
}
// Guard 2: Free trial vencido (La lógica de isTrialBlocked funciona bien)
if (isTrialBlocked(context.trial)) {
redirect("/upgrade");
}
return context;
}
src/app/(dashboard)/dashboard/layout.tsx
typescript
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
// Reemplazamos los if manuales por la función centralizada
const { user, membership } = await requireActiveMembership();
const fullName = user.user_metadata?.full_name ?? user.email ?? "Usuario";
const headersList = await headers();
const activePath = headersList.get("x-pathname") ?? "/dashboard";
return (
<div className="garage-backdrop flex min-h-dvh">
<Sidebar activePath={activePath} />
<div className="flex min-w-0 flex-1 flex-col">
<DashboardHeader
businessName={membership!.tenants!.business_name}
userName={fullName}
userEmail={user.email ?? ""}
role={membership!.role}
/>
<main className="flex-1 px-6 py-8 sm:px-8">{children}</main>
</div>
</div>
);
}
src/middleware.ts
El middleware ya está relativamente bien porque delega el control si no tiene claims. Solo ajustamos la redirección para que verifique el onboarding_completed si el claim existe.
typescript
if (claims?.tenant_id) {
if (pathname === "/onboarding" && claims.onboarding_completed) {
const url = request.nextUrl.clone();
url.pathname = "/dashboard";
return NextResponse.redirect(url);
}
// trial lock logic...
}
4. Queries SQL de Auditoría
Ejecuta estas consultas en el editor SQL de Supabase para validar el estado de un usuario problemático (reemplaza TU-EMAIL):
sql
-- 1. Verificar si el usuario existe y su default_tenant_id
SELECT id, email, is_active, default_tenant_id
FROM public.users
WHERE email = 'TU-EMAIL';
-- Guarda el ID obtenido arriba para las siguientes:
-- 2. Verificar membresía activa en tenant_memberships
SELECT tm.id, tm.tenant_id, tm.role, tm.is_owner, tm.is_active
FROM public.tenant_memberships tm
WHERE tm.user_id = 'EL-ID-DEL-USUARIO';
-- 3. Verificar estado real del Tenant y Onboarding
SELECT t.id, t.business_name, t.onboarding_completed, t.is_active, t.subscription_status, t.trial_ends_at
FROM public.tenants t
JOIN public.tenant_memberships tm ON t.id = tm.tenant_id
WHERE tm.user_id = 'EL-ID-DEL-USUARIO';
-- 4. Inconsistencias (Usuarios cuyo default_tenant_id no coincide con una membresía activa)
SELECT u.email, u.default_tenant_id, tm.tenant_id as actual_membership
FROM public.users u
LEFT JOIN public.tenant_memberships tm ON u.id = tm.user_id AND tm.is_active = true
WHERE u.default_tenant_id != tm.tenant_id OR tm.tenant_id IS NULL;
5. Plan de Fix Mínimo Hoy (Paso a Paso)
Limpiar membership.ts: Eliminar el bloque de refreshSession().
Actualizar auth.ts: Modificar resolvePostAuthRoute() para que consulte la base de datos directamente con un fallback (añadir consola console.log("resolvePostAuthRoute DB Fallback", membership) para depuración).
Crear requireActiveMembership(): Aislar la lógica de redirección (/onboarding y /upgrade) para los layouts.
Actualizar OnboardingPage: Cambiar la lógica de redirección en /onboarding/page.tsx para que evalúe membership.tenants.onboarding_completed == true antes de enviarlo a /dashboard. (Actualizado: Si el usuario ya lo completó, que sí se vaya a dashboard).
Revisión del Plan Gratuito (Trial de 14 días): El código actual de evaluateTrial maneja el fallback a trial correctamente. Al usar la base de datos como fuente de verdad, trial_ends_at se lee de tenants, y funciona de inmediato sin depender del Custom JWT.
IMPORTANT
Revisa la lógica propuesta. Si estás de acuerdo, ejecutaré los reemplazos en el código inmediatamente. No usaré SERVICE_ROLE_KEY ni dependeré mágicamente del JWT para la redirección. le doy listo o que mas le digo

Sí, dale listo, pero con 4 ajustes puntuales antes de que toque el código. La dirección general está bien: mover la decisión a base de datos, sacar refreshSession() de Server Components y usar onboardingcompleted como verdad es exactamente lo más sólido para tu caso.

Qué responderle
Respóndele algo así, tal cual:

text
Sí, adelante con el refactor, pero haz estos ajustes antes de aplicar cambios:

1. No asumas nombres de columnas en snake_case si mi schema real usa nombres sin guion bajo.
En mi base actual las columnas son estilo:
- tenantmemberships.userid
- tenantmemberships.tenantid
- tenantmemberships.isactive
- tenants.onboardingcompleted
- tenants.businessname
- tenants.subscriptionstatus
- tenants.subscriptionplancode
- tenants.trialendsat
- users.defaulttenantid

Entonces adapta TODO el código exactamente a esos nombres reales del schema, no inventes user_id, tenant_id, is_active, business_name, onboarding_completed, etc.

2. El criterio principal debe ser DB-first, no JWT-first.
Puedes usar claims solo como optimización, pero la decisión final debe salir de:
- sesión válida
- membership activa
- tenant visible
- tenants.onboardingcompleted

3. Elimina cualquier refreshSession() dentro de Server Components, layouts o helpers de lectura.
Si hace falta refrescar cookies, que sea solo en middleware, callback o cliente, nunca en una función de lectura de membership.

4. Antes de modificar, revisa también onboarding/page.tsx, login action, middleware y dashboard layout para que todos usen la misma función centralizada de decisión y no haya reglas duplicadas.

Quiero que apliques el fix mínimo y estable:
- resolvePostAuthRoute()
- getActiveMembership()
- requireActiveMembership()
- onboarding/page.tsx
- dashboard layout
- logs temporales de depuración

Además, antes de finalizar, quiero que me dejes queries SQL de auditoría adaptadas EXACTAMENTE a mis nombres reales de columnas y tablas.
Ojo importante
Aquí hay un detalle crítico: el pseudo-código que te dio usa nombres como tenant_memberships, user_id, tenant_id, onboarding_completed, business_name. Pero en los SQL que tú has compartido, los nombres reales aparecen como tenantmemberships, userid, tenantid, onboardingcompleted, businessname y defaulttenantid. Si Gemini o cualquier otra IA te genera código con nombres “bonitos” distintos al schema real, el fix no solo no arregla nada, sino que rompe más consultas.

Qué está bien de su propuesta
Estas partes sí van bien:

quitar refreshSession() de Server Components, porque Next.js no soporta setear cookies durante render de Server Components.

usar middleware o rutas donde sí se puedan propagar cookies si hace falta refresh de sesión.

dejar al JWT como optimización y no como autoridad principal.

decidir onboarding por tenants.onboardingcompleted en vez de inferirlo solo por existencia de membership.

Qué le falta pedirle
También pídele esto para que no se quede a medias:

que agregue logs temporales como:

user.id

membership encontrada

tenantid

onboardingcompleted

redirect final.

que revise si el usuario tiene más de una membership y cuál está escogiendo.

que priorice users.defaulttenantid si existe y coincide con una membresía activa; si no, que use la primera activa.

que no redirija desde varios puntos con reglas distintas, porque eso recrea loops.

Mi recomendación
Sí, ya puedes decirle “adelante”, pero solo si primero ajusta el código a tu schema real y centraliza la lógica en una sola función reutilizable. Si no le dices eso, corres el riesgo de que te entregue un arreglo conceptualmente correcto pero roto por nombres de columnas o por duplicación de reglas entre login, onboarding, layout y middleware.

Después de eso, el siguiente paso correcto es pedirle que te devuelva:

diff exacto por archivo,

código final completo,

y queries SQL de verificación adaptadas a tu esquema real.

Si quieres, te preparo yo el mensaje final exacto y mejorado para copiarle a Gemini en un solo bloque.

Esta es mi base de datos organiza bien y dame completa organizada puesto los cambios que hice abajo para que quede como una sola

paste.txt

Sí. Tu archivo nuevo ya está bastante más sólido, pero todavía tiene mezcla de cambios viejos y nuevos, y además quedó con duplicaciones / solapamientos al final, especialmente en protección de billing y políticas de tenants. La forma correcta es dejarlo como un único schema canónico, con naming consistente en snake_case, una sola versión de triggers/functions, una sola política final por tabla y sin bloques repetidos.

Qué cambios ya quedaron en esta versión
Tu versión actual ya migró a nombres consistentes como tenant_memberships, sale_payments, onboarding_completed, default_tenant_id y set_updated_at, así que esa base sí está más limpia que las anteriores. También ya integra cambios importantes: seed de free_trial, trigger para sync de auth.users, custom JWT hook, endurecimiento de billing y RLS segmentado entre tablas maestras y transaccionales.

Lo que está mal o repetido
Al final del archivo tienes dos funciones distintas para proteger billing del tenant: protect_tenant_billing_columns() y luego protect_tenant_billing(); ambas hacen casi lo mismo y crean triggers diferentes sobre public.tenants, lo que deja ambigüedad innecesaria. Además recreas update_tenants al final con una regla más restrictiva solo para owner, después de haberla creado antes para owner/admin, así que la política efectiva final ya no coincide con la sección anterior del script.

También hay una decisión de negocio mezclada: en una parte dices que owner/admin pueden actualizar tenant, pero al final dejas update_tenants solo para owner, lo cual cambia el comportamiento real de producción. Eso debe unificarse explícitamente en una sola versión para que no tengas sorpresas.

Cómo debe quedar
La versión final debería quedar así:

Un solo bloque de extensiones/helpers.

Todas las tablas en snake_case.

Un solo bloque de triggers updated_at.

Una sola versión de funciones auth/tenant.

Un solo bloque de índices.

Un solo bloque de RLS.

Un solo bloque final de hardening (free_trial, hook JWT, guards billing).

Y en particular yo dejaría estas reglas como definitivas:

tenant_memberships es la fuente de verdad de pertenencia.

tenants.onboarding_completed es la fuente de verdad de onboarding.

El JWT hook solo agrega caché útil, no debe ser requisito duro para consultar membresía.

Billing/trial protegido por una sola función/trigger.

update_tenants definido una sola vez, con la decisión clara de si admin puede o no editar tenant.

Recomendación concreta
Te recomiendo consolidarlo en esta política final de negocio, porque es la más coherente con tu modelo actual:

owner puede actualizar todo el tenant editable por cliente.

admin puede leer tenant y operar datos del tenant, pero no cambiar configuración sensible de tenant.

columnas de billing/trial nunca se editan desde cliente; solo por RPC/backend seguro.

Eso encaja mejor con tu hardening actual y evita que un admin toque trial o suscripción accidentalmente aunque tenga acceso operativo.

Lo que yo corregiría en tu archivo final
Estos son los ajustes que haría antes de considerarlo “schema único final”:

Eliminar protect_tenant_billing() y dejar solo protect_tenant_billing_columns() o al revés, pero no ambas.

Dejar un solo trigger de billing sobre public.tenants.

Dejar una sola policy update_tenants y definir explícitamente si es owner o owner/admin.

Revisar si subscriptions debe tener solo select y nada de update para authenticated, porque ya quitaste update_subscriptions luego del hardening.

Separar visualmente el script en:

helpers,

core auth/multi-tenant,

catálogos,

inventario/ventas,

documentos,

auth hooks,

índices,

RLS,

hardening final.

Conclusión técnica
Sí tienes una muy buena base unificada, pero todavía no está totalmente “cerrada” porque el final del archivo reescribe decisiones previas y deja lógica duplicada. Antes de usarla como schema maestro, hay que hacer una limpieza final para que quede una sola verdad por función, trigger y policy.

Si quieres, en el siguiente mensaje te la devuelvo ya reorganizada completa, lista para pegar en Supabase SQL Editor, sin duplicados, con el bloque final corregido y con una versión canónica única.

Esto es lo que agregue
-- =========================================================================
-- F. FREE TRIAL · 14 DÍAS · SEMILLA, GUARDS Y JWT HOOK
-- =========================================================================


-- F.1 Plan semilla "free_trial" — sin esto, create_tenant_for_owner deja el
-- tenant sin fila en `subscriptions` (el lookup por code retorna NULL).


INSERT INTO public.subscription_plans (code, name, description, is_free, trial_days, is_active)
VALUES ('free_trial', 'Prueba Gratis', '14 días de prueba sin tarjeta', true, 14, true)
ON CONFLICT (code) DO UPDATE SET
  name        = EXCLUDED.name,
  description = EXCLUDED.description,
  is_free     = EXCLUDED.is_free,
  trial_days  = EXCLUDED.trial_days,
  is_active   = EXCLUDED.is_active;


-- F.2 CHECK constraint en tenants.business_type — alinea DB con el enum de
-- types.ts y previene escrituras de valores inválidos.


ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_business_type_check;
ALTER TABLE public.tenants
  ADD  CONSTRAINT tenants_business_type_check
  CHECK (business_type IS NULL OR business_type IN (
    'lubricentro', 'taller', 'autoservicio', 'ferreteria', 'otro'
  ));


-- F.3 Endurecer RLS: los owners/admins pueden actualizar el tenant, PERO
-- columnas de billing/trial son inmutables desde el cliente. Solo cambian
-- vía RPCs SECURITY DEFINER (creación, renovación, pago).


CREATE OR REPLACE FUNCTION public.protect_tenant_billing_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- auth.role() = 'authenticated' cuando viene del cliente con JWT de usuario.
  -- SECURITY DEFINER (RPCs internas) corre como el owner del SP → no bloquea.
  IF auth.role() = 'authenticated' THEN
    IF NEW.subscription_status    IS DISTINCT FROM OLD.subscription_status
    OR NEW.subscription_plan_code IS DISTINCT FROM OLD.subscription_plan_code
    OR NEW.trial_starts_at        IS DISTINCT FROM OLD.trial_starts_at
    OR NEW.trial_ends_at          IS DISTINCT FROM OLD.trial_ends_at THEN
      RAISE EXCEPTION USING
        ERRCODE = 'insufficient_privilege',
        MESSAGE = 'No se puede modificar billing/trial desde el cliente';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS trg_tenants_protect_billing ON public.tenants;
CREATE TRIGGER trg_tenants_protect_billing
BEFORE UPDATE ON public.tenants
FOR EACH ROW EXECUTE PROCEDURE public.protect_tenant_billing_columns();


-- Subscriptions: revocar UPDATE/DELETE público. Se manejan vía RPCs.
DROP POLICY IF EXISTS "update_subscriptions" ON public.subscriptions;


-- F.4 Sync de auth.users → public.users en UPDATE
-- Mantiene email, full_name, phone, avatar, last_sign_in_at, etc. al día.


CREATE OR REPLACE FUNCTION public.handle_user_meta_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.users SET
    email           = COALESCE(NEW.email, email),
    full_name       = COALESCE(NEW.raw_user_meta_data ->> 'full_name', full_name),
    phone           = COALESCE(NEW.raw_user_meta_data ->> 'phone', phone),
    avatar_url      = COALESCE(NEW.raw_user_meta_data ->> 'avatar_url', avatar_url),
    email_confirmed = COALESCE(NEW.email_confirmed_at IS NOT NULL, email_confirmed),
    last_sign_in_at = COALESCE(NEW.last_sign_in_at, last_sign_in_at)
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
CREATE TRIGGER on_auth_user_updated
AFTER UPDATE ON auth.users
FOR EACH ROW EXECUTE PROCEDURE public.handle_user_meta_update();


-- F.5 Custom Access Token Hook — INYECTA CLAIMS EN EL JWT
-- Supabase Auth GoTrue invoca esta función al emitir/refrescar el access
-- token. Le añadimos: tenant_id, tenant_role, trial_ends_at,
-- subscription_status, onboarding_completed.
--
-- ⚠️ Activar manualmente en Dashboard:
--    Authentication → Hooks → Custom Access Token Hook
--    → public.custom_access_token_hook


CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := (event->>'user_id')::uuid;
  v_claims  jsonb := event->'claims';
  v_tenant_id           uuid;
  v_role                text;
  v_trial_ends_at       timestamptz;
  v_subscription_status text;
  v_onboarding_completed boolean;
BEGIN
  -- Tolerancia a fallos: si la consulta falla por cualquier motivo,
  -- emitimos el JWT sin claims custom y el middleware/layout degradan
  -- al fallback de DB. NUNCA debemos bloquear la emisión del token.
  BEGIN
    SELECT tm.tenant_id, tm.role,
           t.trial_ends_at, t.subscription_status, t.onboarding_completed
      INTO v_tenant_id, v_role, v_trial_ends_at, v_subscription_status, v_onboarding_completed
    FROM public.tenant_memberships tm
    JOIN public.tenants t ON t.id = tm.tenant_id
    WHERE tm.user_id = v_user_id AND tm.is_active = true
    ORDER BY tm.is_owner DESC, tm.joined_at ASC
    LIMIT 1;


    IF v_tenant_id IS NOT NULL THEN
      v_claims := v_claims || jsonb_build_object(
        'tenant_id',            v_tenant_id,
        'tenant_role',          v_role,
        'trial_ends_at',        v_trial_ends_at,
        'subscription_status',  v_subscription_status,
        'onboarding_completed', v_onboarding_completed
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- log del error a Postgres logs, sin propagar.
    RAISE WARNING 'custom_access_token_hook failed for user %: % / %',
                  v_user_id, SQLSTATE, SQLERRM;
  END;


  RETURN jsonb_build_object('claims', v_claims);
END;
$$;


GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;
GRANT SELECT ON public.tenants TO supabase_auth_admin;
GRANT SELECT ON public.tenant_memberships TO supabase_auth_admin;


-- F.6 Política RLS para que supabase_auth_admin lea sin restricción de tenant
-- (el hook necesita ver TODO para construir claims; corre como GoTrue, no como user).
-- supabase_auth_admin no aplica a `authenticated` policies, pero RLS bloquea por
-- defecto a roles no-superuser que no tengan policy. Le damos BYPASSRLS implícito
-- vía las policies dedicadas:


DROP POLICY IF EXISTS "auth_admin_select_tenant_memberships" ON public.tenant_memberships;
CREATE POLICY "auth_admin_select_tenant_memberships"
  ON public.tenant_memberships FOR SELECT
  TO supabase_auth_admin
  USING (true);


DROP POLICY IF EXISTS "auth_admin_select_tenants" ON public.tenants;
CREATE POLICY "auth_admin_select_tenants"
  ON public.tenants FOR SELECT
  TO supabase_auth_admin
  USING (true);


-- F.7 Índice para acelerar la query del hook (se invoca en cada token issue/refresh).
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_user_active
  ON public.tenant_memberships(user_id) WHERE is_active = true;


  CREATE OR REPLACE FUNCTION public.protect_tenant_billing()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Si el usuario que ejecuta no es postgres ni el service_role, bloqueamos cambios
  IF current_setting('role') = 'authenticated' THEN
    IF NEW.trial_starts_at IS DISTINCT FROM OLD.trial_starts_at OR
       NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at OR
       NEW.subscription_status IS DISTINCT FROM OLD.subscription_status OR
       NEW.subscription_plan_code IS DISTINCT FROM OLD.subscription_plan_code
    THEN
      RAISE EXCEPTION 'No tienes permiso para modificar los datos de facturación o trial directamente.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_protect_tenant_billing ON public.tenants;
CREATE TRIGGER trg_protect_tenant_billing
BEFORE UPDATE ON public.tenants
FOR EACH ROW EXECUTE PROCEDURE public.protect_tenant_billing();


DROP POLICY IF EXISTS "update_tenants" ON public.tenants;
CREATE POLICY "update_tenants" ON public.tenants FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = id AND tm.user_id = auth.uid() AND tm.role = 'owner' AND tm.is_active = true))
WITH CHECK (EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = id AND tm.user_id = auth.uid() AND tm.role = 'owner' AND tm.is_active = true)); y este es el que tengo ahora mira bien porfavor el archivo dame de una vez todo en uno solo ya puesto estas mejoras que te dije y que opinas?

paste.txt


script.py
Código

consolidated_schema.sql
SQL
Sí, ya vi bien lo que agregaste y va en la dirección correcta, pero en tu versión todavía había duplicación de guardias de billing y riesgo de que una policy sobrescriba la otra de forma silenciosa. Te dejé todo unificado en un solo archivo SQL consolidado, con free_trial, business_type check, sync de auth.users, JWT hook, guard de billing, RLS y el flujo base ordenado en una sola pieza .

Qué opino
La idea está bien: separar fuente de verdad en DB de claims del JWT como caché es la decisión correcta para evitar loops de onboarding. También está bien endurecer tenants para que subscription_status, subscription_plan_code y fechas de trial no se toquen desde el cliente, sino solo vía RPC/funciones seguras.

Lo único que te estaba dañando era esto:

duplicaste la lógica de protección de billing,

mezclaste dos estilos de guard (auth.role() y current_setting('role')),

y dejaste políticas que podían contradecirse por orden de ejecución.

Qué te entregué
Creé un archivo consolidado aquí:

output/consolidated_schema.sql

Ese archivo ya trae:

subscription_plans con seed free_trial,

tenants con check de business_type,

handle_new_user y handle_user_meta_update,

create_tenant_for_owner,

protect_tenant_billing_columns,

custom_access_token_hook,

índice para tenant_memberships(user_id) activo,

y RLS organizado para users, tenant_memberships, tenants y subscriptions .

Punto importante
Todavía hay una decisión de negocio que debes confirmar en tu app: update_tenants debe quedar solo para owner, no para admin, si quieres que administración y facturación permanezcan estrictamente separadas. Yo lo dejé así en el consolidado porque encaja mejor con el guard de billing que agregaste.

Siguiente paso recomendado
Pega ese SQL consolidado en Supabase y valida en este orden:

que cree o actualice free_trial,

que no falle handle_user_meta_update,

que el hook custom_access_token_hook esté activado en Auth,

que tenant_memberships y tenants sigan accesibles para supabase_auth_admin,

que el login ya no dependa del claim para decidir /onboarding vs /dashboard.

¿Quieres que te saque ahora una segunda versión final aún más limpia, donde además te elimine los bloques que no forman parte del core multi-tenant y te deje solo lo estrictamente necesario para producción?

ya dame los que tu mejoraste para ponerle en supabase solo lo que tu mejoraste para poner

consolidated_schema
-- CONSOLIDATED SUPABASE SCHEMA
-- Includes: core schema, auth sync, onboarding/billing guards, JWT hook, RLS, indexes

create extension if not exists "pgcrypto";

-- =========================
-- HELPERS
-- =========================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================
-- PLANES / SUSCRIPCIONES
-- =========================

create table if not exists public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  is_free boolean not null default false,
  trial_days integer check (trial_days >= 0),
  limits jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique,
  plan_id uuid not null references public.subscription_plans(id) on delete restrict,
  status text not null check (status in ('trial', 'active', 'past_due', 'canceled', 'unpaid')),
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_subscriptions_updated_at on public.subscriptions;
create trigger trg_subscriptions_updated_at
before update on public.subscriptions
for each row execute procedure public.set_updated_at();

insert into public.subscription_plans (code, name, description, is_free, trial_days, is_active)
values ('free_trial', 'Prueba Gratis', '14 días de prueba sin tarjeta', true, 14, true)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  is_free = excluded.is_free,
  trial_days = excluded.trial_days,
  is_act
