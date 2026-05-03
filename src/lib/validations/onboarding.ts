import { z } from "zod";
import type { BusinessType } from "@/lib/supabase/types";

const BUSINESS_TYPES = [
  "lubricentro",
  "taller",
  "autoservicio",
  "otro",
] as const satisfies readonly BusinessType[];

const slugRegex = /^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])?$/;
const asString = (v: unknown) => (typeof v === "string" ? v : "");
const optionalNullable = (v: unknown) => {
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

export const onboardingSchema = z.object({
  business_name: z.preprocess(
    asString,
    z
      .string()
      .trim()
      .min(2, "El nombre debe tener al menos 2 caracteres.")
      .max(80, "El nombre es demasiado largo.")
  ),
  slug: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase() : ""),
    z
      .string()
      .min(3, "Debe tener al menos 3 caracteres.")
      .max(60, "Máximo 60 caracteres.")
      .regex(slugRegex, "Solo minúsculas, números y guiones.")
  ),
  business_type: z.preprocess(
    asString,
    z.enum(BUSINESS_TYPES, { error: "Selecciona un tipo de negocio." })
  ),
  legal_name: z.preprocess(
    optionalNullable,
    z
      .string()
      .max(120, "La razón social no puede superar 120 caracteres.")
      .optional()
      .transform((v) => v ?? null)
  ),
  ruc: z.preprocess(
    optionalNullable,
    z
      .string()
      .regex(/^[0-9]{13}$/, "El RUC ecuatoriano debe tener 13 dígitos.")
      .optional()
      .transform((v) => v ?? null)
  ),
});

export type OnboardingInput = z.infer<typeof onboardingSchema>;

export type OnboardingFieldErrors = Partial<
  Record<keyof OnboardingInput, string>
>;
