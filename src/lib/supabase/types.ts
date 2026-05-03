// Minimal Database types for Phase 1.
// Replace with `supabase gen types typescript` output once the schema stabilizes.

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
  | "otro";

export interface SubscriptionPlan {
  id: string;
  code: string;
  name: string;
  price_monthly: number;
  features: Json | null;
  is_active: boolean;
}

export interface Tenant {
  id: string;
  owner_user_id: string;
  business_name: string;
  slug: string;
  legal_name: string | null;
  ruc: string | null;
  business_type: BusinessType;
  plan_id: string | null;
  trial_ends_at: string | null;
  status: "trial" | "active" | "suspended" | "cancelled";
  created_at: string;
  updated_at: string;
}

export interface UserRow {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  /**
   * Cédula de identidad. Único por usuario (índice parcial: solo cuando NO NULL).
   * Permite que cobradores/mecánicos se autentiquen tipeando su cédula en el login
   * en lugar del correo (ver flujo en README, sección 4).
   */
  cedula: string | null;
  created_at: string;
  updated_at: string;
}

export interface TenantMembership {
  id: string;
  tenant_id: string;
  user_id: string;
  role: "owner" | "admin" | "staff";
  status: "active" | "invited" | "revoked";
  created_at: string;
}

export interface Database {
  public: {
    Tables: {
      subscription_plans: {
        Row: SubscriptionPlan;
        Insert: Partial<SubscriptionPlan> & { code: string; name: string };
        Update: Partial<SubscriptionPlan>;
      };
      tenants: {
        Row: Tenant;
        Insert: Partial<Tenant> & {
          owner_user_id: string;
          business_name: string;
          slug: string;
          business_type: BusinessType;
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
          role: "owner" | "admin" | "staff";
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
          p_business_type: BusinessType;
          p_legal_name?: string | null;
          p_ruc?: string | null;
        };
        Returns: string; // returns the new tenant_id (uuid)
      };
      /**
       * SECURITY DEFINER: bypassea RLS para resolver email a partir de cédula
       * en el primer paso del login. No retorna password ni hash.
       * Migración SQL en README.md sección 3.
       */
      find_email_by_cedula: {
        Args: { p_cedula: string };
        Returns: string | null;
      };
    };
    Enums: {
      business_type: BusinessType;
    };
  };
}
