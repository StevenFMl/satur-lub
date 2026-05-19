import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { buildRideViewModel, type RideInput } from "@/lib/documents/ride-view-model";
import { buildAccessKeyQrSvg } from "@/lib/documents/qr";
import { renderRideHtml, buildRidePdfFilename } from "@/lib/documents/ride-html";
import { generateRidePdf } from "@/lib/documents/pdf";
import {
  buildRideStoragePath,
  uploadRidePdf,
  getSignedDocumentUrl,
  savePdfStoragePath,
  logDocumentEvent,
} from "@/lib/sri/document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: invoiceId } = await params;

  // ── Auth ──────────────────────────────────────────────────────────────────
  const { user, membership } = await getActiveMembership();
  if (!user || !membership) {
    return NextResponse.json({ error: "Sesión expirada." }, { status: 401 });
  }
  const tenantId = membership.tenant_id;
  const userId   = user.id;
  const supabase = await createClient();

  // ── 1. Fetch invoice (include storage + routing fields) ───────────────────
  const { data: invRaw, error: invErr } = await supabase
    .from("electronic_invoices")
    .select(`
      id, sale_id,
      doc_number, access_key, authorization_number, authorization_date,
      sri_environment, status, estab, pto_emi,
      pdf_storage_path
    `)
    .eq("id",        invoiceId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (invErr || !invRaw) {
    return NextResponse.json({ error: "Factura no encontrada." }, { status: 404 });
  }

  const inv    = invRaw as Record<string, unknown>;
  const saleId = inv.sale_id as string | null;
  if (!saleId) {
    return NextResponse.json({ error: "Factura sin venta asociada." }, { status: 422 });
  }

  // ── 2. Storage-first serving ──────────────────────────────────────────────
  // If we already have a stored PDF, serve it via a short-lived signed URL.
  // This skips Puppeteer entirely and serves from the CDN.
  const existingPath = inv.pdf_storage_path as string | null;
  if (existingPath) {
    const signedUrl = await getSignedDocumentUrl(existingPath, 600);
    if (signedUrl) {
      logDocumentEvent({
        tenantId, invoiceId, userId, saleId: saleId ?? undefined,
        docType: "pdf", eventType: "download", status: "ok",
        storagePath: existingPath,
      });
      return NextResponse.redirect(signedUrl, { status: 307 });
    }
    // Signed URL failed (path stale/deleted) — fall through to regenerate
  }

  // ── 3. Parallel data fetch ────────────────────────────────────────────────
  const [saleRes, itemsRes, paymentsRes, tenantRes, fiscalRes] = await Promise.all([
    supabase
      .from("sales")
      .select("id, sale_date, created_at, total, subtotal, tax_total, discount_total, notes, customer_id, warehouse_id")
      .eq("id",        saleId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),

    supabase
      .from("sale_items")
      .select("id, product_id, presentation_id, item_name, quantity, unit_price, line_total, discount_amount, is_taxable, tax_rate, base_qty")
      .eq("sale_id", saleId),

    supabase
      .from("sale_payments")
      .select("payment_method, amount")
      .eq("sale_id", saleId),

    supabase
      .from("tenants")
      .select("name, business_name, legal_name, ruc, tax_id, address")
      .eq("id", tenantId)
      .maybeSingle(),

    supabase
      .from("tenant_fiscal_config")
      .select("dir_matriz, dir_estab, obligado_contabilidad, contribuyente_especial")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  if (saleRes.error || !saleRes.data) {
    return NextResponse.json({ error: "Venta no encontrada." }, { status: 404 });
  }
  if (itemsRes.error) {
    console.error("[pdf/route] items query failed:", itemsRes.error.message);
    return NextResponse.json({ error: "Error al cargar los ítems." }, { status: 500 });
  }

  const sale      = saleRes.data  as Record<string, unknown>;
  const rawItems  = (itemsRes.data  ?? []) as any[];
  const rawPays   = (paymentsRes.data ?? []) as any[];
  const tenantRow = tenantRes.data  as Record<string, string | null> | null;
  const fiscalRow = fiscalRes.data  as Record<string, unknown>       | null;

  // ── 4. Resolve product / presentation names ───────────────────────────────
  const productIds      = [...new Set(rawItems.map((i) => i.product_id      as string).filter(Boolean))];
  const presentationIds = [...new Set(rawItems.map((i) => i.presentation_id as string).filter(Boolean))];

  const [productsRes, presRes, buyerRes, warehouseRes] = await Promise.all([
    productIds.length > 0
      ? supabase.from("products").select("id, name, sku").in("id", productIds)
      : Promise.resolve({ data: [] as any[], error: null }),

    presentationIds.length > 0
      ? supabase.from("product_presentations").select("id, unit_label").in("id", presentationIds)
      : Promise.resolve({ data: [] as any[], error: null }),

    sale.customer_id
      ? supabase.from("business_partners")
          .select("full_name, document_type, document_number, phone")
          .eq("id", sale.customer_id as string).maybeSingle()
      : Promise.resolve({ data: null, error: null }),

    sale.warehouse_id
      ? supabase.from("warehouses")
          .select("name")
          .eq("id", sale.warehouse_id as string).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const productMap = new Map<string, { name: string; sku: string }>(
    ((productsRes.data ?? []) as any[]).map((p: any) => [p.id, { name: p.name, sku: p.sku }]),
  );
  const presMap = new Map<string, string>(
    ((presRes.data ?? []) as any[]).map((p: any) => [p.id, p.unit_label]),
  );
  const buyer     = buyerRes.data     as { full_name: string; document_type: string; document_number: string; phone: string | null } | null;
  const warehouse = warehouseRes.data as { name: string } | null;

  // ── 5. Build view model ───────────────────────────────────────────────────
  const rideInput: RideInput = {
    saleDate:              sale.sale_date as string,
    docNumber:             inv.doc_number as string,
    accessKey:             (inv.access_key as string) ?? "",
    authNumber:            (inv.authorization_number as string | null) ?? null,
    authDate:              (inv.authorization_date   as string | null) ?? null,
    sri_environment:       (inv.sri_environment as "pruebas" | "produccion") ?? "pruebas",
    status:                (inv.status as string) ?? "draft",

    ruc:                   tenantRow?.ruc ?? tenantRow?.tax_id ?? "",
    razonSocial:           (tenantRow as any)?.legal_name ?? tenantRow?.business_name ?? tenantRow?.name ?? "",
    nombreComercial:       tenantRow?.business_name ?? tenantRow?.name ?? "",
    dirMatriz:             (fiscalRow?.dir_matriz as string | null) ?? tenantRow?.address ?? "",
    dirEstab:              (fiscalRow?.dir_estab  as string | null) ?? null,
    obligadoContabilidad:  Boolean(fiscalRow?.obligado_contabilidad ?? false),
    contribuyenteEspecial: (fiscalRow?.contribuyente_especial as string | null) ?? null,

    buyerDocType:   buyer?.document_type   ?? null,
    buyerName:      buyer?.full_name       ?? null,
    buyerDocNumber: buyer?.document_number ?? null,
    buyerPhone:     buyer?.phone           ?? null,

    items: rawItems.map((si) => {
      const product   = si.product_id      ? productMap.get(si.product_id)      : undefined;
      const presLabel = si.presentation_id ? presMap.get(si.presentation_id)    : undefined;
      return {
        product_name:       product?.name ?? (si.item_name as string | null) ?? "PRODUCTO",
        product_sku:        product?.sku  ?? "",
        quantity:           Number(si.quantity   ?? 0),
        line_total:         Number(si.line_total ?? 0),
        is_taxable:         Boolean(si.is_taxable),
        tax_rate:           Number(si.tax_rate   ?? 15),
        presentation_label: presLabel ?? null,
      };
    }),

    payments:      rawPays.map((p) => ({ method: p.payment_method as string, amount: Number(p.amount ?? 0) })),
    discountTotal: Number(sale.discount_total ?? 0),
    importeTotal:  Number(sale.total          ?? 0),
    warehouseName: warehouse?.name ?? null,
    saleNotes:     (sale.notes as string | null) ?? null,
  };

  const vm = buildRideViewModel(rideInput);

  // ── 6. QR code (non-blocking, falls back to null) ─────────────────────────
  const qrSvg = await buildAccessKeyQrSvg(vm.accessKey).catch(() => null);

  // ── 7. Render HTML ────────────────────────────────────────────────────────
  const html = renderRideHtml(vm, qrSvg);

  // ── 8. Generate PDF ───────────────────────────────────────────────────────
  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await generateRidePdf(html);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error generando PDF.";
    console.error("[pdf/route] generateRidePdf failed:", msg);
    logDocumentEvent({
      tenantId, invoiceId, userId, saleId: saleId ?? undefined,
      docType: "pdf", eventType: "generate", status: "error", errorMsg: msg,
    });
    return NextResponse.json({ error: msg }, { status: 503 });
  }

  // ── 9. Non-blocking Storage upload + path persistence ─────────────────────
  // Derive estab/pto_emi from the stored fields or parse from doc_number.
  const estab  = (inv.estab  as string | null) ?? (vm.docNumber.split("-")[0] ?? "001");
  const ptoEmi = (inv.pto_emi as string | null) ?? (vm.docNumber.split("-")[1] ?? "001");
  const saleDate = (sale.sale_date as string | null) ?? new Date().toISOString().slice(0, 10);

  if (vm.accessKey) {
    uploadRidePdf(
      { tenantId, estab, ptoEmi, accessKey: vm.accessKey, date: saleDate },
      new Uint8Array(pdfBuffer),
    ).then((result) => {
      if (result.ok) {
        savePdfStoragePath(invoiceId, result.path);
        logDocumentEvent({
          tenantId, invoiceId, userId, saleId: saleId ?? undefined,
          docType: "pdf", eventType: "storage_upload", status: "ok",
          storagePath: result.path,
        });
      } else {
        console.warn("[pdf/route] Storage upload skipped:", result.error);
      }
    }).catch((e) => console.warn("[pdf/route] uploadRidePdf threw:", e));
  }

  // ── 10. Audit: successful download ───────────────────────────────────────
  logDocumentEvent({
    tenantId, invoiceId, userId, saleId: saleId ?? undefined,
    docType: "pdf", eventType: "download", status: "ok",
  });

  // ── 11. Respond ──────────────────────────────────────────────────────────
  const filename = buildRidePdfFilename(vm);

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type":        "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length":      String(pdfBuffer.length),
      "Cache-Control":       "no-store",
    },
  });
}
