import { z } from "zod";

const trimmedOrUndef = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length === 0 ? undefined : t;
};

export const supplierSchema = z.object({
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
  document_type: z.preprocess(
    (v) => (typeof v === "string" && v.length > 0 ? v : "RUC"),
    z.enum(["RUC", "CEDULA"], { error: "Tipo de documento inválido." })
  ),
  document_number: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : ""),
    z
      .string()
      .regex(/^[0-9]+$/, "Solo dígitos.")
      .min(10, "Mínimo 10 dígitos.")
      .max(13, "Máximo 13 dígitos.")
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
  phone: z.preprocess(
    trimmedOrUndef,
    z
      .string()
      .max(40)
      .optional()
      .transform((v) => v ?? null)
  ),
  is_active: z.preprocess(
    (v) => v === "true" || v === "on" || v === true,
    z.boolean()
  ),
});

export type SupplierInput = z.infer<typeof supplierSchema>;
export type SupplierFieldErrors = Partial<Record<keyof SupplierInput, string>>;
