import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  decodeJwtPayload,
  evaluateTrial,
  isTrialBlocked,
  type AccessClaims,
} from "./access-claims";

/**
 * Clasificación de rutas (los route groups `(public)`, `(auth)`, `(dashboard)`
 * NO aparecen en el URL público — el middleware ve la ruta plana).
 */
const AUTH_PATHS = ["/login", "/register", "/forgot-password"] as const;
const PROTECTED_PREFIXES = ["/dashboard", "/onboarding", "/upgrade"] as const;
const TRIAL_LOCKED_PREFIXES = ["/dashboard"] as const;

/**
 * `updateSession` corre en cada request bajo el matcher de `middleware.ts`.
 *
 * Responsabilidades:
 *  1. Refrescar el access token si venció.
 *  2. Reescribir las cookies de sesión en la response antes de que el RSC las consuma.
 *  3. Aplicar guards SIN tocar la base de datos:
 *     - Sin sesión + ruta protegida → /login.
 *     - Con sesión + ruta de auth → /dashboard.
 *     - Con sesión + /onboarding pero ya tiene tenant → /dashboard.
 *     - Con sesión + /dashboard pero sin tenant → /onboarding.
 *     - Con sesión + /dashboard pero trial expirado/delinquent → /upgrade.
 *
 *  Las decisiones de tenant/trial se basan en CLAIMS DEL JWT inyectados por
 *  el hook `public.custom_access_token_hook`. Si el hook todavía no está
 *  activado en el dashboard de Supabase (claims ausentes), el middleware
 *  solo aplica los guards de sesión y delega tenant/trial al server component
 *  (`(dashboard)/dashboard/layout.tsx`), que sí consulta la DB.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: {
            name: string;
            value: string;
            options?: CookieOptions;
          }[]
        ) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Forzar el refresh del access token si está por vencer.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  const isAuthPage = AUTH_PATHS.includes(
    pathname as (typeof AUTH_PATHS)[number]
  );
  const isTrialLocked = TRIAL_LOCKED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(url);
  }

  if (isAuthPage && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // Decisiones de tenant/trial — solo si tenemos claims del JWT.
  if (user) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const claims = session?.access_token
      ? decodeJwtPayload<AccessClaims>(session.access_token)
      : null;

    // Política conservadora: el middleware SOLO redirige cuando los claims
    // afirman positivamente algo (tenant_id presente). La AUSENCIA de claims
    // puede deberse a:
    //   (a) hook todavía no activado en Supabase,
    //   (b) JWT viejo emitido antes de completar el onboarding,
    //   (c) refresh en vuelo durante la transición.
    // En cualquier ausencia delegamos al server component (que consulta DB)
    // — así jamás causamos un loop por claims temporalmente faltantes.
    if (claims?.tenant_id) {
      // /onboarding con tenant ya creado y onboarding finalizado → /dashboard
      if (pathname === "/onboarding" && claims.onboarding_completed) {
        const url = request.nextUrl.clone();
        url.pathname = "/dashboard";
        return NextResponse.redirect(url);
      }

      // Trial expirado o delinquent → /upgrade (solo en rutas locked)
      if (isTrialLocked) {
        const trial = evaluateTrial({
          tenant_id: claims.tenant_id,
          trial_ends_at: claims.trial_ends_at,
          subscription_status: claims.subscription_status,
        });
        if (isTrialBlocked(trial)) {
          const url = request.nextUrl.clone();
          url.pathname = "/upgrade";
          return NextResponse.redirect(url);
        }
      }
    }
    // Sin tenant_id en claims: NO redirigimos a /onboarding desde aquí.
    // El layout del dashboard ya hace ese guard contra DB y evita el loop
    // post-onboarding (cuando el JWT aún no propagó el claim nuevo).
  }

  return response;
}

export { AUTH_PATHS, PROTECTED_PREFIXES };
