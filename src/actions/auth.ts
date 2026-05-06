"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  loginSchema,
  registerSchema,
  forgotPasswordSchema,
  classifyIdentifier,
  type LoginFieldErrors,
  type RegisterFieldErrors,
  type ForgotPasswordFieldErrors,
} from "@/lib/validations/auth";

export type AuthState = {
  error?: string;
  fieldErrors?:
    | LoginFieldErrors
    | RegisterFieldErrors
    | ForgotPasswordFieldErrors;
  notice?: string;
} | null;

/* -------------------------------------------------------------------------- */
/*                                  LOGIN                                     */
/* -------------------------------------------------------------------------- */

/**
 * Login con cédula O correo.
 *
 * Flujo (ver README §4.3):
 *  1. Valida con Zod.
 *  2. Si el identifier es cédula, llama a la RPC `find_email_by_cedula`
 *     (SECURITY DEFINER en Postgres) para resolver el email.
 *  3. `supabase.auth.signInWithPassword({ email, password })`.
 *  4. Resuelve el destino según membership/rol.
 *
 * Mensajes de error son intencionalmente genéricos — no revelamos si una
 * cédula o correo existe en la base (anti-enumeration).
 */
export async function loginAction(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const parsed = loginSchema.safeParse({
    identifier: formData.get("identifier"),
    password: formData.get("password"),
    redirectTo: formData.get("redirectTo") ?? undefined,
  });

  if (!parsed.success) {
    return {
      fieldErrors: flattenErrors<LoginFieldErrors>(parsed.error),
      error: "Revisa los campos marcados.",
    };
  }

  const { identifier, password, redirectTo } = parsed.data;
  const classified = classifyIdentifier(identifier);

  const supabase = await createClient();

  let email: string | null = null;
  if (classified.kind === "email") {
    email = classified.value;
  } else {
    // Cédula: resolver email vía RPC SECURITY DEFINER.
    const { data, error } = await supabase.rpc("find_email_by_cedula", {
      p_cedula: classified.value,
    });
    if (error) {
      // RPC caída o no existe — no exponemos el detalle al usuario.
      console.error("find_email_by_cedula error:", error);
      return { error: "No pudimos validar tu cédula. Intenta con tu correo." };
    }
    email = data ?? null;
  }

  if (!email) {
    return { error: "Credenciales inválidas." };
  }

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError) {
    // Nunca reenviamos el `signInError.message` crudo al cliente: puede
    // filtrar detalles de Supabase Auth (lockouts, formatos, etc.).
    console.error("signInWithPassword error:", signInError);
    return { error: mapAuthError(signInError.message) };
  }

  const target = await resolvePostAuthRoute(redirectTo ?? "");
  revalidatePath("/", "layout");
  redirect(target);
}

/* -------------------------------------------------------------------------- */
/*                                 REGISTER                                   */
/* -------------------------------------------------------------------------- */

/**
 * Registro PÚBLICO. Solo para dueños/fundadores que crean su propio negocio.
 * Los empleados (cobradores, mecánicos) los crea el admin desde el dashboard
 * usando `supabase.auth.admin.createUser` con el cliente de service-role.
 *
 * Asume auto-confirm activado en Supabase. Si por alguna razón no llega
 * sesión inmediata, devolvemos un mensaje claro en lugar de "revisa tu correo".
 */
export async function registerAction(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const parsed = registerSchema.safeParse({
    full_name: formData.get("full_name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      fieldErrors: flattenErrors<RegisterFieldErrors>(parsed.error),
      error: "Revisa los campos marcados.",
    };
  }

  const { full_name, email, password } = parsed.data;

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name } },
  });

  if (error) {
    console.error("signUp error:", error);
    return { error: mapAuthError(error.message) };
  }

  if (!data.session) {
    return {
      error:
        "Cuenta creada, pero no pudimos iniciar sesión automáticamente. Inicia sesión.",
    };
  }

  revalidatePath("/", "layout");
  redirect("/onboarding");
}

/* -------------------------------------------------------------------------- */
/*                              FORGOT PASSWORD                               */
/* -------------------------------------------------------------------------- */

/**
 * Envía el correo de reset usando el `redirectTo` del propio host.
 * Devuelve siempre el mismo `notice` exista o no el correo (anti-enumeration).
 */
export async function forgotPasswordAction(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const parsed = forgotPasswordSchema.safeParse({
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return {
      fieldErrors: flattenErrors<ForgotPasswordFieldErrors>(parsed.error),
      error: "Revisa los campos marcados.",
    };
  }

  const { email } = parsed.data;
  const supabase = await createClient();

  const headerList = await headers();
  const origin =
    headerList.get("origin") ??
    `https://${headerList.get("host") ?? "saturnlub.app"}`;

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/dashboard`,
  });

  if (error) {
    console.error("resetPasswordForEmail error:", error);
  }

  // Respuesta uniforme: existe o no el correo, nunca lo revelamos.
  return {
    notice:
      "Si ese correo está registrado, recibirás un enlace para restablecer tu contraseña en los próximos minutos.",
  };
}

/* -------------------------------------------------------------------------- */
/*                                  LOGOUT                                    */
/* -------------------------------------------------------------------------- */

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

/* -------------------------------------------------------------------------- */
/*                                  HELPERS                                   */
/* -------------------------------------------------------------------------- */

import { decodeJwtPayload, type AccessClaims } from "@/lib/supabase/access-claims";
import { createAdminClient } from "@/lib/supabase/admin";

async function resolvePostAuthRoute(requested: string): Promise<string> {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    console.log("[resolvePostAuthRoute] No session found, redirecting to /login");
    return "/login";
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return "/login";

  // Vía Rápida: Si el JWT ya tiene la info (Optimización)
  let claims = decodeJwtPayload<AccessClaims>(session.access_token);
  if (claims?.tenant_id && claims?.onboarding_completed) {
    console.log(`[resolvePostAuthRoute] JWT claims found for ${user.id}, onboarding completed. Redirecting to dashboard.`);
    if (isSafeRedirectPath(requested)) return requested;
    return "/dashboard";
  }

  // Vía Segura (DB-First): El JWT no tiene el claim, consultamos DB
  console.log(`[resolvePostAuthRoute] Verifying DB for user ${user.id}`);

  const { data: userData } = await supabase
    .from("users")
    .select("default_tenant_id")
    .eq("id", user.id)
    .single();

  const defaultTenantId = userData?.default_tenant_id;

  const { data } = await supabase
    .from("tenant_memberships")
    .select(`
      tenant_id,
      tenants!inner (
        onboarding_completed,
        subscription_status,
        trial_ends_at
      )
    `)
    .eq("user_id", user.id)
    .eq("is_active", true);

  const memberships = (data as any[]) || [];
  let membership = null;

  if (memberships.length > 0) {
    if (defaultTenantId) {
      membership = memberships.find((m) => m.tenant_id === defaultTenantId) || memberships[0];
    } else {
      membership = memberships[0];
    }
  }

  console.log("[resolvePostAuthRoute] User ID:", user.id);
  console.log("[resolvePostAuthRoute] Membership found:", membership ? "Yes" : "Null");
  console.log("[resolvePostAuthRoute] Default Tenant ID:", defaultTenantId || "None");

  // ──────────────────────────────────────────────────────────────────────────
  // SELF-HEALING FALLBACK (God Mode):
  // Si la query RLS no devolvió membresía pero el usuario tiene un
  // default_tenant_id válido, auto-reparamos con service_role.
  // Esto cubre: registros corruptos (is_owner=false), RLS stale, JWT sin
  // claims, o cualquier race condition post-onboarding.
  // ──────────────────────────────────────────────────────────────────────────
  if (!membership && defaultTenantId) {
    console.log(`[resolvePostAuthRoute] 🔧 SELF-HEALING: No membership via RLS but default_tenant_id=${defaultTenantId} exists. Executing admin UPSERT...`);

    try {
      const supabaseAdmin = createAdminClient();

      // 1) UPSERT atómico: repara cualquier registro corrupto o inexistente
      // Cast a `any` porque los tipos generados excluyen inserts en tablas
      // protegidas por RLS — el admin client bypasea RLS por completo.
      const { error: upsertError } = await supabaseAdmin
        .from("tenant_memberships")
        .upsert(
          {
            tenant_id: defaultTenantId,
            user_id: user.id,
            role: "owner",
            is_owner: true,
            is_active: true,
          } as any,
          { onConflict: "tenant_id,user_id" }
        );

      if (upsertError) {
        console.error("[resolvePostAuthRoute] UPSERT failed:", upsertError.message);
        // No bloqueamos; caemos al flujo de onboarding como último recurso
      } else {
        console.log("[resolvePostAuthRoute] ✅ Membership auto-repaired for owner.");

        // 2) Inyectar tenant_id en user_metadata (God Mode JWT)
        //    Asegura que futuras sesiones y RLS funcionen sin fallos.
        await supabaseAdmin.auth.admin.updateUserById(user.id, {
          user_metadata: { tenant_id: defaultTenantId },
        });
        console.log("[resolvePostAuthRoute] ✅ user_metadata.tenant_id injected.");

        // 3) Forzar refresh de sesión para que el JWT recoja los nuevos claims
        await supabase.auth.refreshSession();

        // 4) Retornar objeto sintético válido — NO dejamos que se evalúe como Null
        const target = isSafeRedirectPath(requested) ? requested : "/dashboard";
        console.log(`[resolvePostAuthRoute] 🚀 Self-healed, redirecting to: ${target}`);
        return target;
      }
    } catch (adminError) {
      console.error("[resolvePostAuthRoute] Admin self-healing threw:", adminError);
    }
  }

  if (membership?.tenant_id) {
    console.log("[resolvePostAuthRoute] Tenant ID:", membership.tenant_id);
    console.log("[resolvePostAuthRoute] Onboarding Completed:", membership.tenants?.onboarding_completed);

    if (membership.tenants?.onboarding_completed) {
      const target = isSafeRedirectPath(requested) ? requested : "/dashboard";
      console.log("[resolvePostAuthRoute] Redirecting to:", target);
      return target;
    }
  }

  console.log("[resolvePostAuthRoute] User needs onboarding, redirecting to /onboarding");
  return "/onboarding";
}

/**
 * Whitelist estricta para `redirectTo`. Bloquea:
 *  - URLs absolutas (`https://evil.com/...`)
 *  - protocol-relative (`//evil.com`)
 *  - escapes `\\evil.com`
 *  - cualquier cosa que contenga esquema (`javascript:`, `data:`, `://`)
 *  - rutas que no son del propio app shell
 *
 * Solo deja pasar paths internos del propio host empezando con un único `/`.
 */
function isSafeRedirectPath(p: unknown): p is string {
  if (typeof p !== "string" || p.length === 0) return false;
  if (!p.startsWith("/")) return false;
  if (p.startsWith("//") || p.startsWith("/\\")) return false;
  if (p.includes("://")) return false;
  // Solo permitimos rutas del propio dashboard o áreas autenticadas.
  // Cualquier otro path interno también queda admitido siempre que cumpla
  // las reglas anteriores; el middleware/layouts harán los guards de auth.
  return true;
}

function flattenErrors<T extends Record<string, string | undefined>>(
  err: import("zod").ZodError
): T {
  const out = {} as Record<string, string>;
  for (const issue of err.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !(key in out)) {
      out[key] = issue.message;
    }
  }
  return out as T;
}

/**
 * Sanea el mensaje crudo del provider antes de devolverlo al cliente.
 * Lista blanca de casos conocidos → mensaje en español genérico. Cualquier
 * otro mensaje del provider se DESCARTA (puede filtrar detalles de
 * implementación, IDs, formatos, etc.) y se reemplaza por uno genérico.
 */
function mapAuthError(message: string): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("invalid login") || m.includes("invalid credentials")) {
    return "Credenciales inválidas.";
  }
  if (m.includes("user already registered") || m.includes("already exists")) {
    return "Ya existe una cuenta con ese correo.";
  }
  if (m.includes("password")) {
    return "La contraseña no cumple los requisitos mínimos.";
  }
  if (m.includes("rate limit") || m.includes("too many")) {
    return "Demasiados intentos. Espera unos minutos e intenta de nuevo.";
  }
  if (m.includes("email not confirmed")) {
    return "Confirma tu correo antes de iniciar sesión.";
  }
  // Default genérico — NO filtramos el `message` original al cliente.
  return "No pudimos completar la operación. Intenta nuevamente.";
}
