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

          // Sync request cookies to request headers so Server Components can read the refreshed session
          const cookieStr = request.cookies.getAll().map((c) => `${c.name}=${c.value}`).join("; ");
          request.headers.set("cookie", cookieStr);

          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Forzar el refresh del access token si está por vencer.
  let user = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch (error) {
    // Si getUser falla por red (fetch failed), intentamos recuperar desde sesión
    console.warn("Middleware auth.getUser() error, cayendo a getSession()", error);
    const { data } = await supabase.auth.getSession();
    user = data.session?.user ?? null;
  }

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

  // Helper to clone cookies from response to redirects to avoid losing refreshed session tokens
  const makeRedirect = (toUrl: string | URL) => {
    const redirectResponse = NextResponse.redirect(toUrl);
    response.cookies.getAll().forEach((c) => {
      redirectResponse.cookies.set(c.name, c.value, {
        path: c.path,
        domain: c.domain,
        maxAge: c.maxAge,
        expires: c.expires,
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: c.sameSite,
      });
    });
    // Prevent the browser or any intermediary from caching this redirect
    redirectResponse.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    redirectResponse.headers.set("Pragma", "no-cache");
    redirectResponse.headers.set("Expires", "0");
    return redirectResponse;
  };

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectTo", pathname);
    return makeRedirect(url);
  }

  if (isAuthPage && user && request.method === "GET") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return makeRedirect(url);
  }

  // NOTE: Tenant onboarding and trial blocking redirects are completely delegated
  // to the server components (layouts/pages) which read fresh state from the database.
  // This avoids infinite loops caused by out-of-sync JWT custom claims.

  return response;
}

export { AUTH_PATHS, PROTECTED_PREFIXES };
