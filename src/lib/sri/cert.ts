/**
 * Ecuador SRI — digital certificate loading.
 *
 * Reads the tenant's .p12 certificate from environment variables:
 *   SRI_CERT_P12_BASE64 — base64-encoded PKCS#12 file
 *   SRI_CERT_PASSWORD   — password for the .p12 file
 *
 * The actual .p12 bytes NEVER touch the database.
 * Returns all cryptographic material needed by the XAdES-BES signer.
 */

import * as forge from "node-forge";
import { createHash } from "crypto";

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
// using short attribute names. No RFC2253 reversal.

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
  if (hex.length % 2 !== 0) hex = "0" + hex;  // ensure even length
  // Add leading 0x00 if high bit is set (prevents sign ambiguity in DER)
  if (parseInt(hex.slice(0, 2), 16) >= 0x80) hex = "00" + hex;
  const bytes = Buffer.from(hex, "hex");
  return bytes.toString("base64");
}

// ── Main: load certificate ─────────────────────────────────────────────────

/**
 * Loads the SRI signing certificate from environment variables.
 * Call this in a server action before signing — do NOT cache the result
 * across requests unless you re-validate the cert is still within expiry.
 */
export function loadCertificate(): LoadCertResult {
  const b64      = process.env.SRI_CERT_P12_BASE64;
  const password = process.env.SRI_CERT_PASSWORD ?? "";

  if (!b64) {
    return { ok: false, error: "SRI_CERT_P12_BASE64 no está configurada en las variables de entorno." };
  }

  try {
    // Convert base64 → DER bytes → node-forge buffer
    const p12Buffer = Buffer.from(b64, "base64");
    const p12Asn1   = forge.asn1.fromDer(p12Buffer.toString("binary"));
    const p12       = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);

    // ── Extract certificate ────────────────────────────────────────────────
    const certBagOid = forge.pki.oids.certBag as string;
    const certBags = p12.getBags({ bagType: certBagOid });
    const certBag  = certBags[certBagOid];
    const cert     = certBag?.[0]?.cert;
    if (!cert) return { ok: false, error: "No se encontró certificado en el archivo .p12." };

    // ── Extract private key ────────────────────────────────────────────────
    const keyBagOid  = forge.pki.oids.pkcs8ShroudedKeyBag as string;
    const keyBags    = p12.getBags({ bagType: keyBagOid });
    const keyBag     = keyBags[keyBagOid];
    let privateKey   = keyBag?.[0]?.key;

    // Fallback: try keyBag type (for older .p12 formats)
    if (!privateKey) {
      const kbOid2 = forge.pki.oids.keyBag as string;
      const kb2    = p12.getBags({ bagType: kbOid2 });
      privateKey   = kb2[kbOid2]?.[0]?.key ?? undefined;
    }
    if (!privateKey) return { ok: false, error: "No se encontró llave privada en el archivo .p12." };

    // ── DER bytes of certificate (for embedding in XML) ───────────────────
    const certAsn1  = forge.pki.certificateToAsn1(cert);
    const certDerBin = forge.asn1.toDer(certAsn1).getBytes();
    const certDerBuf = Buffer.from(certDerBin, "binary");

    const certDerBase64 = certDerBuf.toString("base64");

    // SHA-1 of DER cert bytes — for xades:CertDigest
    const certDigestSha1 = createHash("sha1").update(certDerBuf).digest("base64");

    // ── Private key PEM (PKCS#1 RSA) for Node.js crypto ──────────────────
    const privateKeyPem = forge.pki.privateKeyToPem(privateKey as forge.pki.rsa.PrivateKey);

    // ── Distinguished names ───────────────────────────────────────────────
    const issuerName = formatDN(cert.issuer);
    const subjectCN  = cert.subject.getField("CN")?.value ?? cert.subject.getField("O")?.value ?? "SRI Cert";

    // ── Serial number: hex → decimal BigInt string ────────────────────────
    const serialHex    = cert.serialNumber;
    const serialNumber = BigInt("0x" + (serialHex.length % 2 ? "0" + serialHex : serialHex)).toString(10);

    // ── RSA public key components ─────────────────────────────────────────
    const rsaPublic = cert.publicKey as forge.pki.rsa.PublicKey;
    const rsaModulus  = bigIntToBase64(rsaPublic.n);
    const rsaExponent = bigIntToBase64(rsaPublic.e);

    return {
      ok:   true,
      cert: {
        privateKeyPem,
        certDerBase64,
        certDigestSha1,
        issuerName,
        serialNumber,
        rsaModulus,
        rsaExponent,
        subjectCN,
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
