"use server";

/**
 * Server actions for electronic invoice generation.
 *
 * Phase 1 scope:
 *   generateInvoiceAction  — creates draft invoice (XML unsigned)
 *   getInvoiceAction       — returns existing invoice for a sale
 *   getTenantFiscalConfig  — returns fiscal config for the active tenant
 *
 * Phase 2 (future):
 *   signInvoiceAction      — signs XML with tenant's .p12 certificate
 *   sendToSriAction        — submits signed XML to SRI SOAP endpoint
 *   authorizeInvoiceAction — polls SRI for authorization response
 *   cancelInvoiceAction    — marks invoice as cancelled in SRI
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { mapSaleToSriInvoice }  from "@/lib/sri/invoice-mapper";
import { invoiceToXml, validateInvoiceData } from "@/lib/sri/invoice-xml";
import { runInvoicePipeline }   from "@/lib/sri/pipeline";
import { SRI_DOC_TYPES } from "@/lib/sri/constants";
import { uploadInvoiceXml } from "@/lib/sri/document-storage";
import type {
  TenantFiscalConfig,
  InvoiceSaleData,
  ElectronicInvoiceRecord,
  ElectronicInvoiceStatus,
} from "@/lib/sri/types";

// ── Result types ───────────────────────────────────────────────────────────

export type GenerateInvoiceResult = {
  ok?:      boolean;
  invoice?: ElectronicInvoiceRecord;
  error?:   string;
  validationErrors?: string[];
} | null;

export type GetInvoiceResult = {
  invoice?: ElectronicInvoiceRecord | null;
  error?:   string;
} | null;

export type GetFiscalConfigResult = {
  config?: TenantFiscalConfig | null;
  error?:  string;
} | null;

// ── generateInvoiceAction ──────────────────────────────────────────────────

/**
 * Generates an electronic invoice (factura) for a sale.
 *
 * Steps:
 *  1. Verify auth + permissions (owner/admin only)
 *  2. Check sale exists and belongs to tenant
 *  3. Check no invoice already exists (prevent duplicates)
 *  4. Load tenant fiscal config (must be configured)
 *  5. Reserve next sequential number (atomic DB call)
 *  6. Map sale → SriInvoice
 *  7. Validate invoice data
 *  8. Serialize to XML
 *  9. Store draft in electronic_invoices
 * 10. Return the created record
 *
 * Does NOT sign or send. Those are separate actions (Phase 2).
 */
export async function generateInvoiceAction(
  saleId: string
): Promise<GenerateInvoiceResult> {
  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { error: "Sesión expirada." };

  if (membership.role !== "owner" && membership.role !== "admin") {
    return { error: "Sin permisos para emitir facturas electrónicas." };
  }

  if (!saleId) return { error: "ID de venta requerido." };

  const supabase  = await createClient();
  const tenantId  = membership.tenant_id;

  // ── 1. Check existing invoice ────────────────────────────────────────────
  const { data: existing } = await supabase
    .from("electronic_invoices")
    .select("id, status, doc_number, access_key")
    .eq("sale_id", saleId)
    .eq("doc_type", SRI_DOC_TYPES.FACTURA)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (existing) {
    return {
      error: `Ya existe una factura para esta venta: ${existing.doc_number ?? ""}. ` +
             `Estado: ${existing.status}. Para regenear, primero anule la actual.`,
    };
  }

  // ── 2. Load sale data ────────────────────────────────────────────────────
  const { data: saleRaw, error: saleErr } = await supabase
    .from("sales")
    .select(`
      id, sale_date, created_at, total, subtotal, tax_total, discount_total, document_kind,
      business_partners!customer_id (
        full_name, document_type, document_number, phone, email
      ),
      warehouses!warehouse_id ( name ),
      sale_payments ( payment_method, amount, reference ),
      sale_items (
        id, quantity, unit_price, discount_amount, line_total,
        is_taxable, tax_rate, base_qty,
        products!product_id ( name, sku )
      )
    `)
    .eq("id", saleId)
    .eq("tenant_id", tenantId)
    .single();

  if (saleErr || !saleRaw) {
    return { error: "Venta no encontrada." };
  }

  if ((saleRaw as any).status === "cancelled") {
    return { error: "No se puede facturar una venta anulada." };
  }

  // ── 3. Load fiscal config ────────────────────────────────────────────────
  const configResult = await getTenantFiscalConfig();
  if (configResult?.error) return { error: configResult.error };
  if (!configResult?.config) {
    return { error: "El tenant no tiene configuración fiscal SRI. Configure en Ajustes → Facturación." };
  }

  const config = configResult.config;

  if (!config.ruc || !/^\d{13}$/.test(config.ruc)) {
    return { error: `RUC inválido: "${config.ruc}". Debe tener 13 dígitos.` };
  }
  if (!config.dir_matriz) {
    return { error: "La dirección de matriz no está configurada en Ajustes → Facturación." };
  }

  // ── 4. Reserve sequential number (atomic) ────────────────────────────────
  const { data: seqData, error: seqErr } = await supabase.rpc(
    "next_invoice_sequential",
    {
      p_tenant_id: tenantId,
      p_estab:     config.estab,
      p_pto_emi:   config.pto_emi,
      p_doc_type:  SRI_DOC_TYPES.FACTURA,
    } as never
  );

  if (seqErr || seqData === null) {
    console.error("generateInvoiceAction [sequential]:", seqErr?.message);
    return { error: "No se pudo reservar el número secuencial. Intenta de nuevo." };
  }

  const sequential = Number(seqData);

  // ── 5. Map sale → SriInvoice ─────────────────────────────────────────────
  const rawSale = saleRaw as any;

  const saleData: InvoiceSaleData = {
    id:             rawSale.id,
    sale_date:      rawSale.sale_date,
    created_at:     rawSale.created_at,
    total:          Number(rawSale.total          ?? 0),
    subtotal:       Number(rawSale.subtotal        ?? 0),
    tax_total:      Number(rawSale.tax_total       ?? 0),
    discount_total: Number(rawSale.discount_total  ?? 0),
    document_kind:  rawSale.document_kind,
    customer: rawSale.business_partners
      ? {
          full_name:       rawSale.business_partners.full_name,
          document_type:   rawSale.business_partners.document_type,
          document_number: rawSale.business_partners.document_number,
          phone:           rawSale.business_partners.phone ?? null,
          email:           rawSale.business_partners.email ?? null,
        }
      : null,
    warehouse: rawSale.warehouses ? { name: rawSale.warehouses.name } : null,
    items: ((rawSale.sale_items as any[]) ?? []).map((si: any) => ({
      id:              si.id,
      quantity:        Number(si.quantity      ?? 0),
      unit_price:      Number(si.unit_price    ?? 0),
      discount_amount: Number(si.discount_amount ?? 0),
      line_total:      Number(si.line_total    ?? 0),
      is_taxable:      Boolean(si.is_taxable),
      tax_rate:        Number(si.tax_rate      ?? 15),
      base_qty:        Number(si.base_qty      ?? 1),
      product_name:    si.products?.name ?? "PRODUCTO",
      product_sku:     si.products?.sku  ?? si.id.slice(0, 20),
    })),
    payments: ((rawSale.sale_payments as any[]) ?? []).map((p: any) => ({
      payment_method: p.payment_method,
      amount:         Number(p.amount ?? 0),
      reference:      p.reference ?? null,
    })),
  };

  // ── 6. Map + validate ────────────────────────────────────────────────────
  let mapped: ReturnType<typeof mapSaleToSriInvoice>;
  try {
    mapped = mapSaleToSriInvoice({ sale: saleData, config, sequential });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Error al construir la factura.";
    console.error("generateInvoiceAction [mapper]:", msg);
    return { error: msg };
  }

  const validationErrors = validateInvoiceData(mapped.invoice);
  if (validationErrors.length > 0) {
    return {
      error: "La factura tiene errores de validación.",
      validationErrors: validationErrors.map((e) => `${e.field}: ${e.message}`),
    };
  }

  // ── 7. Generate XML ──────────────────────────────────────────────────────
  const xmlUnsigned = invoiceToXml(mapped.invoice);

  // ── 8. Store draft ───────────────────────────────────────────────────────
  const { data: created, error: insertErr } = await supabase
    .from("electronic_invoices")
    .insert({
      tenant_id:       tenantId,
      sale_id:         saleId,
      doc_type:        SRI_DOC_TYPES.FACTURA,
      estab:           config.estab,
      pto_emi:         config.pto_emi,
      secuencial:      sequential,
      access_key:      mapped.accessKey,
      sri_environment: config.sri_environment,
      status:          "draft",
      xml_unsigned:    xmlUnsigned,
      created_by:      user.id,
    })
    .select()
    .single();

  if (insertErr) {
    console.error("generateInvoiceAction [insert]:", insertErr.message);
    if (insertErr.message.includes("uq_electronic_invoices_sale_doctype")) {
      return { error: "Ya existe una factura para esta venta (conflicto de unicidad)." };
    }
    if (insertErr.message.includes("uq_einvoices_access_key")) {
      return { error: "Clave de acceso duplicada. Intenta de nuevo." };
    }
    return { error: "No se pudo guardar la factura. Intenta de nuevo." };
  }

  revalidatePath(`/dashboard/pos/ventas/${saleId}`);
  revalidatePath("/dashboard/pos/ventas");

  return { ok: true, invoice: created as unknown as ElectronicInvoiceRecord };
}

// ── getInvoiceAction ───────────────────────────────────────────────────────

/**
 * Returns the existing electronic invoice for a sale (null if none exists).
 */
export async function getInvoiceAction(saleId: string): Promise<GetInvoiceResult> {
  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { error: "Sesión expirada." };

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("electronic_invoices")
    .select("*")
    .eq("sale_id", saleId)
    .eq("doc_type", SRI_DOC_TYPES.FACTURA)
    .eq("tenant_id", membership.tenant_id)
    .maybeSingle();

  if (error) {
    console.error("getInvoiceAction:", error.message);
    return { error: "No se pudo cargar la factura." };
  }

  return { invoice: data as ElectronicInvoiceRecord | null };
}

// ── getTenantFiscalConfig ──────────────────────────────────────────────────

/**
 * Returns the complete fiscal config for the current tenant, merging
 * data from both `tenants` (ruc, razon_social, etc.) and
 * `tenant_fiscal_config` (estab, dir_matriz, sri_environment, etc.).
 */
export async function getTenantFiscalConfig(): Promise<GetFiscalConfigResult> {
  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { error: "Sesión expirada." };

  const supabase  = await createClient();
  const tenantId  = membership.tenant_id;

  // Fetch base tenant info
  const { data: tenant } = await supabase
    .from("tenants")
    .select("id, legal_name, business_name, ruc, taxpayer_regime, contributor_type")
    .eq("id", tenantId)
    .maybeSingle();

  // Fetch SRI-specific config (may not exist yet)
  const { data: fiscal } = await supabase
    .from("tenant_fiscal_config")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!tenant) return { config: null };

  const t = tenant as Record<string, unknown>;
  const f = (fiscal ?? {}) as Record<string, unknown>;

  const config: TenantFiscalConfig = {
    tenant_id:             tenantId,
    ruc:                   (t.ruc as string | null) ?? "",
    razon_social:          (t.legal_name as string | null) ?? (t.business_name as string) ?? "",
    nombre_comercial:      (t.business_name as string) ?? "",
    dir_matriz:            (f.dir_matriz as string | null) ?? "",
    dir_estab:             (f.dir_estab  as string | null) ?? null,
    estab:                 (f.estab      as string | null) ?? "001",
    pto_emi:               (f.pto_emi    as string | null) ?? "001",
    obligado_contabilidad: Boolean(f.obligado_contabilidad ?? false),
    contribuyente_especial: (f.contribuyente_especial as string | null) ?? null,
    sri_environment:       (f.sri_environment as "pruebas" | "produccion" | null) ?? "pruebas",
    cert_filename:         (f.cert_filename as string | null) ?? null,
    cert_expiry:           (f.cert_expiry   as string | null) ?? null,
  };

  return { config };
}

// ── processInvoiceAction ───────────────────────────────────────────────────

export type ProcessInvoiceResult = {
  ok?:                 boolean;
  finalStatus?:        ElectronicInvoiceStatus;
  authorizationNumber?: string;
  authorizationDate?:  string;
  error?:              string;
  sriErrors?:          { identificador: string; mensaje: string; tipo: string }[];
  phase?:              string;
} | null;

/**
 * Full pipeline: sign → send → authorize, with DB persistence at each step.
 *
 * Requires:
 *   - electronic_invoices row in status 'draft' for this invoiceId
 *   - SRI_CERT_P12_BASE64 and SRI_CERT_PASSWORD env vars
 *
 * The invoice status is updated in the DB after each phase so partial
 * progress is preserved if a later phase fails.
 */
export async function processInvoiceAction(
  invoiceId: string
): Promise<ProcessInvoiceResult> {
  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { error: "Sesión expirada." };

  if (membership.role !== "owner" && membership.role !== "admin") {
    return { error: "Sin permisos para procesar facturas electrónicas." };
  }

  const supabase  = await createClient();
  const tenantId  = membership.tenant_id;

  // ── Load the draft invoice ─────────────────────────────────────────────
  const { data: inv, error: invErr } = await supabase
    .from("electronic_invoices")
    .select("id, status, access_key, xml_unsigned, xml_signed, sri_environment, sale_id, estab, pto_emi, created_at")
    .eq("id", invoiceId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (invErr || !inv) return { error: "Factura no encontrada." };

  const invoiceRaw = inv as Record<string, unknown>;

  // Allow re-processing from: draft or signed (retry send), or sent (retry auth)
  const currentStatus = invoiceRaw.status as ElectronicInvoiceStatus;
  if (currentStatus === "authorized") {
    return { error: "La factura ya está autorizada por el SRI." };
  }
  if (currentStatus === "cancelled") {
    return { error: "La factura fue cancelada y no puede reemitirse." };
  }

  const xmlUnsigned   = invoiceRaw.xml_unsigned    as string | null;
  const xmlSigned     = invoiceRaw.xml_signed      as string | null;
  const accessKey     = invoiceRaw.access_key      as string;
  const environment   = (invoiceRaw.sri_environment ?? "pruebas") as "pruebas" | "produccion";
  const saleId        = invoiceRaw.sale_id         as string;
  const estab         = (invoiceRaw.estab          as string) ?? "001";
  const ptoEmi        = (invoiceRaw.pto_emi        as string) ?? "001";
  const invDate       = ((invoiceRaw.created_at    as string | null) ?? new Date().toISOString()).slice(0, 10);

  if (!xmlUnsigned) return { error: "La factura no tiene XML generado. Regenera el borrador." };

  // ── Run the pipeline ───────────────────────────────────────────────────
  const result = await runInvoicePipeline({
    invoiceId,
    accessKey,
    xmlUnsigned,
    environment,
    tenantId,
  });

  // ── Persist result to DB ──────────────────────────────────────────────
  const updatePayload: Record<string, unknown> = {
    status:     result.finalStatus,
    updated_at: new Date().toISOString(),
  };

  if (result.xmlSigned)            updatePayload.xml_signed           = result.xmlSigned;
  if (result.authorizationNumber)  updatePayload.authorization_number = result.authorizationNumber;
  if (result.authorizationDate)    updatePayload.authorization_date   = result.authorizationDate ? new Date(result.authorizationDate.replace(/(\d{2})\/(\d{2})\/(\d{4}) (\d{2}:\d{2}:\d{2})/, "$3-$2-$1T$4-05:00")).toISOString() : null;
  if (result.errors.length > 0)    updatePayload.sri_errors           = result.errors;

  // ── Upload signed XML to Storage ─────────────────────────────────────────
  // Non-blocking: a storage failure doesn't fail the invoice processing.
  // The xml_signed DB column remains the source of truth; storage is additive.
  if (result.xmlSigned) {
    const uploadResult = await uploadInvoiceXml(
      { tenantId, estab, ptoEmi, accessKey, date: invDate },
      result.xmlSigned,
    );
    if (uploadResult.ok) {
      updatePayload.xml_storage_path = uploadResult.path;
    } else {
      console.warn("[processInvoiceAction] storage upload skipped:", uploadResult.error);
    }
  }

  await supabase
    .from("electronic_invoices")
    .update(updatePayload)
    .eq("id", invoiceId)
    .eq("tenant_id", tenantId);

  // Revalidate the sale detail page
  if (saleId) revalidatePath(`/dashboard/pos/ventas/${saleId}`);
  revalidatePath("/dashboard/pos/ventas");

  if (!result.ok) {
    return {
      error:      result.message ?? `Error en fase ${result.phase}.`,
      finalStatus: result.finalStatus,
      sriErrors:  result.errors,
      phase:      result.phase,
    };
  }

  return {
    ok:                  true,
    finalStatus:         result.finalStatus,
    authorizationNumber: result.authorizationNumber,
    authorizationDate:   result.authorizationDate ?? undefined,
  };
}

// ── recheckAuthorizationAction ────────────────────────────────────────────

export type RecheckResult = {
  ok?:                 boolean;
  finalStatus?:        ElectronicInvoiceStatus;
  authorizationNumber?: string;
  authorizationDate?:  string;
  error?:              string;
  sriErrors?:          { identificador: string; mensaje: string; tipo: string }[];
} | null;

/**
 * Manually re-checks the SRI authorization for a comprobante in 'sent' status.
 * Used when the initial authorization poll returned EN PROCESO.
 */
export async function recheckAuthorizationAction(
  invoiceId: string
): Promise<RecheckResult> {
  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { error: "Sesión expirada." };

  const supabase = await createClient();
  const tenantId = membership.tenant_id;

  const { data: inv } = await supabase
    .from("electronic_invoices")
    .select("id, status, access_key, sri_environment, sale_id")
    .eq("id", invoiceId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!inv) return { error: "Factura no encontrada." };

  const invoiceRaw = inv as Record<string, unknown>;
  if (invoiceRaw.status === "authorized") {
    return { ok: true, finalStatus: "authorized" };
  }
  if (invoiceRaw.status !== "sent") {
    return { error: `Solo se puede reverificar una factura en estado 'sent'. Estado actual: ${invoiceRaw.status}.` };
  }

  const { queryAuthorization } = await import("@/lib/sri/soap-client");
  const accessKey   = invoiceRaw.access_key   as string;
  const environment = (invoiceRaw.sri_environment ?? "pruebas") as "pruebas" | "produccion";
  const saleId      = invoiceRaw.sale_id       as string;

  const authResult  = await queryAuthorization(accessKey, environment);

  if (authResult.estado === "AUTORIZADO") {
    await supabase
      .from("electronic_invoices")
      .update({
        status:               "authorized",
        authorization_number: authResult.numeroAutorizacion,
        authorization_date:   authResult.fechaAutorizacion,
        sri_errors:           authResult.errors.length > 0 ? authResult.errors : null,
        updated_at:           new Date().toISOString(),
      })
      .eq("id", invoiceId)
      .eq("tenant_id", tenantId);

    if (saleId) revalidatePath(`/dashboard/pos/ventas/${saleId}`);

    return {
      ok: true, finalStatus: "authorized",
      authorizationNumber: authResult.numeroAutorizacion ?? undefined,
      authorizationDate:   authResult.fechaAutorizacion  ?? undefined,
    };
  }

  if (authResult.estado === "EN PROCESO") {
    return { error: "El SRI aún está procesando el comprobante. Espera unos segundos e intenta de nuevo." };
  }

  // NO AUTORIZADO
  await supabase
    .from("electronic_invoices")
    .update({ status: "rejected", sri_errors: authResult.errors, updated_at: new Date().toISOString() })
    .eq("id", invoiceId)
    .eq("tenant_id", tenantId);

  if (saleId) revalidatePath(`/dashboard/pos/ventas/${saleId}`);

  return {
    error: "El SRI rechazó el comprobante.",
    finalStatus: "rejected",
    sriErrors:   authResult.errors,
  };
}
