import { z } from "zod";

export const branchSchema = z.object({
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
  is_active: z.preprocess(
    (v) => v === "true" || v === "on" || v === true,
    z.boolean()
  ),
});

export type BranchInput = z.infer<typeof branchSchema>;
export type BranchFieldErrors = Partial<Record<keyof BranchInput, string>>;
