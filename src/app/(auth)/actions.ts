"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type AuthState = {
  error?: string;
} | null;

export async function loginAction(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const redirectTo = String(formData.get("redirectTo") ?? "");

  if (!email || !password) {
    return { error: "Ingresa tu correo y contraseña." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: mapAuthError(error.message) };
  }

  // Decide destination based on tenant membership.
  const target = await resolvePostAuthRoute(redirectTo);
  revalidatePath("/", "layout");
  redirect(target);
}

export async function registerAction(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!fullName || !email || !password) {
    return { error: "Completa todos los campos." };
  }
  if (password.length < 8) {
    return { error: "La contraseña debe tener al menos 8 caracteres." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
    },
  });

  if (error) {
    return { error: mapAuthError(error.message) };
  }

  // If email confirmations are enabled, the user is not yet authenticated.
  // Try sign-in immediately — if it fails with "Email not confirmed",
  // surface that as a notice instead of a hard error.
  const { error: loginErr } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (loginErr) {
    return {
      error:
        "Tu cuenta fue creada. Revisa tu correo para confirmar y luego inicia sesión.",
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

function mapAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login")) return "Correo o contraseña incorrectos.";
  if (m.includes("user already registered"))
    return "Ya existe una cuenta con ese correo.";
  if (m.includes("email not confirmed"))
    return "Confirma tu correo electrónico para iniciar sesión.";
  if (m.includes("password"))
    return "La contraseña no cumple los requisitos mínimos.";
  return message || "No pudimos completar la operación. Intenta nuevamente.";
}
