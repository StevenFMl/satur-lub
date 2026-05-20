/**
 * Ecuador SRI — digital certificate loading.
 *
 * Resolution order (first that succeeds wins):
 *   1. DB row in `tenant_sri_credentials` for the tenant
 *      → .p12 downloaded from Storage bucket "sri-certificates"
 *      → password decrypted with AES-256-CBC using SRI_CRYPTO_SECRET
 *   2. Environment-variable fallback (backward compat for first client)
 *      → SRI_CERT_P12_BASE64  — base64-encoded PKCS#12 file
 *      → SRI_CERT_PASSWORD    — plaintext password for the .p12 file
 *
 * The actual .p12 bytes and decrypted password are held only in memory
 * for the duration of the signing operation — never written to the DB.
 */

import * as forge from "node-forge";
import { createHash, createDecipheriv } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

// ── Public API types ───────────────────────────────────────────────────────

export type CertInfo = {
  /** RSA private key in PKCS#1 PEM format — for Node.js crypto signing */
  privateKeyPem:    string;
  /** Full certificate DER bytes encoded as base64 — goes into ds:X509Certificate */
  certDerBase64:    string;
  /** SHA-1 of the DER bytes, base64 — goes into xades:CertDigest/ds:DigestValue */
  certDigestSha1:   string;
  /** Issuer distinguished name — goes into xades:IssuerSerial/ds:X509IssuerName */
  issuerName:       string;
  /** Certificate serial number as decimal string — goes into ds:X509SerialNumber */
  serialNumber:     string;
  /** RSA public key modulus, base64 — goes into ds:RSAKeyValue/ds:Modulus */
  rsaModulus:       string;
  /** RSA public key exponent, base64 — goes into ds:RSAKeyValue/ds:Exponent */
  rsaExponent:      string;
  /** Human-readable subject CN for logs */
  subjectCN:        string;
};

export type LoadCertResult =
  | { ok: true;  cert: CertInfo }
  | { ok: false; error: string };

// ── Issuer name formatter ──────────────────────────────────────────────────
// SRI accepts the issuer DN in the same order as the certificate's issuer,
// using short attribute names.  No RFC2253 reversal.

const RDN_NAMES: Record<string, string> = {
  commonName:             "CN",
  organizationalUnitName: "OU",
  organizationName:       "O",
  localityName:           "L",
  stateOrProvinceName:    "ST",
  countryName:            "C",
  emailAddress:           "EMAILADDRESS",
  serialName:             "SERIALNUMBER",
};

function formatDN(issuer: forge.pki.Certificate["issuer"]): string {
  return (issuer.attributes ?? [])
    .map((a: forge.pki.CertificateField) => {
      const rdn = RDN_NAMES[String(a.name ?? "")] ?? String(a.shortName ?? a.name ?? "");
      const val = String(a.value ?? "").replace(/[,+="<>#;\\]/g, "\\$&");
      return `${rdn}=${val}`;
    })
    .join(",");
}

// ── BigInteger → base64 bytes ──────────────────────────────────────────────

function bigIntToBase64(n: forge.jsbn.BigInteger): string {
  let hex = n.toString(16);
  if (hex.length % 2 !== 0) hex = "0" + hex;
  if (parseInt(hex.slice(0, 2), 16) >= 0x80) hex = "00" + hex;
  return Buffer.from(hex, "hex").toString("base64");
}

// ── Core .p12 parser (shared by both loading paths) ───────────────────────

/**
 * Parses raw PKCS#12 bytes + password into a `LoadCertResult`.
 * All certificate and key extraction logic lives here once.
 */
function parseCertificate(p12Buffer: Buffer, password: string): LoadCertResult {
  try {
    const p12Asn1 = forge.asn1.fromDer(p12Buffer.toString("binary"));
    const p12     = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);

    // ── Extract certificate ──────────────────────────────────────────────
    const certBagOid = forge.pki.oids.certBag as string;
    const certBags   = p12.getBags({ bagType: certBagOid });
    const cert       = certBags[certBagOid]?.[0]?.cert;
    if (!cert) return { ok: false, error: "No se encontró certificado en el archivo .p12." };

    // ── Extract private key ──────────────────────────────────────────────
    const keyBagOid = forge.pki.oids.pkcs8ShroudedKeyBag as string;
    const keyBags   = p12.getBags({ bagType: keyBagOid });
    let privateKey  = keyBags[keyBagOid]?.[0]?.key;

    if (!privateKey) {
      const kbOid2 = forge.pki.oids.keyBag as string;
      const kb2    = p12.getBags({ bagType: kbOid2 });
      privateKey   = kb2[kbOid2]?.[0]?.key ?? undefined;
    }
    if (!privateKey) return { ok: false, error: "No se encontró llave privada en el archivo .p12." };

    // ── DER bytes (for embedding in XML) ────────────────────────────────
    const certAsn1   = forge.pki.certificateToAsn1(cert);
    const certDerBin = forge.asn1.toDer(certAsn1).getBytes();
    const certDerBuf = Buffer.from(certDerBin, "binary");

    const certDerBase64  = certDerBuf.toString("base64");
    const certDigestSha1 = createHash("sha1").update(certDerBuf).digest("base64");

    // ── Private key PEM ─────────────────────────────────────────────────
    const privateKeyPem = forge.pki.privateKeyToPem(privateKey as forge.pki.rsa.PrivateKey);

    // ── Distinguished names ─────────────────────────────────────────────
    const issuerName = formatDN(cert.issuer);
    const subjectCN  = cert.subject.getField("CN")?.value
      ?? cert.subject.getField("O")?.value
      ?? "SRI Cert";

    // ── Serial number: hex → decimal ────────────────────────────────────
    const serialHex    = cert.serialNumber;
    const serialNumber = BigInt(
      "0x" + (serialHex.length % 2 ? "0" + serialHex : serialHex)
    ).toString(10);

    // ── RSA public key ──────────────────────────────────────────────────
    const rsaPublic  = cert.publicKey as forge.pki.rsa.PublicKey;
    const rsaModulus  = bigIntToBase64(rsaPublic.n);
    const rsaExponent = bigIntToBase64(rsaPublic.e);

    return {
      ok:   true,
      cert: {
        privateKeyPem, certDerBase64, certDigestSha1,
        issuerName, serialNumber, rsaModulus, rsaExponent, subjectCN,
      },
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.toLowerCase().includes("password") || msg.toLowerCase().includes("mac")) {
      return { ok: false, error: "Contraseña del certificado .p12 incorrecta." };
    }
    return { ok: false, error: `Error al cargar el certificado: ${msg}` };
  }
}

// ── AES-256-CBC decryption ─────────────────────────────────────────────────

/**
 * Decrypts a password stored as "<iv_hex>:<ciphertext_base64>" using
 * AES-256-CBC.  The 32-byte key is derived via SHA-256(secret) so the
 * secret can be any length.
 *
 * Throws on any format or cryptographic error — callers must catch.
 */
function decryptPassword(encrypted: string, secret: string): string {
  const colonIdx = encrypted.indexOf(":");
  if (colonIdx < 1) {
    throw new Error("Formato de contraseña cifrada inválido (se esperaba '<iv_hex>:<ciphertext_base64>').");
  }

  const ivHex           = encrypted.slice(0, colonIdx);
  const ciphertextBase64 = encrypted.slice(colonIdx + 1);

  if (!ivHex || !ciphertextBase64) {
    throw new Error("IV o texto cifrado vacíos en la contraseña almacenada.");
  }

  const key        = createHash("sha256").update(secret, "utf8").digest();
  const iv         = Buffer.from(ivHex, "hex");
  const ciphertext = Buffer.from(ciphertextBase64, "base64");

  if (iv.length !== 16) {
    throw new Error(`IV de longitud inválida: ${iv.length} bytes (se esperaban 16).`);
  }

  const decipher  = createDecipheriv("aes-256-cbc", key, iv);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

// ── DB-backed loader ───────────────────────────────────────────────────────

const SRI_CERT_BUCKET = "sri-certificates";

/**
 * Attempts to load the certificate from `tenant_sri_credentials`.
 *
 * Returns:
 *   - `LoadCertResult`  when a row exists (success or cert-specific error)
 *   - `null`            when no row is found OR the DB/admin client is
 *                       unreachable — signals the caller to fall back to env vars
 */
async function loadCertificateFromDb(tenantId: string): Promise<LoadCertResult | null> {
  try {
    const admin = createAdminClient();

    const { data: cred, error: credErr } = await admin
      .from("tenant_sri_credentials" as never)
      .select("p12_storage_key, password_sri_encrypted")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    // No row → fall through to env var fallback
    if (credErr || !cred) {
      if (credErr) {
        console.warn("[cert] tenant_sri_credentials lookup error (will fall back to env):", credErr.message);
      }
      return null;
    }

    const { p12_storage_key, password_sri_encrypted } =
      cred as { p12_storage_key: string; password_sri_encrypted: string | null };

    if (!password_sri_encrypted) {
      return {
        ok: false,
        error: "El certificado está registrado pero la contraseña no ha sido configurada. Sube el certificado completo desde Ajustes → Facturación.",
      };
    }

    // ── Decrypt password ───────────────────────────────────────────────
    const secret = process.env.SRI_CRYPTO_SECRET;
    if (!secret) {
      return {
        ok: false,
        error: "La variable de entorno SRI_CRYPTO_SECRET no está configurada. No se puede descifrar la contraseña del certificado.",
      };
    }

    let password: string;
    try {
      password = decryptPassword(password_sri_encrypted, secret);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `Error al descifrar la contraseña del certificado: ${msg}` };
    }

    // ── Download .p12 from private Storage ────────────────────────────
    const { data: fileBlob, error: fileErr } = await admin.storage
      .from(SRI_CERT_BUCKET)
      .download(p12_storage_key);

    if (fileErr || !fileBlob) {
      return {
        ok: false,
        error: `Error al descargar el certificado desde Storage (${p12_storage_key}): ${fileErr?.message ?? "archivo no encontrado"}.`,
      };
    }

    // ── Parse the .p12 ────────────────────────────────────────────────
    const p12Buffer = Buffer.from(await fileBlob.arrayBuffer());
    return parseCertificate(p12Buffer, password);

  } catch (e: unknown) {
    // Unexpected failure (admin client init, network, etc.) → fall back silently
    console.error(
      "[cert] loadCertificateFromDb unexpected error (will fall back to env):",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

// ── Env-var fallback loader ────────────────────────────────────────────────

function loadCertificateFromEnv(): LoadCertResult {
  const b64      = process.env.SRI_CERT_P12_BASE64;
  const password = process.env.SRI_CERT_PASSWORD ?? "";

  if (!b64) {
    return {
      ok: false,
      error:
        "No se encontró configuración de certificado para este tenant. " +
        "Configure el certificado en Ajustes → Facturación, o " +
        "defina SRI_CERT_P12_BASE64 en las variables de entorno.",
    };
  }

  return parseCertificate(Buffer.from(b64, "base64"), password);
}

// ── Public entry point ─────────────────────────────────────────────────────

/**
 * Loads the SRI signing certificate for the given tenant.
 *
 * Resolution order:
 *   1. `tenant_sri_credentials` row in DB → Storage download → AES decrypt
 *   2. `SRI_CERT_P12_BASE64` / `SRI_CERT_PASSWORD` env vars (fallback)
 *
 * Call this in a server action or pipeline — never cache the result
 * across requests (cert may be rotated; no session persistence desired).
 */
export async function loadCertificate(tenantId: string): Promise<LoadCertResult> {
  const dbResult = await loadCertificateFromDb(tenantId);

  // null means "no DB record found or DB unreachable" → try env vars
  if (dbResult === null) {
    return loadCertificateFromEnv();
  }

  // A non-null result (ok or error) is authoritative — do NOT fall back
  // to env vars, since the record exists but may be misconfigured
  return dbResult;
}
