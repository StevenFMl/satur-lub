import { z } from "zod";

const trimOrUndef = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length === 0 ? undefined : t;
};

export const warehouseSchema = z.object({
  id: z.preprocess(
    (v) => (typeof v === "string" && v.length > 0 ? v : undefined),
    z.string().uuid().optional()
  ),
  name: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : ""),
    z
      .string()
      .min(2, "Nombre demasiado corto.")
      .max(80, "Máx. 80 caracteres.")
  ),
  branch_id: z.preprocess(
    trimOrUndef,
    z
      .string()
      .uuid("Sucursal inválida.")
      .optional()
      .transform((v) => v ?? null)
  ),
  is_active: z.preprocess(
    (v) => v === "true" || v === "on" || v === true,
    z.boolean()
  ),
});

export type WarehouseInput = z.infer<typeof warehouseSchema>;
export type WarehouseFieldErrors = Partial<
  Record<keyof WarehouseInput, string>
>;
