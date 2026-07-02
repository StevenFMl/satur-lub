import { redirect } from "next/navigation";

export default async function ReposicionRedirect({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  query.set("tab", "reposicion");
  for (const [key, val] of Object.entries(params)) {
    if (val) query.set(key, val);
  }
  redirect(`/dashboard/inventario/productos?${query.toString()}`);
}
