import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "./server";
import { evaluateTrial, type TrialState, decodeJwtPayload, type AccessClaims } from "./access-claims";
import type { SubscriptionStatus, TenantRole } from "./types";

export type ActiveMembership = {
  tenant_id: string;
  role: TenantRole;
  tenants: {
    id: string;
    business_name: string;
    slug: string;
    onboarding_completed: boolean;
    subscription_status: SubscriptionStatus;
    subscription_plan_code: string | null;
    trial_ends_at: string | null;
  } | null;
  subscription: {
    status: string;
    current_period_start: string;
    current_period_end: string | null;
  } | null;
};

export type MembershipContext = {
  user: User | null;
  membership: ActiveMembership | null;
  trial: TrialState;
};

const PLAN_DISPLAY_NAMES: Record<string, string> = {
  free_trial: "Prueba",
  starter: "Starter",
  pro: "Pro",
  enterprise: "Enterprise",
};

/**
 * Mapea un `subscription_plan_code` (denormalizado en `tenants`) a su nombre
 * mostrable. Para códigos no listados, retorna el code en mayúsculas como
 * fallback razonable.
 */
export function getPlanDisplayName(code: string | null | undefined): string {
  if (!code) return "Prueba";
  return PLAN_DISPLAY_NAMES[code] ?? code.toUpperCase();
}

/**
 * Resuelve el usuario autenticado y su tenant activo en una sola pasada,
 * cacheada por request (React `cache()`): el árbol RSC del dashboard la lee
 * desde varios layouts/pages sin pegarle a la DB más de una vez.
 *
 * El filtro real es `is_active = true` en `tenant_memberships` (el schema
 * NO tiene una columna `status`). Mantener este helper como fuente única
 * evita repetir el mismo SELECT — y previene volver a equivocarse de columna.
 *
 * El plan/estado de suscripción se lee de las columnas denormalizadas en
 * `tenants` (`subscription_status`, `subscription_plan_code`); para el detalle
 * histórico ver tabla `subscriptions`.
 */
export const getActiveMembership = cache(async (): Promise<MembershipContext> => {
  const supabase = await createClient();
  let { data: { session } } = await supabase.auth.getSession();
  if (!session) return { user: null, membership: null, trial: { kind: "no-tenant" } };

  // RLS on tenant_memberships requires the tenant_id claim in the JWT.
  // If it's missing, we MUST force a refresh so the Postgres hook can inject it.
  // Otherwise, the DB query below will return 0 rows and falsely trigger onboarding.
  let claims = decodeJwtPayload<AccessClaims>(session.access_token);
  if (!claims?.tenant_id) {
    const { data: refreshData } = await supabase.auth.refreshSession();
    if (refreshData.session) {
      session = refreshData.session;
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, membership: null, trial: { kind: "no-tenant" } };

  const { data } = await supabase
    .from("tenant_memberships")
    .select(
      `
      tenant_id,
      role,
      tenants (
        id,
        business_name,
        slug,
        onboarding_completed,
        subscription_status,
        subscription_plan_code,
        trial_ends_at
      )
    `
    )
    .eq("user_id", user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  const baseMembership = (data as unknown as Omit<ActiveMembership, "subscription"> | null) ?? null;

  let subscription: ActiveMembership["subscription"] = null;
  if (baseMembership) {
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("status, current_period_start, current_period_end")
      .eq("tenant_id", baseMembership.tenant_id)
      .maybeSingle();
    subscription = (sub as ActiveMembership["subscription"]) ?? null;
  }

  const membership: ActiveMembership | null = baseMembership
    ? { ...baseMembership, subscription }
    : null;

  const trial = evaluateTrial(
    membership && membership.tenants
      ? {
          tenant_id: membership.tenant_id,
          subscription_status: membership.tenants.subscription_status,
          trial_ends_at: membership.tenants.trial_ends_at,
        }
      : null
  );

  return { user, membership, trial };
});
