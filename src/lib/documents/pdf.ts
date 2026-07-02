/**
 * Puppeteer-based PDF generation.
 *
 * Environment strategy:
 *   1. CHROME_EXECUTABLE_PATH env var is set → use puppeteer-core with that
 *      path (Vercel/Lambda: install @sparticuz/chromium + puppeteer-core).
 *   2. Otherwise → use the full `puppeteer` package which auto-downloads
 *      Chromium on first run (dev / self-hosted Node.js servers).
 *
 * For Vercel deployment, add to package.json:
 *   "puppeteer-core": "^...",
 *   "@sparticuz/chromium": "^..."
 * and set env var:
 *   CHROME_EXECUTABLE_PATH=$(npx @sparticuz/chromium path)
 *
 * The function is intentionally thin — all RIDE logic lives in
 * ride-html.ts / ride-view-model.ts; this module only wraps Puppeteer.
 */

export type PdfOptions = {
  /** A4 by default. */
  format?: "A4" | "Letter";
  /** Page margins in mm. Defaults match the RIDE @page rule. */
  margins?: { top: string; right: string; bottom: string; left: string };
};

const DEFAULT_MARGINS = {
  top:    "10mm",
  right:  "12mm",
  bottom: "10mm",
  left:   "12mm",
};

/**
 * Renders an HTML string to a PDF buffer using Puppeteer.
 *
 * @throws Error with a descriptive message if Chromium is unavailable.
 */
export async function generateRidePdf(
  html:  string,
  opts:  PdfOptions = {},
): Promise<Buffer> {
  const execPath = process.env.CHROME_EXECUTABLE_PATH;

  if (execPath) {
    // Serverless / production path: puppeteer-core + custom Chromium
    const { default: puppeteerCore } = await import("puppeteer-core");
    return _render(puppeteerCore, html, opts, execPath);
  }

  // Local / self-hosted path: full puppeteer with bundled Chromium
  try {
    const { default: puppeteer } = await import("puppeteer");
    return _render(puppeteer as any, html, opts, undefined);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `PDF generation failed: Chromium not available. ` +
      `Set CHROME_EXECUTABLE_PATH or install the full 'puppeteer' package. ` +
      `Original error: ${msg}`,
    );
  }
}

async function _render(
  puppeteer: any,
  html:      string,
  opts:      PdfOptions,
  execPath:  string | undefined,
): Promise<Buffer> {
  const launchArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
  ];

  const browser = await puppeteer.launch({
    executablePath: execPath,
    headless:       true,
    args:           launchArgs,
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 15_000 });
    const pdf = await page.pdf({
      format:          opts.format ?? "A4",
      printBackground: true,
      margin:          opts.margins ?? DEFAULT_MARGINS,
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
