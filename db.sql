create extension if not exists "pgcrypto";

-- 1) Helpers
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 2) Catálogo de planes
create table public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                 -- free_trial, starter, pro
  name text not null,
  description text,
  is_free boolean not null default false,
  trial_days integer,
  limits jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- seed base plan
insert into public.subscription_plans (code, name, description, is_free, trial_days, limits)
values (
  'free_trial',
  'Prueba gratis',
  'Plan inicial de prueba para nuevos negocios',
  true,
  14,
  jsonb_build_object(
    'max_users', 1,
    'max_branches', 1,
    'max_products', 100,
    'max_monthly_sales', 100,
    'electronic_docs_enabled', false
  )
)
on conflict (code) do nothing;

-- 3) Tenants
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  legal_name text,
  business_name text not null,
  slug text not null unique,
  ruc varchar(13),
  contributor_type text,
  taxpayer_regime text,
  business_type text, -- lubricadora, mecanica, repuestos, distribuidor
  onboarding_completed boolean not null default false,
  subscription_plan_code text not null references public.subscription_plans(code) on delete restrict default 'free_trial',
  subscription_status text not null default 'trial', -- trial, active, past_due, canceled
  trial_starts_at timestamptz not null default now(),
  trial_ends_at timestamptz,
  branding jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_tenants_updated_at
before update on public.tenants
for each row execute procedure public.set_updated_at();

-- 4) Perfil público enlazado a auth.users
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  phone text,
  avatar_url text,
  default_tenant_id uuid references public.tenants(id) on delete restrict,
  global_role text not null default 'user', -- user, support, superadmin
  is_active boolean not null default true,
  email_confirmed boolean not null default false,
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_users_updated_at
before update on public.users
for each row execute procedure public.set_updated_at();

-- 5) Membresías por tenant
create table public.tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null default 'owner', -- owner, admin, cashier, technician
  is_owner boolean not null default false,
  is_active boolean not null default true,
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create trigger trg_tenant_memberships_updated_at
before update on public.tenant_memberships
for each row execute procedure public.set_updated_at();

-- 6) Sesiones de negocio / auditoría liviana
create table public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete restrict,
  ip_address inet,
  user_agent text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- 7) Invitaciones (para cuando agregues más usuarios)
create table public.user_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  email text not null,
  role text not null default 'admin',
  invited_by_user_id uuid not null references public.users(id) on delete restrict,
  token text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

-- 8) Función de perfil automático al registrarse
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (
    id,
    email,
    full_name,
    phone,
    avatar_url,
    email_confirmed,
    last_sign_in_at
  )
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.raw_user_meta_data ->> 'phone',
    new.raw_user_meta_data ->> 'avatar_url',
    coalesce(new.email_confirmed_at is not null, false),
    new.last_sign_in_at
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- 9) Función para crear tenant al registrarse el owner
create or replace function public.create_tenant_for_owner(
  p_business_name text,
  p_slug text,
  p_legal_name text default null,
  p_ruc varchar(13) default null,
  p_business_type text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_tenant_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.tenants (
    business_name,
    slug,
    legal_name,
    ruc,
    business_type,
    created_by_user_id,
    trial_ends_at
  )
  values (
    p_business_name,
    p_slug,
    p_legal_name,
    p_ruc,
    p_business_type,
    v_user_id,
    now() + interval '14 days'
  )
  returning id into v_tenant_id;

  update public.users
  set default_tenant_id = v_tenant_id
  where id = v_user_id;

  insert into public.tenant_memberships (
    tenant_id,
    user_id,
    role,
    is_owner
  )
  values (
    v_tenant_id,
    v_user_id,
    'owner',
    true
  );

  return v_tenant_id;
end;
$$;

-- 10) RLS
alter table public.subscription_plans enable row level security;
alter table public.tenants enable row level security;
alter table public.users enable row level security;
alter table public.tenant_memberships enable row level security;
alter table public.user_sessions enable row level security;
alter table public.user_invites enable row level security;

-- Todos pueden leer planes activos
create policy "read_active_subscription_plans"
on public.subscription_plans
for select
to authenticated
using (is_active = true);

-- El usuario ve su propio perfil
create policy "users_select_own_profile"
on public.users
for select
to authenticated
using (id = auth.uid());

create policy "users_update_own_profile"
on public.users
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- El usuario ve sus memberships
create policy "tenant_memberships_select_own"
on public.tenant_memberships
for select
to authenticated
using (user_id = auth.uid());

-- El usuario ve tenants donde es miembro
create policy "tenants_select_if_member"
on public.tenants
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_memberships tm
    where tm.tenant_id = tenants.id
      and tm.user_id = auth.uid()
      and tm.is_active = true
  )
);

-- El usuario puede insertar su sesión
create policy "user_sessions_insert_own"
on public.user_sessions
for insert
to authenticated
with check (user_id = auth.uid());

create policy "user_sessions_select_own"
on public.user_sessions
for select
to authenticated
using (user_id = auth.uid());

-- Invitaciones visibles solo para miembros del tenant
create policy "user_invites_select_if_member"
on public.user_invites
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_memberships tm
    where tm.tenant_id = user_invites.tenant_id
      and tm.user_id = auth.uid()
      and tm.is_active = true
  )
);