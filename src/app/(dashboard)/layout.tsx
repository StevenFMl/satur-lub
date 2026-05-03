import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Guard común al grupo (dashboard).
 *
 * Responsabilidades:
 *  - Verificar sesión (sin sesión → /login, redundante con el middleware
 *    pero aporta defensa en profundidad por si alguien deshabilita el matcher).
 *
 * Fuera del scope de este layout (lo manejan las páginas anidadas):
 *  - Forzar `/onboarding` cuando NO hay membership activa.
 *    → vive en `app/(dashboard)/dashboard/layout.tsx`
 *  - Saltarse `/onboarding` cuando YA hay membership activa.
 *    → vive en `app/(dashboard)/onboarding/page.tsx`
 *
 *  Esa separación evita ciclos de redirect entre layouts hermanos.
 */
export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <>{children}</>;
}
