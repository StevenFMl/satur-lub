import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Daily close is now part of the unified Ventas screen.
// Redirect preserving the date param if present.
export default async function CierrePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const params = await searchParams;
  if (params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)) {
    redirect(`/dashboard/pos/ventas?date=${params.date}`);
  }
  redirect("/dashboard/pos/ventas");
}
