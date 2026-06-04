import { z } from "zod";

export const convertInventorySchema = z.object({
  warehouse_id:       z.string().uuid("Bodega requerida."),
  source_product_id:  z.string().uuid("Producto origen requerido."),
  dest_product_id:    z.string().uuid("Producto destino requerido."),
  source_qty:         z.number().positive("La cantidad origen debe ser positiva."),
  dest_qty:           z.number().positive("La cantidad destino debe ser positiva."),
  notes:              z.string().max(500, "Máximo 500 caracteres.").nullish(),
}).refine(
  (d) => d.source_product_id !== d.dest_product_id,
  {
    message: "El producto origen y destino no pueden ser el mismo.",
    path: ["dest_product_id"],
  }
);

export type ConvertInventoryInput = z.infer<typeof convertInventorySchema>;
