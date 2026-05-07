import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { ensureConsumidorFinalAction } from "@/actions/customers";
import { CustomersTable, type CustomerRow } from "./customers-table";

export const metadata: Metadata = { title: "Clientes" };
export const dynamic = "force-dynamic";

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
      "id, full_name, document_type, document_number, email, phone, loyalty_points, is_active, created_at"
    )
    .eq("partner_type", "customer")
    .order("created_at", { ascending: false });

  const rows = (data ?? []) as unknown as CustomerRow[];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      <header className="space-y-3">
        <span className="hud-readout">CRM · Fidelización</span>
        <h1 className="font-display text-[36px] leading-none tracking-[0.02em] text-foreground sm:text-[42px]">
          CLIENTES
        </h1>
        <p className="max-w-2xl text-[14px] leading-6 text-muted-foreground">
          Registra a tus clientes rápidamente. Solo necesitas el nombre y
          teléfono — los datos fiscales se completan después si necesitan
          factura.
        </p>
      </header>

      <CustomersTable initialRows={rows} />
    </div>
  );
}
