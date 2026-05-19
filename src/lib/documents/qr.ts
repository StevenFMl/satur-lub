/**
 * QR code generation for SRI electronic invoices.
 *
 * The QR payload is the 49-digit access key (clave de acceso) — the format
 * expected by SRI verification apps and the SRI Ficha Técnica.
 *
 * Uses the `qrcode` npm package to produce an inline SVG string.
 * Returns null gracefully if the package fails to load (edge / non-Node envs).
 */

export type QrOptions = {
  size?:         number;  // side length in pixels (default 80)
  errorLevel?:   "L" | "M" | "Q" | "H";
};

/**
 * Returns an SVG string suitable for embedding directly in HTML/PDF.
 * The SVG has no width/height attributes — size it with CSS/style.
 * Returns null if qrcode is unavailable.
 */
export async function buildAccessKeyQrSvg(
  accessKey: string,
  opts: QrOptions = {},
): Promise<string | null> {
  if (!accessKey || accessKey.length !== 49) return null;
  try {
    // Dynamic import keeps this out of the client bundle.
    const QRCode = (await import("qrcode")).default;
    const svg = await QRCode.toString(accessKey, {
      type:          "svg",
      margin:        0,
      errorCorrectionLevel: opts.errorLevel ?? "M",
    });
    return svg;
  } catch {
    return null;
  }
}
