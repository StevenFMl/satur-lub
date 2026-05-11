import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { ensureConsumidorFinalAction } from "@/actions/customers";
import { CustomersTable, type CustomerRow } from "./customers-table";

export const metadata: Metadata = { title: "Clientes · SaturLub" };
export const dynamic = "force-dynamic";

type RawBP = {
  id: string;
  full_name: string;
  document_type: string;
  document_number: string;
  email: string | null;
  phone: string | null;
  address: Record<string, string> | null;
  notes: string | null;
  loyalty_points: number;
  is_active: boolean;
  created_at: string;
};

export default async function ClientesPage() {
  const { user, membership } = await getActiveMembership();
  if (!user) redirect("/login");
  if (!membership) redirect("/onboarding");

  // Garantizar que exista "Consumidor Final" para este tenant
  await ensureConsumidorFinalAction(membership.tenant_id);

  const supabase = await createClient();
  const { data } = await supabase
    .from("business_partners")
    .select(
      "id, full_name, document_type, document_number, email, phone, address, notes, loyalty_points, is_active, created_at"
    )
    .eq("partner_type", "customer")
    .order("created_at", { ascending: false });

  const raw = (data ?? []) as unknown as RawBP[];

  // Flatten address jsonb to string
  const rows: CustomerRow[] = raw.map((r) => ({
    id: r.id,
    full_name: r.full_name,
    document_type: r.document_type as CustomerRow["document_type"],
    document_number: r.document_number,
    email: r.email,
    phone: r.phone,
    address:
      typeof r.address === "object" && r.address !== null
        ? r.address.line ?? null
        : null,
    notes: r.notes,
    loyalty_points: r.loyalty_points,
    is_active: r.is_active,
    created_at: r.created_at,
  }));

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 sm:space-y-8">
      <header className="space-y-2">
        <span className="hud-readout">Operación · Clientes</span>
        <h1 className="font-display text-[32px] leading-none tracking-[0.02em] text-foreground sm:text-[42px]">
          CLIENTES
        </h1>
        <p className="max-w-2xl text-[13px] leading-6 text-muted-foreground sm:text-[14px]">
          Registra a tus clientes rápidamente. Solo necesitas el nombre y
          teléfono — los datos fiscales se completan después si necesitan
          factura.
        </p>
      </header>

      <CustomersTable initialRows={rows} />
    </div>
  );
}
