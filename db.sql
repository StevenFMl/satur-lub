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

-- =========================
-- TENANTS / USERS / AUTH
-- =========================

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  legal_name text,
  business_name text not null,
  slug text not null unique,
  ruc varchar(13),
  contributor_type text,
  taxpayer_regime text,
  business_type text,
  onboarding_completed boolean not null default false,
  subscription_plan_code text,
  subscription_status text not null default 'trial',
  trial_starts_at timestamptz not null default now(),
  trial_ends_at timestamptz,
  branding jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_by_user_id uuid, -- Se deja a users porque el tenant_membership aún no existe al crearlo
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (trial_ends_at is null or trial_ends_at >= trial_starts_at)
);

drop trigger if exists trg_tenants_updated_at on public.tenants;
create trigger trg_tenants_updated_at
before update on public.tenants
for each row execute procedure public.set_updated_at();

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  phone text,
  avatar_url text,
  default_tenant_id uuid references public.tenants(id) on delete restrict,
  global_role text not null default 'user',
  is_active boolean not null default true,
  email_confirmed boolean not null default false,
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_users_updated_at on public.users;
create trigger trg_users_updated_at
before update on public.users
for each row execute procedure public.set_updated_at();

create table if not exists public.tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'user')), 
  is_owner boolean not null default false,
  is_active boolean not null default true,
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

drop trigger if exists trg_tenant_memberships_updated_at on public.tenant_memberships;
create trigger trg_tenant_memberships_updated_at
before update on public.tenant_memberships
for each row execute procedure public.set_updated_at();

create table if not exists public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete restrict,
  ip_address inet,
  user_agent text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.user_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  email text not null,
  role text not null check (role in ('admin', 'user')),
  invited_by_user_id uuid not null,
  token text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, invited_by_user_id) references public.tenant_memberships(tenant_id, user_id) on delete restrict
);

-- =========================
-- ORGANIZACIÓN / SUCURSALES
-- =========================

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  org_name text not null,
  address jsonb not null default '{}'::jsonb,
  phone text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);

drop trigger if exists trg_organizations_updated_at on public.organizations;
create trigger trg_organizations_updated_at
before update on public.organizations
for each row execute procedure public.set_updated_at();

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  organization_id uuid not null,
  branch_name text not null,
  address jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, organization_id) references public.organizations(tenant_id, id) on delete restrict
);

drop trigger if exists trg_branches_updated_at on public.branches;
create trigger trg_branches_updated_at
before update on public.branches
for each row execute procedure public.set_updated_at();

-- =========================
-- CLIENTES / PROVEEDORES / VEHÍCULOS
-- =========================

create table if not exists public.business_partners (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  partner_type text not null check (partner_type in ('customer', 'supplier', 'distributor')), 
  document_type text not null check (document_type in ('CEDULA', 'RUC', 'CONSUMIDOR_FINAL', 'PASAPORTE')), 
  document_number varchar(20) not null,
  full_name text not null,
  email text,
  phone text,
  address jsonb not null default '{}'::jsonb,
  customer_category text not null default 'minorista',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, document_type, document_number),
  unique (tenant_id, id)
);

drop trigger if exists trg_business_partners_updated_at on public.business_partners;
create trigger trg_business_partners_updated_at
before update on public.business_partners
for each row execute procedure public.set_updated_at();

create table if not exists public.partner_roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  partner_id uuid not null,
  role text not null check (role in ('customer', 'supplier', 'mechanic')),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, partner_id) references public.business_partners(tenant_id, id) on delete restrict
);

create table if not exists public.customer_vehicles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  customer_id uuid not null,
  plate text,
  vin text,
  brand text,
  model text,
  year integer check (year > 1900 and year < 2100),
  color text,
  mileage numeric(12,2) check (mileage >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, customer_id) references public.business_partners(tenant_id, id) on delete restrict
);

drop trigger if exists trg_customer_vehicles_updated_at on public.customer_vehicles;
create trigger trg_customer_vehicles_updated_at
before update on public.customer_vehicles
for each row execute procedure public.set_updated_at();

-- =========================
-- EMPLEADOS / TÉCNICOS
-- =========================

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  full_name text not null,
  email text,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);

drop trigger if exists trg_employees_updated_at on public.employees;
create trigger trg_employees_updated_at
before update on public.employees
for each row execute procedure public.set_updated_at();

create table if not exists public.technicians (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  employee_id uuid not null,
  commission_type text default 'none' check (commission_type in ('none', 'percentage', 'fixed')),
  commission_value numeric(12,2) check (commission_value >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, employee_id) references public.employees(tenant_id, id) on delete restrict
);

-- =========================
-- PRODUCTOS / CATEGORÍAS / MARCAS / PRECIOS
-- =========================

create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name),
  unique (tenant_id, id)
);

drop trigger if exists trg_product_categories_updated_at on public.product_categories;
create trigger trg_product_categories_updated_at
before update on public.product_categories
for each row execute procedure public.set_updated_at();

create table if not exists public.product_brands (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, name),
  unique (tenant_id, id)
);

create table if not exists public.price_tiers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  code text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, code),
  unique (tenant_id, id)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  category_id uuid,
  brand_id uuid,
  sku text not null,
  barcode text,
  name text not null,
  description text,
  product_kind text not null default 'item' check (product_kind in ('item', 'service', 'kit')),
  unit text not null default 'unidad',
  cost_price numeric(12,2) default 0 check (cost_price >= 0),
  tax_rate numeric(5,2) not null default 15.00 check (tax_rate >= 0),
  track_inventory boolean not null default true,
  attributes jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, sku),
  unique (tenant_id, id),
  foreign key (tenant_id, category_id) references public.product_categories(tenant_id, id) on delete restrict,
  foreign key (tenant_id, brand_id) references public.product_brands(tenant_id, id) on delete restrict,
  foreign key (tenant_id, created_by) references public.tenant_memberships(tenant_id, user_id) on delete restrict
);

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
before update on public.products
for each row execute procedure public.set_updated_at();

create table if not exists public.product_prices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  product_id uuid not null,
  price_tier_id uuid not null,
  unit_price numeric(12,2) not null check (unit_price >= 0),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from),
  foreign key (tenant_id, product_id) references public.products(tenant_id, id) on delete restrict,
  foreign key (tenant_id, price_tier_id) references public.price_tiers(tenant_id, id) on delete restrict
);

create table if not exists public.product_price_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  product_id uuid not null,
  price_tier_id uuid not null,
  old_price numeric(12,2) check (old_price >= 0),
  new_price numeric(12,2) not null check (new_price >= 0),
  changed_by uuid,
  changed_at timestamptz not null default now(),
  foreign key (tenant_id, product_id) references public.products(tenant_id, id) on delete restrict,
  foreign key (tenant_id, price_tier_id) references public.price_tiers(tenant_id, id) on delete restrict,
  foreign key (tenant_id, changed_by) references public.tenant_memberships(tenant_id, user_id) on delete restrict
);

create table if not exists public.quick_catalog_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  name text not null,
  category_hint text,
  unit text not null default 'unidad',
  suggested_price numeric(12,2) check (suggested_price >= 0),
  attributes jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.kits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  product_id uuid not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, product_id) references public.products(tenant_id, id) on delete restrict
);

create table if not exists public.kit_components (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  kit_id uuid not null,
  component_product_id uuid not null,
  quantity numeric(12,2) not null check (quantity > 0),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, kit_id) references public.kits(tenant_id, id) on delete restrict,
  foreign key (tenant_id, component_product_id) references public.products(tenant_id, id) on delete restrict
);

-- =========================
-- INVENTARIO
-- =========================

create table if not exists public.warehouses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  branch_id uuid,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, branch_id) references public.branches(tenant_id, id) on delete restrict
);

create table if not exists public.inventory_balances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  warehouse_id uuid not null,
  product_id uuid not null,
  quantity_on_hand numeric(12,2) not null default 0,
  updated_at timestamptz not null default now(),
  unique (tenant_id, warehouse_id, product_id),
  foreign key (tenant_id, warehouse_id) references public.warehouses(tenant_id, id) on delete restrict,
  foreign key (tenant_id, product_id) references public.products(tenant_id, id) on delete restrict
);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  warehouse_id uuid,
  product_id uuid not null,
  movement_type text not null check (movement_type in ('in', 'out', 'adjustment', 'sale', 'purchase', 'transfer')),
  quantity numeric(12,2) not null check (quantity > 0),
  unit_cost numeric(12,2) check (unit_cost >= 0),
  reason text not null,
  reference_type text,
  reference_id uuid,
  performed_by_user_id uuid,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, warehouse_id) references public.warehouses(tenant_id, id) on delete restrict,
  foreign key (tenant_id, product_id) references public.products(tenant_id, id) on delete restrict,
  foreign key (tenant_id, performed_by_user_id) references public.tenant_memberships(tenant_id, user_id) on delete restrict
);

create table if not exists public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  from_warehouse_id uuid,
  to_warehouse_id uuid,
  status text not null default 'draft' check (status in ('draft', 'pending', 'completed', 'cancelled')),
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, from_warehouse_id) references public.warehouses(tenant_id, id) on delete restrict,
  foreign key (tenant_id, to_warehouse_id) references public.warehouses(tenant_id, id) on delete restrict,
  foreign key (tenant_id, created_by) references public.tenant_memberships(tenant_id, user_id) on delete restrict
);

drop trigger if exists trg_stock_transfers_updated_at on public.stock_transfers;
create trigger trg_stock_transfers_updated_at
before update on public.stock_transfers
for each row execute procedure public.set_updated_at();

create table if not exists public.stock_transfer_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  stock_transfer_id uuid not null,
  product_id uuid not null,
  quantity numeric(12,2) not null check (quantity > 0),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, stock_transfer_id) references public.stock_transfers(tenant_id, id) on delete restrict,
  foreign key (tenant_id, product_id) references public.products(tenant_id, id) on delete restrict
);

-- =========================
-- COMPRAS / VENTAS / POS / CAJA / ORDENES TRABAJO
-- =========================

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  supplier_id uuid not null,
  warehouse_id uuid,
  document_number text,
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  tax_total numeric(12,2) not null default 0 check (tax_total >= 0),
  total numeric(12,2) not null default 0 check (total >= 0),
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'received', 'cancelled')),
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, supplier_id) references public.business_partners(tenant_id, id) on delete restrict,
  foreign key (tenant_id, warehouse_id) references public.warehouses(tenant_id, id) on delete restrict,
  foreign key (tenant_id, created_by) references public.tenant_memberships(tenant_id, user_id) on delete restrict
);

drop trigger if exists trg_purchase_orders_updated_at on public.purchase_orders;
create trigger trg_purchase_orders_updated_at
before update on public.purchase_orders
for each row execute procedure public.set_updated_at();

create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  purchase_order_id uuid not null,
  product_id uuid not null,
  quantity numeric(12,2) not null check (quantity > 0),
  unit_cost numeric(12,2) not null check (unit_cost >= 0),
  line_total numeric(12,2) not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, purchase_order_id) references public.purchase_orders(tenant_id, id) on delete restrict,
  foreign key (tenant_id, product_id) references public.products(tenant_id, id) on delete restrict
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  branch_id uuid,
  warehouse_id uuid,
  customer_id uuid not null,
  created_by_user_id uuid,
  document_kind text not null default 'invoice' check (document_kind in ('invoice', 'ticket', 'quote', 'note')),
  subtotal numeric(12,2) not null check (subtotal >= 0),
  discount_total numeric(12,2) not null default 0 check (discount_total >= 0),
  tax_total numeric(12,2) not null check (tax_total >= 0),
  total numeric(12,2) not null check (total >= 0),
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, branch_id) references public.branches(tenant_id, id) on delete restrict,
  foreign key (tenant_id, warehouse_id) references public.warehouses(tenant_id, id) on delete restrict,
  foreign key (tenant_id, customer_id) references public.business_partners(tenant_id, id) on delete restrict,
  foreign key (tenant_id, created_by_user_id) references public.tenant_memberships(tenant_id, user_id) on delete restrict
);

drop trigger if exists trg_sales_updated_at on public.sales;
create trigger trg_sales_updated_at
before update on public.sales
for each row execute procedure public.set_updated_at();

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  sale_id uuid not null,
  product_id uuid not null,
  quantity numeric(12,2) not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  discount_amount numeric(12,2) not null default 0 check (discount_amount >= 0),
  tax_rate numeric(5,2) not null default 15.00 check (tax_rate >= 0),
  line_total numeric(12,2) not null check (line_total >= 0),
  is_kit boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, sale_id) references public.sales(tenant_id, id) on delete restrict,
  foreign key (tenant_id, product_id) references public.products(tenant_id, id) on delete restrict
);

create table if not exists public.sale_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  sale_id uuid not null,
  payment_method text not null check (payment_method in ('cash', 'card', 'transfer', 'credit')),
  amount numeric(12,2) not null check (amount > 0),
  reference text,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, sale_id) references public.sales(tenant_id, id) on delete restrict
);

create table if not exists public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  branch_id uuid,
  opened_by uuid,
  closed_by uuid,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opening_amount numeric(12,2) not null default 0 check (opening_amount >= 0),
  closing_amount numeric(12,2) check (closing_amount >= 0),
  expected_amount numeric(12,2) check (expected_amount >= 0),
  status text not null default 'open' check (status in ('open', 'closed', 'reconciled')),
  unique (tenant_id, id),
  foreign key (tenant_id, branch_id) references public.branches(tenant_id, id) on delete restrict,
  foreign key (tenant_id, opened_by) references public.tenant_memberships(tenant_id, user_id) on delete restrict,
  foreign key (tenant_id, closed_by) references public.tenant_memberships(tenant_id, user_id) on delete restrict
);

create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  cash_session_id uuid,
  sale_id uuid,
  movement_type text not null check (movement_type in ('income', 'expense', 'opening', 'closing', 'adjustment')),
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  created_by uuid,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, cash_session_id) references public.cash_sessions(tenant_id, id) on delete restrict,
  foreign key (tenant_id, sale_id) references public.sales(tenant_id, id) on delete restrict,
  foreign key (tenant_id, created_by) references public.tenant_memberships(tenant_id, user_id) on delete restrict
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  branch_id uuid,
  description text not null,
  category text,
  amount numeric(12,2) not null check (amount > 0),
  expense_date date not null default current_date,
  created_by uuid,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, branch_id) references public.branches(tenant_id, id) on delete restrict,
  foreign key (tenant_id, created_by) references public.tenant_memberships(tenant_id, user_id) on delete restrict
);

create table if not exists public.work_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  branch_id uuid,
  customer_id uuid not null,
  vehicle_id uuid,
  mileage numeric(12,2) check (mileage >= 0),
  status text not null default 'open' check (status in ('open', 'in_progress', 'completed', 'cancelled')),
  notes text,
  total_estimated numeric(12,2) default 0 check (total_estimated >= 0),
  total_final numeric(12,2) default 0 check (total_final >= 0),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, branch_id) references public.branches(tenant_id, id) on delete restrict,
  foreign key (tenant_id, customer_id) references public.business_partners(tenant_id, id) on delete restrict,
  foreign key (tenant_id, vehicle_id) references public.customer_vehicles(tenant_id, id) on delete restrict,
  foreign key (tenant_id, created_by) references public.tenant_memberships(tenant_id, user_id) on delete restrict
);

drop trigger if exists trg_work_orders_updated_at on public.work_orders;
create trigger trg_work_orders_updated_at
before update on public.work_orders
for each row execute procedure public.set_updated_at();

create table if not exists public.work_order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  work_order_id uuid not null,
  product_id uuid,
  description text,
  quantity numeric(12,2) not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  line_total numeric(12,2) not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, work_order_id) references public.work_orders(tenant_id, id) on delete restrict,
  foreign key (tenant_id, product_id) references public.products(tenant_id, id) on delete restrict
);

create table if not exists public.work_order_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  work_order_id uuid not null,
  technician_id uuid not null,
  assigned_at timestamptz not null default now(),
  foreign key (tenant_id, work_order_id) references public.work_orders(tenant_id, id) on delete restrict,
  foreign key (tenant_id, technician_id) references public.technicians(tenant_id, id) on delete restrict
);

create table if not exists public.technician_commissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  technician_id uuid not null,
  work_order_id uuid,
  sale_id uuid,
  amount numeric(12,2) not null check (amount >= 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled')),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, technician_id) references public.technicians(tenant_id, id) on delete restrict,
  foreign key (tenant_id, work_order_id) references public.work_orders(tenant_id, id) on delete restrict,
  foreign key (tenant_id, sale_id) references public.sales(tenant_id, id) on delete restrict
);

-- =========================
-- DOCUMENTOS / SRI
-- =========================

create table if not exists public.document_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.document_sequences (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  branch_id uuid,
  document_type_id uuid not null references public.document_types(id) on delete restrict,
  establishment_code varchar(3),
  emission_point_code varchar(3),
  current_sequence integer not null default 1 check (current_sequence > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, branch_id, document_type_id, establishment_code, emission_point_code),
  foreign key (tenant_id, branch_id) references public.branches(tenant_id, id) on delete restrict
);

create table if not exists public.commercial_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  sale_id uuid,
  document_type_id uuid not null references public.document_types(id) on delete restrict,
  sequence_number text,
  issue_date date not null default current_date,
  status text not null default 'draft' check (status in ('draft', 'authorized', 'rejected', 'cancelled')),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, sale_id) references public.sales(tenant_id, id) on delete restrict
);

create table if not exists public.document_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  sale_id uuid not null unique,
  job_type text not null,
  state text not null default 'pending' check (state in ('pending', 'processing', 'completed', 'failed')),
  payload_snapshot jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  last_attempt_at timestamptz,
  retry_count integer not null default 0 check (retry_count >= 0),
  max_retries integer not null default 5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, sale_id) references public.sales(tenant_id, id) on delete restrict
);

drop trigger if exists trg_document_jobs_updated_at on public.document_jobs;
create trigger trg_document_jobs_updated_at
before update on public.document_jobs
for each row execute procedure public.set_updated_at();

create table if not exists public.document_job_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict, 
  document_job_id uuid not null,
  event_type text not null,
  payload jsonb,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, document_job_id) references public.document_jobs(tenant_id, id) on delete restrict
);

create table if not exists public.electronic_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  sale_id uuid not null unique,
  access_key varchar(49) unique,
  authorization_number varchar(49) unique,
  authorization_date timestamptz,
  xml_signed_url text,
  xml_authorized_url text,
  pdf_url text,
  sri_status text not null default 'pending' check (sri_status in ('pending', 'authorized', 'rejected', 'returned')),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, sale_id) references public.sales(tenant_id, id) on delete restrict
);

create table if not exists public.tenant_sri_credentials (
  tenant_id uuid primary key references public.tenants(id) on delete restrict,
  password_sri_encrypted bytea,
  p12_storage_key text not null,
  sri_environment text not null default 'prueba' check (sri_environment in ('prueba', 'produccion')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_tenant_sri_credentials_updated_at on public.tenant_sri_credentials;
create trigger trg_tenant_sri_credentials_updated_at
before update on public.tenant_sri_credentials
for each row execute procedure public.set_updated_at();

-- =========================
-- REPORTES / EXPORTS / API / AUDIT
-- =========================

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  name text not null,
  key_hash text not null unique,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.report_exports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  export_type text not null,
  file_url text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  requested_by uuid,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, requested_by) references public.tenant_memberships(tenant_id, user_id) on delete restrict
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete restrict,
  user_id uuid,
  entity_name text not null,
  entity_id uuid,
  action text not null,
  old_values jsonb,
  new_values jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, user_id) references public.tenant_memberships(tenant_id, user_id) on delete set null
);

-- =========================
-- FUNCIONES DE AUTH Y TENANT
-- =========================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (
    id, email, full_name, phone, avatar_url, email_confirmed, last_sign_in_at
  )
  values (
    new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.raw_user_meta_data ->> 'phone', new.raw_user_meta_data ->> 'avatar_url',
    coalesce(new.email_confirmed_at is not null, false), new.last_sign_in_at
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.create_tenant_for_owner(
  p_business_name text, p_slug text, p_legal_name text default null,
  p_ruc varchar(13) default null, p_business_type text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_tenant_id uuid;
  v_plan_id uuid;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;

  insert into public.tenants (
    business_name, slug, legal_name, ruc, business_type, created_by_user_id,
    subscription_plan_code, subscription_status, trial_ends_at,
    onboarding_completed
  )
  values (
    p_business_name, p_slug, p_legal_name, p_ruc, p_business_type, v_user_id,
    'free_trial', 'trial', now() + interval '14 days',
    true
  )
  returning id into v_tenant_id;

  update public.users set default_tenant_id = v_tenant_id where id = v_user_id;

  insert into public.tenant_memberships (tenant_id, user_id, role, is_owner)
  values (v_tenant_id, v_user_id, 'owner', true);

  -- Suscripción 'free_trial' automática: lookup tras crear tenant + membership.
  select id into v_plan_id
    from public.subscription_plans
    where code = 'free_trial'
    limit 1;

  if v_plan_id is null then
    raise exception 'Plan free_trial no configurado';
  end if;

  insert into public.subscriptions (
    tenant_id, plan_id, status, current_period_start, current_period_end
  )
  values (
    v_tenant_id, v_plan_id, 'trial', now(), now() + interval '14 days'
  );

  return v_tenant_id;
end;
$$;

revoke all on function public.create_tenant_for_owner from public;
grant execute on function public.create_tenant_for_owner to authenticated;

-- =========================
-- ÍNDICES COMPUESTOS CRÍTICOS (IF NOT EXISTS)
-- =========================

create index if not exists idx_tenant_memberships_tu on public.tenant_memberships(tenant_id, user_id);
create index if not exists idx_business_partners_tenant_doc on public.business_partners(tenant_id, document_type, document_number);
create index if not exists idx_products_tenant_name on public.products(tenant_id, name);
create index if not exists idx_products_tenant_category on public.products(tenant_id, category_id);
create index if not exists idx_product_prices_tenant_product on public.product_prices(tenant_id, product_id);
create index if not exists idx_inventory_balances_tenant_product on public.inventory_balances(tenant_id, product_id);
create index if not exists idx_inventory_movements_tenant_product on public.inventory_movements(tenant_id, product_id);
create index if not exists idx_sales_tenant_created_at on public.sales(tenant_id, created_at desc);
create index if not exists idx_sale_items_tenant_sale on public.sale_items(tenant_id, sale_id);
create index if not exists idx_work_orders_tenant_created_at on public.work_orders(tenant_id, created_at desc);
create index if not exists idx_electronic_documents_tenant_sale on public.electronic_documents(tenant_id, sale_id);

-- =========================
-- RLS (ROW LEVEL SECURITY) - IMPLEMENTACIÓN ESTRICTA Y SEGMENTADA
-- =========================

alter table public.subscription_plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.tenants enable row level security;
alter table public.users enable row level security;
alter table public.tenant_memberships enable row level security;
alter table public.user_sessions enable row level security;
alter table public.user_invites enable row level security;
alter table public.organizations enable row level security;
alter table public.branches enable row level security;
alter table public.business_partners enable row level security;
alter table public.partner_roles enable row level security;
alter table public.customer_vehicles enable row level security;
alter table public.employees enable row level security;
alter table public.technicians enable row level security;
alter table public.product_categories enable row level security;
alter table public.product_brands enable row level security;
alter table public.price_tiers enable row level security;
alter table public.products enable row level security;
alter table public.product_prices enable row level security;
alter table public.product_price_history enable row level security;
alter table public.quick_catalog_items enable row level security;
alter table public.kits enable row level security;
alter table public.kit_components enable row level security;
alter table public.warehouses enable row level security;
alter table public.inventory_balances enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.stock_transfers enable row level security;
alter table public.stock_transfer_items enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.sale_payments enable row level security;
alter table public.cash_sessions enable row level security;
alter table public.cash_movements enable row level security;
alter table public.expenses enable row level security;
alter table public.work_orders enable row level security;
alter table public.work_order_items enable row level security;
alter table public.work_order_assignments enable row level security;
alter table public.technician_commissions enable row level security;
alter table public.document_types enable row level security;
alter table public.document_sequences enable row level security;
alter table public.commercial_documents enable row level security;
alter table public.document_jobs enable row level security;
alter table public.document_job_attempts enable row level security;
alter table public.electronic_documents enable row level security;
alter table public.tenant_sri_credentials enable row level security;
alter table public.api_keys enable row level security;
alter table public.report_exports enable row level security;
alter table public.audit_logs enable row level security;

-- ==========================================
-- A. TABLAS GLOBALES Y USUARIOS
-- ==========================================

drop policy if exists "select_document_types" on public.document_types;
create policy "select_document_types" on public.document_types for select to authenticated using (true);

drop policy if exists "select_subscription_plans" on public.subscription_plans;
create policy "select_subscription_plans" on public.subscription_plans for select to authenticated using (is_active = true);

drop policy if exists "select_own_user" on public.users;
create policy "select_own_user" on public.users for select to authenticated using (id = auth.uid());

drop policy if exists "update_own_user" on public.users;
create policy "update_own_user" on public.users for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ==========================================
-- B. NÚCLEO MULTI-TENANT (TENANTS & MEMBERSHIPS)
-- ==========================================

drop policy if exists "select_tenant_memberships" on public.tenant_memberships;
create policy "select_tenant_memberships" on public.tenant_memberships for select to authenticated
using (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = tenant_memberships.tenant_id AND tm.user_id = auth.uid() AND tm.role IN ('owner', 'admin') AND tm.is_active = true));

drop policy if exists "insert_tenant_memberships" on public.tenant_memberships;
create policy "insert_tenant_memberships" on public.tenant_memberships for insert to authenticated
with check (EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = tenant_id AND tm.user_id = auth.uid() AND tm.role = 'owner' AND tm.is_active = true));

drop policy if exists "update_tenant_memberships" on public.tenant_memberships;
create policy "update_tenant_memberships" on public.tenant_memberships for update to authenticated
using (EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = tenant_id AND tm.user_id = auth.uid() AND tm.role = 'owner' AND tm.is_active = true))
with check (EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = tenant_id AND tm.user_id = auth.uid() AND tm.role = 'owner' AND tm.is_active = true));

drop policy if exists "delete_tenant_memberships" on public.tenant_memberships;
create policy "delete_tenant_memberships" on public.tenant_memberships for delete to authenticated
using (EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = tenant_id AND tm.user_id = auth.uid() AND tm.role = 'owner' AND tm.is_active = true));

drop policy if exists "select_tenants" on public.tenants;
create policy "select_tenants" on public.tenants for select to authenticated
using (EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = id AND tm.user_id = auth.uid() AND tm.is_active = true));

drop policy if exists "update_tenants" on public.tenants;
create policy "update_tenants" on public.tenants for update to authenticated
using (EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = id AND tm.user_id = auth.uid() AND tm.role IN ('owner', 'admin') AND tm.is_active = true))
with check (EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = id AND tm.user_id = auth.uid() AND tm.role IN ('owner', 'admin') AND tm.is_active = true));

drop policy if exists "select_sri_credentials" on public.tenant_sri_credentials;
create policy "select_sri_credentials" on public.tenant_sri_credentials for select to authenticated
using (EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = tenant_id AND tm.user_id = auth.uid() AND tm.role = 'owner' AND tm.is_active = true));

drop policy if exists "insert_sri_credentials" on public.tenant_sri_credentials;
create policy "insert_sri_credentials" on public.tenant_sri_credentials for insert to authenticated
with check (EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = tenant_id AND tm.user_id = auth.uid() AND tm.role = 'owner' AND tm.is_active = true));

drop policy if exists "update_sri_credentials" on public.tenant_sri_credentials;
create policy "update_sri_credentials" on public.tenant_sri_credentials for update to authenticated
using (EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = tenant_id AND tm.user_id = auth.uid() AND tm.role = 'owner' AND tm.is_active = true))
with check (EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = tenant_id AND tm.user_id = auth.uid() AND tm.role = 'owner' AND tm.is_active = true));

-- ==========================================
-- C. TABLAS DE ADMINISTRACIÓN Y CONTROL
-- ==========================================

drop policy if exists "select_user_sessions" on public.user_sessions;
create policy "select_user_sessions" on public.user_sessions for select to authenticated using (user_id = auth.uid());
drop policy if exists "insert_user_sessions" on public.user_sessions;
create policy "insert_user_sessions" on public.user_sessions for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "delete_user_sessions" on public.user_sessions;
create policy "delete_user_sessions" on public.user_sessions for delete to authenticated using (user_id = auth.uid());

drop policy if exists "select_subscriptions" on public.subscriptions;
create policy "select_subscriptions" on public.subscriptions for select to authenticated using (EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = tenant_id AND tm.user_id = auth.uid() AND tm.is_active = true));
drop policy if exists "update_subscriptions" on public.subscriptions;
create policy "update_subscriptions" on public.subscriptions for update to authenticated 
using (EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = tenant_id AND tm.user_id = auth.uid() AND tm.role IN ('owner', 'admin') AND tm.is_active = true))
with check (EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = tenant_id AND tm.user_id = auth.uid() AND tm.role IN ('owner', 'admin') AND tm.is_active = true));

drop policy if exists "select_user_invites" on public.user_invites;
create policy "select_user_invites" on public.user_invites for select to authenticated using (EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = tenant_id AND tm.user_id = auth.uid() AND tm.is_active = true));
drop policy if exists "insert_user_invites" on public.user_invites;
create policy "insert_user_invites" on public.user_invites for insert to authenticated with check (EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = tenant_id AND tm.user_id = auth.uid() AND tm.role IN ('owner', 'admin') AND tm.is_active = true));
drop policy if exists "delete_user_invites" on public.user_invites;
create policy "delete_user_invites" on public.user_invites for delete to authenticated using (EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = tenant_id AND tm.user_id = auth.uid() AND tm.role IN ('owner', 'admin') AND tm.is_active = true));

drop policy if exists "select_api_keys" on public.api_keys;
create policy "select_api_keys" on public.api_keys for select to authenticated using (EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = tenant_id AND tm.user_id = auth.uid() AND tm.role IN ('owner', 'admin') AND tm.is_active = true));
drop policy if exists "insert_api_keys" on public.api_keys;
create policy "insert_api_keys" on public.api_keys for insert to authenticated with check (EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = tenant_id AND tm.user_id = auth.uid() AND tm.role IN ('owner', 'admin') AND tm.is_active = true));
drop policy if exists "update_api_keys" on public.api_keys;
create policy "update_api_keys" on public.api_keys for update to authenticated 
using (EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = tenant_id AND tm.user_id = auth.uid() AND tm.role IN ('owner', 'admin') AND tm.is_active = true))
with check (EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = tenant_id AND tm.user_id = auth.uid() AND tm.role IN ('owner', 'admin') AND tm.is_active = true));
drop policy if exists "delete_api_keys" on public.api_keys;
create policy "delete_api_keys" on public.api_keys for delete to authenticated using (EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = tenant_id AND tm.user_id = auth.uid() AND tm.role IN ('owner', 'admin') AND tm.is_active = true));

drop policy if exists "select_report_exports" on public.report_exports;
create policy "select_report_exports" on public.report_exports for select to authenticated using (requested_by = auth.uid() OR EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = tenant_id AND tm.user_id = auth.uid() AND tm.role IN ('owner', 'admin') AND tm.is_active = true));
drop policy if exists "insert_report_exports" on public.report_exports;
create policy "insert_report_exports" on public.report_exports for insert to authenticated with check (EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = tenant_id AND tm.user_id = auth.uid() AND tm.is_active = true));

drop policy if exists "select_audit_logs" on public.audit_logs;
create policy "select_audit_logs" on public.audit_logs for select to authenticated using (EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = tenant_id AND tm.user_id = auth.uid() AND tm.role IN ('owner', 'admin') AND tm.is_active = true));

drop policy if exists "select_document_jobs" on public.document_jobs;
create policy "select_document_jobs" on public.document_jobs for select to authenticated using (EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = tenant_id AND tm.user_id = auth.uid() AND tm.is_active = true));

drop policy if exists "select_document_job_attempts" on public.document_job_attempts;
create policy "select_document_job_attempts" on public.document_job_attempts for select to authenticated using (EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = tenant_id AND tm.user_id = auth.uid() AND tm.is_active = true));

-- ==========================================
-- D. TABLAS MAESTRAS (ESCRITURA SÓLO OWNER/ADMIN)
-- ==========================================

DO $$
DECLARE
    t_name text;
    master_data_tables text[] := ARRAY[
        'organizations', 'branches', 'product_categories', 'product_brands', 'price_tiers',
        'products', 'product_prices', 'product_price_history', 'quick_catalog_items', 
        'kits', 'kit_components', 'warehouses', 'employees', 'technicians'
    ];
BEGIN
    FOREACH t_name IN ARRAY master_data_tables
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS "select_%1$s" ON public.%1$s;', t_name);
        EXECUTE format('
            CREATE POLICY "select_%1$s" ON public.%1$s FOR SELECT TO authenticated
            USING (EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = %1$s.tenant_id AND tm.user_id = auth.uid() AND tm.is_active = true));
        ', t_name);

        EXECUTE format('DROP POLICY IF EXISTS "insert_%1$s" ON public.%1$s;', t_name);
        EXECUTE format('
            CREATE POLICY "insert_%1$s" ON public.%1$s FOR INSERT TO authenticated
            WITH CHECK (EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = tenant_id AND tm.user_id = auth.uid() AND tm.role IN (''owner'', ''admin'') AND tm.is_active = true));
        ', t_name);

        EXECUTE format('DROP POLICY IF EXISTS "update_%1$s" ON public.%1$s;', t_name);
        EXECUTE format('
            CREATE POLICY "update_%1$s" ON public.%1$s FOR UPDATE TO authenticated
            USING (EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = %1$s.tenant_id AND tm.user_id = auth.uid() AND tm.role IN (''owner'', ''admin'') AND tm.is_active = true))
            WITH CHECK (EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = %1$s.tenant_id AND tm.user_id = auth.uid() AND tm.role IN (''owner'', ''admin'') AND tm.is_active = true));
        ', t_name);

        EXECUTE format('DROP POLICY IF EXISTS "delete_%1$s" ON public.%1$s;', t_name);
        EXECUTE format('
            CREATE POLICY "delete_%1$s" ON public.%1$s FOR DELETE TO authenticated
            USING (EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = %1$s.tenant_id AND tm.user_id = auth.uid() AND tm.role IN (''owner'', ''admin'') AND tm.is_active = true));
        ', t_name);
    END LOOP;
END
$$;

-- ==========================================
-- E. TABLAS TRANSACCIONALES (SIN DELETE PARA NADIE, INMUTABILIDAD OPERATIVA)
-- ==========================================

DO $$
DECLARE
    t_name text;
    tx_tables text[] := ARRAY[
        'business_partners', 'partner_roles', 'customer_vehicles',
        'inventory_balances', 'inventory_movements', 'stock_transfers', 'stock_transfer_items',
        'purchase_orders', 'purchase_order_items', 'sales', 'sale_items', 'sale_payments',
        'cash_sessions', 'cash_movements', 'expenses', 'work_orders', 'work_order_items',
        'work_order_assignments', 'technician_commissions', 'document_sequences',
        'commercial_documents', 'electronic_documents'
    ];
BEGIN
    FOREACH t_name IN ARRAY tx_tables
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS "select_%1$s" ON public.%1$s;', t_name);
        EXECUTE format('
            CREATE POLICY "select_%1$s" ON public.%1$s FOR SELECT TO authenticated
            USING (EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = %1$s.tenant_id AND tm.user_id = auth.uid() AND tm.is_active = true));
        ', t_name);

        EXECUTE format('DROP POLICY IF EXISTS "insert_%1$s" ON public.%1$s;', t_name);
        EXECUTE format('
            CREATE POLICY "insert_%1$s" ON public.%1$s FOR INSERT TO authenticated
            WITH CHECK (EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = tenant_id AND tm.user_id = auth.uid() AND tm.role IN (''owner'', ''admin'') AND tm.is_active = true));
        ', t_name);

        EXECUTE format('DROP POLICY IF EXISTS "update_%1$s" ON public.%1$s;', t_name);
        EXECUTE format('
            CREATE POLICY "update_%1$s" ON public.%1$s FOR UPDATE TO authenticated
            USING (EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = %1$s.tenant_id AND tm.user_id = auth.uid() AND tm.role IN (''owner'', ''admin'') AND tm.is_active = true))
            WITH CHECK (EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = %1$s.tenant_id AND tm.user_id = auth.uid() AND tm.role IN (''owner'', ''admin'') AND tm.is_active = true));
        ', t_name);
        
        EXECUTE format('DROP POLICY IF EXISTS "delete_%1$s" ON public.%1$s;', t_name);
    END LOOP;
END
$$;

-- =========================================================================
-- F. FREE TRIAL · 14 DÍAS · SEMILLA, GUARDS Y JWT HOOK
-- =========================================================================

-- F.1 Plan semilla "free_trial" — sin esto, create_tenant_for_owner deja el
-- tenant sin fila en `subscriptions` (el lookup por code retorna NULL).

INSERT INTO public.subscription_plans (code, name, description, is_free, trial_days, is_active)
VALUES ('free_trial', 'Prueba Gratis', '14 días de prueba sin tarjeta', true, 14, true)
ON CONFLICT (code) DO NOTHING;

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
  -- =========================================================
-- FIX RLS RECURSION 42P17 ON public.tenant_memberships
-- =========================================================

-- 1) Funciones helper SECURITY DEFINER
-- Devuelven tenant_ids administrados por el usuario autenticado
-- y evitan que las policies se auto-evalúen sobre tenant_memberships.

CREATE OR REPLACE FUNCTION public.get_auth_user_managed_tenants()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT tm.tenant_id
  FROM public.tenant_memberships tm
  WHERE tm.user_id = auth.uid()
    AND tm.role IN ('owner', 'admin')
    AND tm.is_active = true;
$$;

CREATE OR REPLACE FUNCTION public.get_auth_user_owned_tenants()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT tm.tenant_id
  FROM public.tenant_memberships tm
  WHERE tm.user_id = auth.uid()
    AND tm.role = 'owner'
    AND tm.is_active = true;
$$;

REVOKE ALL ON FUNCTION public.get_auth_user_managed_tenants() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_auth_user_owned_tenants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_auth_user_managed_tenants() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_auth_user_owned_tenants() TO authenticated;

-- 2) Limpiar policies problemáticas de tenant_memberships
DROP POLICY IF EXISTS selecttenantmemberships ON public.tenant_memberships;
DROP POLICY IF EXISTS inserttenantmemberships ON public.tenant_memberships;
DROP POLICY IF EXISTS updatetenantmemberships ON public.tenant_memberships;
DROP POLICY IF EXISTS deletetenantmemberships ON public.tenant_memberships;

DROP POLICY IF EXISTS "select_tenant_memberships" ON public.tenant_memberships;
DROP POLICY IF EXISTS "insert_tenant_memberships" ON public.tenant_memberships;
DROP POLICY IF EXISTS "update_tenant_memberships" ON public.tenant_memberships;
DROP POLICY IF EXISTS "delete_tenant_memberships" ON public.tenant_memberships;

-- 3) Policies nuevas sin recursividad
-- SELECT: ves tu propia membresía o cualquier membresía de tenants que administras
CREATE POLICY selecttenantmemberships
ON public.tenant_memberships
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR tenant_id IN (
    SELECT public.get_auth_user_managed_tenants()
  )
);

-- INSERT: solo owner puede agregar miembros
CREATE POLICY inserttenantmemberships
ON public.tenant_memberships
FOR INSERT
TO authenticated
WITH CHECK (
  tenant_id IN (
    SELECT public.get_auth_user_owned_tenants()
  )
);

-- UPDATE: solo owner puede editar membresías
CREATE POLICY updatetenantmemberships
ON public.tenant_memberships
FOR UPDATE
TO authenticated
USING (
  tenant_id IN (
    SELECT public.get_auth_user_owned_tenants()
  )
)
WITH CHECK (
  tenant_id IN (
    SELECT public.get_auth_user_owned_tenants()
  )
);

-- DELETE: solo owner puede eliminar membresías
CREATE POLICY deletetenantmemberships
ON public.tenant_memberships
FOR DELETE
TO authenticated
USING (
  tenant_id IN (
    SELECT public.get_auth_user_owned_tenants()
  )
);

-- 4) Reemplazar policy de tenants UPDATE para evitar loops indirectos
DROP POLICY IF EXISTS updatetenants ON public.tenants;
DROP POLICY IF EXISTS update_tenants ON public.tenants;

CREATE POLICY updatetenants
ON public.tenants
FOR UPDATE
TO authenticated
USING (
  id IN (
    SELECT public.get_auth_user_managed_tenants()
  )
)
WITH CHECK (
  id IN (
    SELECT public.get_auth_user_managed_tenants()
  )
);

CREATE OR REPLACE FUNCTION public.create_tenant_for_owner(
  p_business_name text,
  p_slug text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_user_id uuid;
  v_plan_id uuid;
BEGIN
  -- 1. Verificar autenticación
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  -- 2. Crear el negocio (Tenant)
  INSERT INTO public.tenants (business_name, slug, onboarding_completed, trial_ends_at)
  VALUES (p_business_name, p_slug, false, now() + interval '14 days')
  RETURNING id INTO v_tenant_id;

  -- 3. Actualizar al usuario con su default_tenant_id
  UPDATE public.users 
  SET default_tenant_id = v_tenant_id 
  WHERE id = v_user_id;

  -- 4. Insertar al creador como Owner
  INSERT INTO public.tenant_memberships (tenant_id, user_id, role, is_active)
  VALUES (v_tenant_id, v_user_id, 'owner', true);

  -- 5. ======= LA NUEVA LÓGICA DE SUSCRIPCIÓN =======
  -- Buscar el ID del plan de prueba
  SELECT id INTO v_plan_id 
  FROM public.subscription_plans 
  WHERE code = 'free_trial' 
  LIMIT 1;

  -- Si no existe el plan, abortar todo para no dejar bases de datos corruptas
  IF v_plan_id IS NULL THEN
    RAISE EXCEPTION 'Falta el plan free_trial en la tabla subscription_plans';
  END IF;

  -- Crear la suscripción asociada al tenant
  INSERT INTO public.subscriptions (tenant_id, plan_id, status)
  VALUES (v_tenant_id, v_plan_id, 'trial');
  -- ==================================================

  RETURN v_tenant_id;
END;
$$;

-- =========================================================================
-- G. COMPRAS · PROVEEDORES · INVENTARIO TRANSACCIONAL
-- =========================================================================

-- G.1 Columnas de pago en purchase_orders
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE public.purchase_orders
  DROP CONSTRAINT IF EXISTS purchase_orders_payment_method_check;
ALTER TABLE public.purchase_orders
  ADD CONSTRAINT purchase_orders_payment_method_check
  CHECK (payment_method IS NULL OR payment_method IN ('cash', 'transfer', 'credit'));

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'pending';
ALTER TABLE public.purchase_orders
  DROP CONSTRAINT IF EXISTS purchase_orders_payment_status_check;
ALTER TABLE public.purchase_orders
  ADD CONSTRAINT purchase_orders_payment_status_check
  CHECK (payment_status IN ('paid', 'pending'));

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS payment_due_date date;

-- G.2 RLS anti-recursivo en business_partners (reemplaza policies del DO $$ loop)
DROP POLICY IF EXISTS "select_business_partners" ON public.business_partners;
DROP POLICY IF EXISTS "insert_business_partners" ON public.business_partners;
DROP POLICY IF EXISTS "update_business_partners" ON public.business_partners;
DROP POLICY IF EXISTS "delete_business_partners" ON public.business_partners;

CREATE POLICY "select_business_partners" ON public.business_partners
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.get_auth_user_managed_tenants()));

CREATE POLICY "insert_business_partners" ON public.business_partners
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT public.get_auth_user_managed_tenants()));

CREATE POLICY "update_business_partners" ON public.business_partners
  FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT public.get_auth_user_managed_tenants()))
  WITH CHECK (tenant_id IN (SELECT public.get_auth_user_managed_tenants()));

-- (sin DELETE: tabla maestra; soft-delete vía is_active)

-- G.3 Índice
CREATE INDEX IF NOT EXISTS idx_partners_tenant_type
  ON public.business_partners(tenant_id, partner_type);

-- G.4 RPC transaccional: recibe una OC con sus ítems, registra movimientos
-- y actualiza balances. Cualquier excepción aborta TODO (rollback automático
-- al ser una sola unidad de trabajo de la función).
--
-- p_items shape: jsonb array → [{ "product_id": uuid, "quantity": numeric, "unit_cost": numeric }, ...]

DROP FUNCTION IF EXISTS public.receive_purchase_order(uuid, uuid, text, text, date, text, jsonb);

CREATE OR REPLACE FUNCTION public.receive_purchase_order(
  p_supplier_id      uuid,
  p_warehouse_id     uuid,
  p_payment_method   text,
  p_payment_status   text,
  p_payment_due_date date,
  p_notes            text,
  p_items            jsonb,
  p_tax_rate         numeric,
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
  v_user_id    uuid := auth.uid();
  v_tenant_id  uuid;
  v_po_id      uuid;
  v_item       jsonb;
  v_qty        numeric(12,4);
  v_unit_cost  numeric(12,4);
  v_line_total numeric(12,2);
  v_product_id uuid;
  v_pay_status text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Debe incluir al menos un ítem';
  END IF;

  IF p_payment_method NOT IN ('cash', 'transfer', 'credit') THEN
    RAISE EXCEPTION 'Método de pago inválido';
  END IF;

  IF p_tax_rate IS NULL OR p_tax_rate < 0 OR p_tax_rate > 100 THEN
    RAISE EXCEPTION 'Tasa de IVA inválida';
  END IF;

  IF p_subtotal IS NULL OR p_subtotal < 0
     OR p_tax_amount IS NULL OR p_tax_amount < 0
     OR p_grand_total IS NULL OR p_grand_total < 0 THEN
    RAISE EXCEPTION 'Totales fiscales inválidos';
  END IF;

  -- Resolver tenant del usuario activo (owner/admin)
  SELECT tenant_id INTO v_tenant_id
    FROM public.tenant_memberships
   WHERE user_id = v_user_id
     AND is_active = true
     AND role IN ('owner', 'admin')
   ORDER BY is_owner DESC
   LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Sin tenant activo o sin permisos';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.business_partners
     WHERE id = p_supplier_id
       AND tenant_id = v_tenant_id
       AND partner_type = 'supplier'
       AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Proveedor inválido';
  END IF;

  IF p_warehouse_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.warehouses
     WHERE id = p_warehouse_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Bodega inválida';
  END IF;

  v_pay_status := CASE
    WHEN p_payment_method IN ('cash', 'transfer') THEN COALESCE(p_payment_status, 'paid')
    ELSE COALESCE(p_payment_status, 'pending')
  END;

  -- 1. Cabecera con totales fiscales exactos (pre-calculados con big.js).
  --    'total' legacy se mantiene = grand_total para compat con consumidores
  --    existentes; 'tax_total' legacy se sincroniza con tax_amount.
  INSERT INTO public.purchase_orders (
    tenant_id, supplier_id, warehouse_id,
    subtotal, tax_total, total,
    tax_rate, tax_amount, grand_total, other_charges,
    status, notes, created_by,
    payment_method, payment_status, payment_due_date
  ) VALUES (
    v_tenant_id, p_supplier_id, p_warehouse_id,
    p_subtotal, p_tax_amount, p_grand_total,
    p_tax_rate, p_tax_amount, p_grand_total, p_other_charges,
    'received', p_notes, v_user_id,
    p_payment_method, v_pay_status,
    CASE WHEN p_payment_method = 'credit' THEN p_payment_due_date ELSE NULL END
  )
  RETURNING id INTO v_po_id;

  -- 2-4. Ítems: detalle + movimiento + balance
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty        := (v_item->>'quantity')::numeric;
    v_unit_cost  := (v_item->>'unit_cost')::numeric;

    IF v_qty IS NULL OR v_qty <= 0 OR v_unit_cost IS NULL OR v_unit_cost < 0 THEN
      RAISE EXCEPTION 'Cantidad y costo deben ser > 0';
    END IF;

    -- line_total redondeado a 2 decimales (consistente con big.js lineTotal).
    v_line_total := round(v_qty * v_unit_cost, 2);

    IF NOT EXISTS (
      SELECT 1 FROM public.products
       WHERE id = v_product_id AND tenant_id = v_tenant_id
    ) THEN
      RAISE EXCEPTION 'Producto inválido (%)', v_product_id;
    END IF;

    INSERT INTO public.purchase_order_items (
      tenant_id, purchase_order_id, product_id,
      quantity, unit_cost, line_total
    ) VALUES (
      v_tenant_id, v_po_id, v_product_id,
      v_qty, v_unit_cost, v_line_total
    );

    INSERT INTO public.inventory_movements (
      tenant_id, warehouse_id, product_id,
      movement_type, quantity, unit_cost, reason,
      reference_type, reference_id, performed_by_user_id
    ) VALUES (
      v_tenant_id, p_warehouse_id, v_product_id,
      'purchase', v_qty, v_unit_cost, 'Recepción de compra',
      'purchase_order', v_po_id, v_user_id
    );

    IF p_warehouse_id IS NOT NULL THEN
      INSERT INTO public.inventory_balances (
        tenant_id, warehouse_id, product_id, quantity_on_hand
      ) VALUES (
        v_tenant_id, p_warehouse_id, v_product_id, v_qty
      )
      ON CONFLICT (tenant_id, warehouse_id, product_id) DO UPDATE
        SET quantity_on_hand = public.inventory_balances.quantity_on_hand + EXCLUDED.quantity_on_hand,
            updated_at = now();
    END IF;
  END LOOP;

  RETURN v_po_id;
END;
$$;

REVOKE ALL ON FUNCTION public.receive_purchase_order(uuid, uuid, text, text, date, text, jsonb, numeric, numeric, numeric, numeric, numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order(uuid, uuid, text, text, date, text, jsonb, numeric, numeric, numeric, numeric, numeric) TO authenticated;

-- =========================================================================
-- H. INVENTARIO · BODEGAS · RLS anti-recursivo + índice de búsqueda
-- =========================================================================
-- Las policies actuales fueron generadas por el DO $$ loop de master_data_tables
-- usando EXISTS sobre tenant_memberships. Las reemplazamos por la versión
-- anti-recursiva con get_auth_user_managed_tenants() para alinear con el
-- patrón del núcleo y prevenir 42P17 si se cruzan políticas más adelante.

DROP POLICY IF EXISTS "select_warehouses" ON public.warehouses;
DROP POLICY IF EXISTS "insert_warehouses" ON public.warehouses;
DROP POLICY IF EXISTS "update_warehouses" ON public.warehouses;
DROP POLICY IF EXISTS "delete_warehouses" ON public.warehouses;

CREATE POLICY "select_warehouses" ON public.warehouses
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.get_auth_user_managed_tenants()));

CREATE POLICY "insert_warehouses" ON public.warehouses
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT public.get_auth_user_managed_tenants()));

CREATE POLICY "update_warehouses" ON public.warehouses
  FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT public.get_auth_user_managed_tenants()))
  WITH CHECK (tenant_id IN (SELECT public.get_auth_user_managed_tenants()));

-- DELETE intencionalmente no permitido — soft-delete vía is_active.

CREATE INDEX IF NOT EXISTS idx_warehouses_tenant_name
  ON public.warehouses(tenant_id, name);

-- =========================================================================
-- I. ANULACIÓN DE COMPRAS · RPC TRANSACCIONAL
-- =========================================================================
-- cancel_purchase_order: Revierte una OC recibida.
--   1. Valida que la OC exista, pertenezca al tenant del usuario y esté 'received'.
--   2. Cambia el estado a 'cancelled'.
--   3. Por cada ítem, inserta un inventory_movement de tipo 'adjustment' (negativo).
--   4. Resta quantity_on_hand en inventory_balances.
--   5. Todo en una sola transacción — si algo falla, nada queda a medias.

CREATE OR REPLACE FUNCTION public.cancel_purchase_order(p_po_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id     uuid := auth.uid();
  v_tenant_id   uuid;
  v_warehouse_id uuid;
  v_status      text;
  v_item        record;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  -- Resolver tenant activo (owner/admin)
  SELECT tenant_id INTO v_tenant_id
    FROM public.tenant_memberships
   WHERE user_id = v_user_id
     AND is_active = true
     AND role IN ('owner', 'admin')
   ORDER BY is_owner DESC
   LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Sin tenant activo o sin permisos';
  END IF;

  -- Validar la OC
  SELECT status, warehouse_id
    INTO v_status, v_warehouse_id
    FROM public.purchase_orders
   WHERE id = p_po_id
     AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden de compra no encontrada';
  END IF;

  IF v_status <> 'received' THEN
    RAISE EXCEPTION 'Solo se pueden anular órdenes en estado "received". Estado actual: %', v_status;
  END IF;

  -- 1. Marcar como cancelada
  UPDATE public.purchase_orders
     SET status = 'cancelled'
   WHERE id = p_po_id
     AND tenant_id = v_tenant_id;

  -- 2. Por cada ítem: movimiento de ajuste + actualizar balance
  FOR v_item IN
    SELECT product_id, quantity, unit_cost
      FROM public.purchase_order_items
     WHERE purchase_order_id = p_po_id
       AND tenant_id = v_tenant_id
  LOOP
    -- Movimiento de ajuste (reversa)
    INSERT INTO public.inventory_movements (
      tenant_id, warehouse_id, product_id,
      movement_type, quantity, unit_cost, reason,
      reference_type, reference_id, performed_by_user_id
    ) VALUES (
      v_tenant_id, v_warehouse_id, v_item.product_id,
      'adjustment', v_item.quantity, v_item.unit_cost,
      'Anulación de compra',
      'purchase_order', p_po_id, v_user_id
    );

    -- Restar del balance (solo si hay bodega asignada)
    IF v_warehouse_id IS NOT NULL THEN
      UPDATE public.inventory_balances
         SET quantity_on_hand = quantity_on_hand - v_item.quantity,
             updated_at = now()
       WHERE tenant_id = v_tenant_id
         AND warehouse_id = v_warehouse_id
         AND product_id = v_item.product_id;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_purchase_order(uuid) TO authenticated;

-- =========================================================================
-- J. CRM CLIENTES · FIDELIZACIÓN AUTOMOTRIZ
-- =========================================================================

-- J.1 Extender business_partners para CRM automotriz
ALTER TABLE public.business_partners
  ADD COLUMN IF NOT EXISTS loyalty_points integer NOT NULL DEFAULT 0;
ALTER TABLE public.business_partners
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '[]'::jsonb;

-- J.2 Índice para búsqueda rápida de clientes por nombre
CREATE INDEX IF NOT EXISTS idx_partners_tenant_customer_name
  ON public.business_partners(tenant_id, full_name)
  WHERE partner_type = 'customer';
  -- 1. Añadir el campo faltante al encabezado de compras
ALTER TABLE public.purchase_orders 
  ADD COLUMN IF NOT EXISTS tax_rate numeric(5,2) DEFAULT 0;

-- 2. Corregir precisión para ver costos como 0.0223 (cambiar de numeric(12,2) a numeric(12,4))
ALTER TABLE public.products 
  ALTER COLUMN cost_price TYPE numeric(12,4);

ALTER TABLE public.purchase_order_items 
  ALTER COLUMN unit_cost TYPE numeric(12,4);

ALTER TABLE public.inventory_movements 
  ALTER COLUMN unit_cost TYPE numeric(12,4);

-- 3. Añadir otros cargos a compras
ALTER TABLE public.purchase_orders 
  ADD COLUMN IF NOT EXISTS other_charges numeric(12,2) DEFAULT 0;