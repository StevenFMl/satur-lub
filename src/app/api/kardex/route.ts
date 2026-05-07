import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";

export const dynamic = "force-dynamic";

/**
 * GET /api/kardex?product_id=X&warehouse_id=Y
 *
 * Retorna los últimos 200 movimientos de un producto en una bodega.
 * RLS filtra por tenant automáticamente.
 */
export async function GET(request: NextRequest) {
  const { user, membership } = await getActiveMembership();
  if (!user || !membership) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const productId = searchParams.get("product_id");
  const warehouseId = searchParams.get("warehouse_id");

  if (!productId || !warehouseId) {
    return NextResponse.json(
      { error: "product_id y warehouse_id son requeridos" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("inventory_movements")
    .select(
      "id, created_at, movement_type, quantity, unit_cost, reason, reference_type"
    )
    .eq("product_id", productId)
    .eq("warehouse_id", warehouseId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("GET /api/kardex:", error);
    return NextResponse.json(
      { error: "Error al consultar movimientos" },
      { status: 500 }
    );
  }

  return NextResponse.json({ movements: data ?? [] });
}
