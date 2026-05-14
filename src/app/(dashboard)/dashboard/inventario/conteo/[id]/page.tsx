import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { CountSheet, type CountLine } from "./count-sheet";

export const metadata: Metadata = { title: "Sesión de conteo · Inventario | SaturLub" };
export const dynamic = "force-dynamic";

type RawSession = {
  id: string;
  status: string;
  notes: string | null;
  created_at: string;
  closed_at: string | null;
  warehouses: { id: string; name: string } | null;
};

type RawLine = {
  id: string;
  product_id: string;
  qty_system: number | string;
  qty_counted: number | string | null;
  note: string | null;
  products: { id: string; name: string; sku: string; unit: string } | null;
};

export default async function ConteoSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { user, membership } = await getActiveMembership();
  if (!user)       redirect("/login");
  if (!membership) redirect("/onboarding");

  const supabase = await createClient();
  const tenantId = membership.tenant_id;

  const [sessionResult, linesResult] = await Promise.all([
    supabase
      .from("stock_count_sessions")
      .select("id, status, notes, created_at, closed_at, warehouses ( id, name )")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle(),

    supabase
      .from("stock_count_lines")
      .select(`
        id, product_id, qty_system, qty_counted, note,
        products ( id, name, sku, unit )
      `)
      .eq("session_id", id)
      .eq("tenant_id", tenantId)
      .order("products(name)", { ascending: true }),
  ]);

  if (!sessionResult.data) notFound();

  const session = sessionResult.data as unknown as RawSession;
  const rawLines = ((linesResult.data ?? []) as unknown) as RawLine[];

  const lines: CountLine[] = rawLines.map((l) => ({
    id:           l.id,
    product_id:   l.product_id,
    product_name: l.products?.name  ?? "Producto",
    product_sku:  l.products?.sku   ?? "—",
    product_unit: l.products?.unit  ?? "unidad",
    qty_system:   Number(l.qty_system  ?? 0),
    qty_counted:  l.qty_counted != null ? Number(l.qty_counted) : null,
    note:         l.note,
  }));

  const canManage = membership.role === "owner" || membership.role === "admin";

  return (
    <CountSheet
      sessionId={id}
      warehouseName={(session.warehouses as { id: string; name: string } | null)?.name ?? "Bodega"}
      sessionStatus={session.status as "in_progress" | "closed"}
      sessionNotes={session.notes}
      createdAt={session.created_at}
      closedAt={session.closed_at}
      initialLines={lines}
      canManage={canManage}
    />
  );
}
