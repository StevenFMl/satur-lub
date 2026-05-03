import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * Cliente Supabase con `service_role`. Bypassea RLS por completo.
 *
 * USO PERMITIDO:
 *  - Crear cuentas de empleados desde el dashboard del admin (ver flujo del cobrador en README §4.1).
 *  - Operaciones administrativas internas que no pueden hacerse vía RPC SECURITY DEFINER.
 *
 * USO PROHIBIDO:
 *  - Importar este módulo desde un Client Component (`"use client"`).
 *  - Importar desde un Server Component que renderiza HTML al usuario sin filtrar el resultado.
 *  - Resolver email-por-cédula durante el login (eso vive en la RPC `find_email_by_cedula`).
 *
 * `import "server-only"` arriba garantiza que el bundler de Next falle el build si alguien
 * intenta importar este archivo desde código que termine en el cliente.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Supabase admin client requiere NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  return createSupabaseClient<Database>(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
