import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Clasificación de rutas (los route groups `(public)`, `(auth)`, `(dashboard)`
 * NO aparecen en el URL público — el middleware ve la ruta plana).
 */
const AUTH_PATHS = ["/login", "/register", "/forgot-password"] as const;
const PROTECTED_PREFIXES = ["/dashboard", "/onboarding"] as const;

/**
 * `updateSession` corre en cada request bajo el matcher de `middleware.ts`.
 *
 * Responsabilidades:
 *  1. Refrescar el access token si venció (vital para `@supabase/ssr` en RSC).
 *  2. Reescribir las cookies de sesión en la response antes de que el RSC las consuma.
 *  3. Aplicar guards mínimos:
 *     - Si la ruta es protegida y NO hay user → redirect a /login con `redirectTo`.
 *     - Si la ruta es de auth y SÍ hay user → redirect a /dashboard.
 *
 * La validación de **rol** y **tenant membership** vive en `app/(dashboard)/layout.tsx`,
 * no aquí — el middleware no debe consultar tablas de dominio (latencia + complejidad).
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

  const isProtected = PROTECTED_PREFIXES.some((prefix) =>
    pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  const isAuthPage = AUTH_PATHS.includes(
    pathname as (typeof AUTH_PATHS)[number]
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

  return response;
}

export { AUTH_PATHS, PROTECTED_PREFIXES };
