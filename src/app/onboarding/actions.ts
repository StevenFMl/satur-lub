"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  onboardingSchema,
  type OnboardingFieldErrors,
} from "@/lib/validations/onboarding";

export type OnboardingState = {
  error?: string;
  fieldErrors?: OnboardingFieldErrors;
} | null;

export async function createTenantAction(
  _prev: OnboardingState,
  formData: FormData
): Promise<OnboardingState> {
  const parsed = onboardingSchema.safeParse({
    business_name: formData.get("business_name"),
    slug: formData.get("slug"),
    business_type: formData.get("business_type"),
    legal_name: formData.get("legal_name"),
    ruc: formData.get("ruc"),
  });

  if (!parsed.success) {
    const fieldErrors: OnboardingFieldErrors = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !(key in fieldErrors)) {
        (fieldErrors as Record<string, string>)[key] = issue.message;
      }
    }
    return { fieldErrors, error: "Revisa los campos marcados." };
  }

  const { business_name, slug, business_type, legal_name, ruc } = parsed.data;

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
