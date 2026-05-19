import type { NextRequest } from "next/server";
import { NextResponse }      from "next/server";
import { createClient }      from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { getSignedDocumentUrl } from "@/lib/sri/document-storage";

export const dynamic = "force-dynamic";

/**
 * GET /api/invoices/[id]/xml
 *
 * Download strategy (in priority order):
 *   1. xml_storage_path set → generate 5-min signed URL → 307 redirect to
 *      Supabase Storage CDN (no Next.js traffic for the actual bytes).
 *   2. xml_signed in DB → stream directly from the response body (backward compat).
 *   3. xml_unsigned in DB → same as above (draft XML, not yet signed).
 *   4. Nothing → 404.
 *
 * Auth: always checks tenant membership before any content is served.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const { user, membership } = await getActiveMembership();
  if (!user || !membership) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const supabase = await createClient();

  const { data: inv, error } = await supabase
    .from("electronic_invoices")
    .select("xml_signed, xml_unsigned, doc_number, status, xml_storage_path")
    .eq("id",        id)
    .eq("tenant_id", membership.tenant_id)
    .single();

  if (error || !inv) {
    return new NextResponse("Not found", { status: 404 });
  }

  const raw = inv as Record<string, unknown>;

  // ── 1. Storage path exists → redirect to signed URL ─────────────────────
  const storagePath = raw.xml_storage_path as string | null;
  if (storagePath) {
    const signedUrl = await getSignedDocumentUrl(storagePath, 300);
    if (signedUrl) {
      // 307 Temporary Redirect: browser follows with the same method (GET),
      // then downloads directly from the CDN.  Content-Disposition is set
      // by the storage bucket settings or the query param ?download=
      return NextResponse.redirect(signedUrl, { status: 307 });
    }
    // If signing fails (e.g. file not actually in bucket), fall through to DB copy.
    console.warn(`[api/invoices/xml] signed URL failed for ${storagePath}, falling back to DB`);
  }

  // ── 2. Serve from DB column (backward compat) ────────────────────────────
  const xml = (raw.xml_signed ?? raw.xml_unsigned) as string | null;
  if (!xml) {
    return new NextResponse("XML no disponible para esta factura.", { status: 404 });
  }

  const rawNum  = (raw.doc_number as string | null) ?? "";
  const safeNum = rawNum.replace(/[^0-9\-]/g, "_") || id.slice(0, 8).toUpperCase();
  const filename = `FACTURA_${safeNum}.xml`;

  return new NextResponse(xml, {
    headers: {
      "Content-Type":        "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
