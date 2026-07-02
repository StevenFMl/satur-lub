import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { generateRidePdf } from "@/lib/documents/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeHtml(text: string): string {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatProductStock(
  baseQty: number,
  baseUnit: string,
  presentations: Array<{ name: string; unit_label: string; base_qty: number; is_active: boolean }> = []
): string {
  if (baseQty <= 0) return "Agotado";

  const pluralize = (unitVal: string, qty: number) => {
    if (qty === 1) return unitVal;
    const u = unitVal.toLowerCase();
    if (u === "cuarto") return "cuartos";
    if (u === "litro") return "litros";
    if (u === "unidad" || u === "und") return "unidades";
    return unitVal.endsWith("o") || unitVal.endsWith("a") ? unitVal + "s" : unitVal + "es";
  };

  const activePres = presentations.filter((p) => p.is_active);
  if (activePres.length === 0) {
    return `${Number(baseQty.toFixed(2))} ${pluralize(baseUnit, baseQty)}`;
  }

  // Sort presentations by base_qty descending
  const sorted = [...activePres].sort((a, b) => b.base_qty - a.base_qty);
  const parts: string[] = [];
  let remaining = baseQty;

  for (const pres of sorted) {
    // If the presentation is exactly the unit base, skip it in divisions
    if (pres.base_qty === 1) continue;

    if (remaining >= pres.base_qty) {
      const count = Math.floor(remaining / pres.base_qty);
      remaining = Number((remaining % pres.base_qty).toFixed(4));

      let displayName = pres.unit_label;
      if (count > 1) {
        if (displayName.toLowerCase() === "galón" || displayName.toLowerCase() === "galon") {
          displayName = "galones";
        } else if (displayName.toLowerCase() === "caneca") {
          displayName = "canecas";
        } else {
          displayName = displayName.endsWith("o") || displayName.endsWith("a") ? displayName + "s" : displayName + "es";
        }
      }
      parts.push(`${count} ${displayName}`);
    }
  }

  if (remaining > 0) {
    parts.push(`${Number(remaining.toFixed(2))} ${pluralize(baseUnit, remaining)}`);
  }

  return parts.length > 0 ? parts.join(", ") : `0 ${pluralize(baseUnit, 0)}`;
}

export async function GET(): Promise<NextResponse> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const { user, membership } = await getActiveMembership();
  if (!user || !membership) {
    return NextResponse.json({ error: "Sesión expirada." }, { status: 401 });
  }
  const tenantId = membership.tenant_id;
  const supabase = await createClient();

  // ── 1. Fetch Tenant and Active Products with Balances and Presentations ───
  const [tenantRes, productsRes] = await Promise.all([
    supabase
      .from("tenants")
      .select("business_name, legal_name")
      .eq("id", tenantId)
      .maybeSingle(),

    supabase
      .from("products")
      .select(`
        id,
        sku,
        name,
        cost_price,
        default_price,
        has_tax,
        tax_rate,
        unit,
        inventory_balances(quantity_on_hand),
        product_presentations(id, name, unit_label, base_qty, is_active)
      `)
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("name", { ascending: true })
  ]);

  if (productsRes.error) {
    console.error("[api/reports/prices/pdf] Products query error:", productsRes.error);
    return NextResponse.json({ error: "Error al consultar catálogo." }, { status: 500 });
  }

  const tenantName = tenantRes.data?.business_name || tenantRes.data?.legal_name || "Lubricantes Steven";
  const products = productsRes.data ?? [];

  // ── 2. Format Emission Date ──────────────────────────────────────────────
  const now = new Date();
  const dateStr = now.toLocaleDateString("es-EC", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }) + " " + now.toLocaleTimeString("es-EC", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  // ── 3. Generate HTML Content ──────────────────────────────────────────────
  let rowsHtml = "";
  for (const p of products) {
    const taxRate = Number(p.tax_rate ?? 15);
    const costWithIva = p.has_tax 
      ? Number(p.cost_price ?? 0) * (1 + taxRate / 100) 
      : Number(p.cost_price ?? 0);
      
    const costStr = `$${costWithIva.toFixed(2)}`;
    const pvpStr = p.default_price ? `$${Number(p.default_price).toFixed(2)}` : "—";

    // Sum inventory balances to get consolidated stock
    const baseStock = (p.inventory_balances as Array<{ quantity_on_hand: number }> | null ?? [])
      .reduce((acc, b) => acc + Number(b.quantity_on_hand), 0);

    const stockStr = formatProductStock(
      baseStock,
      p.unit as string,
      p.product_presentations as Array<{ name: string; unit_label: string; base_qty: number; is_active: boolean }> ?? []
    );

    rowsHtml += `
      <tr>
        <td class="sku">${escapeHtml(p.sku)}</td>
        <td>${escapeHtml(p.name)}</td>
        <td class="number" style="text-align: right; white-space: nowrap;">${escapeHtml(stockStr)}</td>
        <td class="number">${costStr}</td>
        <td class="number">${pvpStr}</td>
      </tr>
    `;
  }

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @page {
      size: A4;
      margin: 12mm 15mm 15mm 15mm;
      @bottom-right {
        content: "Página " counter(page) " de " counter(pages);
        font-family: 'Inter', Arial, sans-serif;
        font-size: 8px;
        color: #94a3b8;
      }
    }
    body {
      font-family: 'Inter', Arial, sans-serif;
      color: #1e293b;
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact;
    }
    .header {
      border-bottom: 2px solid #cbd5e1;
      padding-bottom: 8px;
      margin-bottom: 15px;
    }
    .business-name {
      font-size: 14px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #0f172a;
    }
    .title {
      font-size: 18px;
      font-weight: 700;
      color: #1e293b;
      margin-top: 4px;
      margin-bottom: 2px;
    }
    .meta {
      font-size: 10px;
      color: #64748b;
      font-family: monospace;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
    }
    th {
      background-color: #f8fafc;
      color: #475569;
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      padding: 7px 10px;
      border-bottom: 1.5px solid #e2e8f0;
      text-align: left;
    }
    td {
      font-size: 10px;
      padding: 6px 10px;
      border-bottom: 1px solid #f1f5f9;
      color: #334155;
    }
    tr:nth-child(even) td {
      background-color: #f8fafc;
    }
    .sku {
      font-family: monospace;
      font-weight: 600;
      color: #0f172a;
    }
    .number {
      text-align: right;
      font-family: monospace;
      font-weight: 500;
      white-space: nowrap;
    }
    .footer-note {
      position: fixed;
      bottom: 0;
      left: 0;
      width: 100%;
      text-align: center;
      font-size: 8px;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      border-top: 1px solid #f1f5f9;
      padding-top: 6px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="business-name">${escapeHtml(tenantName)}</div>
    <div class="title">Lista de Precios de Referencia - Uso Interno</div>
    <div class="meta">Emisión: ${escapeHtml(dateStr)} | Moneda: USD (Precios c/IVA)</div>
  </div>
  
  <table>
    <thead>
      <tr>
        <th style="width: 20%">SKU</th>
        <th>Producto</th>
        <th style="width: 25%; text-align: right;">Stock actual</th>
        <th style="width: 18%; text-align: right;">Costo Dist. (c/IVA)</th>
        <th style="width: 18%; text-align: right;">PVP Público (c/IVA)</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>

  <div class="footer-note">
    Documento de uso interno · Información confidencial de ${escapeHtml(tenantName)}
  </div>
</body>
</html>
  `.trim();

  // ── 4. Generate PDF using Puppeteer ───────────────────────────────────────
  try {
    const pdfBuffer = await generateRidePdf(html, {
      format: "A4",
      margins: { top: "12mm", right: "15mm", bottom: "15mm", left: "15mm" }
    });

    const fileDate = now.toISOString().slice(0, 10);
    const filename = `lista_precios_${fileDate}.pdf`;

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(pdfBuffer.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error desconocido al generar PDF.";
    console.error("[api/reports/prices/pdf] PDF generation failed:", msg);
    return NextResponse.json({ error: "No se pudo generar el reporte PDF." }, { status: 500 });
  }
}
