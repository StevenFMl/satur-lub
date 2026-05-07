import { z } from "zod";

const trimmedOrUndef = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length === 0 ? undefined : t;
};

export const CONSUMIDOR_FINAL_DOC = "9999999999999";

export const customerSchema = z.object({
  id: z.preprocess(
    (v) => (typeof v === "string" && v.length > 0 ? v : undefined),
    z.string().uuid().optional()
  ),
  full_name: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : ""),
    z
      .string()
      .min(2, "Nombre demasiado corto.")
      .max(120, "Máx. 120 caracteres.")
  ),
  phone: z.preprocess(
    trimmedOrUndef,
    z
      .string()
      .max(40)
      .optional()
      .transform((v) => v ?? null)
  ),
  email: z.preprocess(
    trimmedOrUndef,
    z
      .string()
      .email("Email inválido.")
      .max(120)
      .optional()
      .transform((v) => v ?? null)
  ),
  document_type: z.preprocess(
    (v) =>
      typeof v === "string" && v.length > 0 ? v : "CONSUMIDOR_FINAL",
    z.enum(["CEDULA", "RUC", "CONSUMIDOR_FINAL", "PASAPORTE"], {
      error: "Tipo de documento inválido.",
    })
  ),
  document_number: z.preprocess(
    (v) => {
      if (typeof v !== "string") return CONSUMIDOR_FINAL_DOC;
      const t = v.trim();
      return t.length === 0 ? CONSUMIDOR_FINAL_DOC : t;
    },
    z
      .string()
      .regex(/^[0-9]+$/, "Solo dígitos.")
      .min(10, "Mínimo 10 dígitos.")
      .max(13, "Máximo 13 dígitos.")
  ),
  address: z.preprocess(
    trimmedOrUndef,
    z
      .string()
      .max(300)
      .optional()
      .transform((v) => v ?? null)
  ),
  is_active: z.preprocess(
    (v) => v === "true" || v === "on" || v === true,
    z.boolean()
  ),
});

export type CustomerInput = z.infer<typeof customerSchema>;
export type CustomerFieldErrors = Partial<Record<keyof CustomerInput, string>>;
