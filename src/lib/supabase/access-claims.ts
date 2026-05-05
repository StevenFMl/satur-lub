import type { SubscriptionStatus, TenantRole } from "./types";

/**
 * Claims custom que el hook `public.custom_access_token_hook` inyecta al JWT.
 *
 * El hook se invoca en cada emisión/refresh del access token. Si todavía no
 * está activado en el dashboard de Supabase (Auth → Hooks), las propiedades
 * estarán todas `undefined` y el caller debe degradar al fallback de DB.
 */
export type AccessClaims = {
  sub: string;
  email?: string;
  exp: number;
  iat: number;
  tenant_id?: string;
  tenant_role?: TenantRole;
  trial_ends_at?: string;
  subscription_status?: SubscriptionStatus;
  onboarding_completed?: boolean;
};

/**
 * Decodifica un JWT sin verificar firma — válido SOLO para leer claims tras
 * que `supabase.auth.getUser()` ya validó el token contra Auth API.
 * Cross-runtime: funciona en Node (middleware, server) y en el browser
 * (post-onboarding refresh) usando `atob` + `TextDecoder` (ambos en Node 16+).
 */
export function decodeJwtPayload<T = AccessClaims>(token: string): T | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const payload = parts[1];
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "="
    );
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/*                              EVALUACIÓN DE TRIAL                           */
/* -------------------------------------------------------------------------- */

export type TrialState =
  | { kind: "no-tenant" }
  | { kind: "active" }
  | { kind: "trialing"; daysLeft: number; endsAt: Date }
  | { kind: "expired"; endsAt: Date }
  | { kind: "delinquent"; reason: SubscriptionStatus };

type TrialInput = {
  tenant_id?: string | null;
  trial_ends_at?: string | null;
  subscription_status?: SubscriptionStatus | string | null;
};

/**
 * Decide el estado de acceso del tenant a partir de los datos disponibles.
 * Acepta tanto los claims del JWT como un membership context, lo que permite
 * usarla desde middleware (sin DB) y desde server components (con DB).
 */
export function evaluateTrial(input: TrialInput | null | undefined): TrialState {
  if (!input || !input.tenant_id) return { kind: "no-tenant" };

  const status = input.subscription_status;
  if (status === "active") return { kind: "active" };
  if (status === "past_due" || status === "canceled" || status === "unpaid") {
    return { kind: "delinquent", reason: status };
  }

  // status === 'trial' (o ausente — tratamos como trial por defecto seguro)
  if (!input.trial_ends_at) return { kind: "expired", endsAt: new Date(0) };

  const endsAt = new Date(input.trial_ends_at);
  const ms = endsAt.getTime() - Date.now();
  if (Number.isNaN(endsAt.getTime())) return { kind: "expired", endsAt: new Date(0) };
  if (ms <= 0) return { kind: "expired", endsAt };

  return { kind: "trialing", daysLeft: Math.ceil(ms / 86_400_000), endsAt };
}

/**
 * `true` si el estado bloquea el acceso al dashboard. Centraliza la regla
 * para que middleware y layout coincidan exactamente.
 */
export function isTrialBlocked(state: TrialState): boolean {
  return state.kind === "expired" || state.kind === "delinquent";
}
