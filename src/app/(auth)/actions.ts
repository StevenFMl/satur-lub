"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  loginSchema,
  registerSchema,
  type LoginFieldErrors,
  type RegisterFieldErrors,
} from "@/lib/validations/auth";

export type AuthState = {
  error?: string;
  fieldErrors?: LoginFieldErrors | RegisterFieldErrors;
} | null;

export async function loginAction(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    redirectTo: formData.get("redirectTo") ?? undefined,
  });

  if (!parsed.success) {
    return {
      fieldErrors: flattenErrors<LoginFieldErrors>(parsed.error),
      error: "Revisa los campos marcados.",
    };
  }

  const { email, password, redirectTo } = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: mapAuthError(error.message) };
  }

  const target = await resolvePostAuthRoute(redirectTo ?? "");
  revalidatePath("/", "layout");
  redirect(target);
}

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

  // Supabase está configurado con auto-confirm: signUp devuelve sesión activa
  // y el cliente queda autenticado en la misma request — sin paso de email.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name },
    },
  });

  if (error) {
    return { error: mapAuthError(error.message) };
  }

  if (!data.session) {
    // Defensa: si por configuración no llega sesión, no dejamos al usuario
    // colgado pidiéndole que "revise el correo" — lo mandamos a login.
    return {
      error:
        "Cuenta creada, pero no pudimos iniciar sesión automáticamente. Inicia sesión.",
    };
  }

  revalidatePath("/", "layout");
  redirect("/onboarding");
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

async function resolvePostAuthRoute(requested: string): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return "/login";

  const { data: membership } = await supabase
    .from("tenant_memberships")
    .select("tenant_id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (!membership) return "/onboarding";
  if (requested && requested.startsWith("/")) return requested;
  return "/dashboard";
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

function mapAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login")) return "Correo o contraseña incorrectos.";
  if (m.includes("user already registered"))
    return "Ya existe una cuenta con ese correo.";
  if (m.includes("password"))
    return "La contraseña no cumple los requisitos mínimos.";
  return message || "No pudimos completar la operación. Intenta nuevamente.";
}
