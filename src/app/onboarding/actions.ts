"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { BusinessType } from "@/lib/supabase/types";

export type OnboardingState = {
  error?: string;
  fieldErrors?: Partial<Record<
    "business_name" | "slug" | "business_type",
    string
  >>;
} | null;

const VALID_BUSINESS_TYPES: BusinessType[] = [
  "lubricentro",
  "taller",
  "autoservicio",
  "otro",
];

export async function createTenantAction(
  _prev: OnboardingState,
  formData: FormData
): Promise<OnboardingState> {
  const business_name = String(formData.get("business_name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "")
    .trim()
    .toLowerCase();
  const legal_name = String(formData.get("legal_name") ?? "").trim() || null;
  const ruc = String(formData.get("ruc") ?? "").trim() || null;
  const business_type = String(
    formData.get("business_type") ?? ""
  ) as BusinessType;

  const fieldErrors: NonNullable<OnboardingState>["fieldErrors"] = {};
  if (!business_name) fieldErrors.business_name = "Ingresa el nombre del negocio.";
  if (!slug) fieldErrors.slug = "Ingresa un identificador.";
  else if (!/^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])?$/.test(slug))
    fieldErrors.slug =
      "Solo minúsculas, números y guiones (3 a 60 caracteres).";
  if (!VALID_BUSINESS_TYPES.includes(business_type))
    fieldErrors.business_type = "Selecciona un tipo de negocio.";

  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors, error: "Revisa los campos marcados." };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase.rpc("create_tenant_for_owner", {
    p_business_name: business_name,
    p_slug: slug,
    p_business_type: business_type,
    p_legal_name: legal_name,
    p_ruc: ruc,
  } as never);

  if (error) {
    const m = error.message.toLowerCase();
    if (m.includes("duplicate") || m.includes("unique")) {
      return {
        fieldErrors: { slug: "Ese identificador ya está en uso." },
        error: "Elige otro identificador disponible.",
      };
    }
    return { error: error.message };
  }

  if (!data) {
    return { error: "No pudimos crear tu negocio. Intenta nuevamente." };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}
