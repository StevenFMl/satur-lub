// Database types — alineados manualmente con `db.sql`.
// TODO: reemplazar con `supabase gen types typescript` una vez que el schema
// se estabilice y el CLI esté configurado en CI.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type BusinessType =
  | "lubricentro"
  | "taller"
  | "autoservicio"
  | "ferreteria"
  | "otro";

export type SubscriptionStatus =
  | "trial"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid";

export type TenantRole = "owner" | "admin" | "user";

export interface SubscriptionPlan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_free: boolean;
  trial_days: number | null;
  limits: Json;
  is_active: boolean;
  created_at: string;
}

export interface Subscription {
  id: string;
  tenant_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  current_period_start: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
}

export interface Tenant {
  id: string;
  legal_name: string | null;
  business_name: string;
  slug: string;
  ruc: string | null;
  contributor_type: string | null;
  taxpayer_regime: string | null;
  business_type: BusinessType | null;
  onboarding_completed: boolean;
  subscription_plan_code: string | null;
  subscription_status: SubscriptionStatus;
  trial_starts_at: string;
  trial_ends_at: string | null;
  branding: Json;
  settings: Json;
  is_active: boolean;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserRow {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  default_tenant_id: string | null;
  global_role: string;
  is_active: boolean;
  email_confirmed: boolean;
  last_sign_in_at: string | null;
  /**
   * Cédula de identidad. Hoy NO existe como columna en `db.sql` — se resuelve
   * vía la RPC `find_email_by_cedula` (ver memoria del proyecto). Cuando se
   * añada la migración con la columna, este campo ya estará alineado.
   */
  cedula?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TenantMembership {
  id: string;
  tenant_id: string;
  user_id: string;
  role: TenantRole;
  is_owner: boolean;
  is_active: boolean;
  joined_at: string;
  created_at: string;
  updated_at: string;
}

export interface Database {
  public: {
    Tables: {
      subscription_plans: {
        Row: SubscriptionPlan;
        Insert: Partial<SubscriptionPlan> & { code: string; name: string };
        Update: Partial<SubscriptionPlan>;
      };
      subscriptions: {
        Row: Subscription;
        Insert: Partial<Subscription> & {
          tenant_id: string;
          plan_id: string;
          status: SubscriptionStatus;
        };
        Update: Partial<Subscription>;
      };
      tenants: {
        Row: Tenant;
        Insert: Partial<Tenant> & {
          business_name: string;
          slug: string;
        };
        Update: Partial<Tenant>;
      };
      users: {
        Row: UserRow;
        Insert: Partial<UserRow> & { id: string; email: string };
        Update: Partial<UserRow>;
      };
      tenant_memberships: {
        Row: TenantMembership;
        Insert: Partial<TenantMembership> & {
          tenant_id: string;
          user_id: string;
          role: TenantRole;
        };
        Update: Partial<TenantMembership>;
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_tenant_for_owner: {
        Args: {
          p_business_name: string;
          p_slug: string;
          p_legal_name?: string | null;
          p_ruc?: string | null;
          p_business_type?: string | null;
        };
        Returns: string; // returns the new tenant_id (uuid)
      };
      /**
       * SECURITY DEFINER: bypassea RLS para resolver email a partir de cédula
       * en el primer paso del login. No retorna password ni hash.
       */
      find_email_by_cedula: {
        Args: { p_cedula: string };
        Returns: string | null;
      };
    };
    Enums: {
      business_type: BusinessType;
      subscription_status: SubscriptionStatus;
      tenant_role: TenantRole;
    };
  };
}
