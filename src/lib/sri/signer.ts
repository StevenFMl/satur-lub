/**
 * Ecuador SRI — XAdES-BES digital signature.
 *
 * Implements the exact XAdES-BES structure required by the SRI Ecuador
 * (Ficha Técnica Comprobantes Electrónicos v2.1.0).
 *
 * Algorithm summary:
 *   Signature method:       RSA-SHA1   (SHA-1 is required by SRI — not SHA-256)
 *   Canonicalization:       http://www.w3.org/TR/2001/REC-xml-c14n-20010315
 *   XAdES namespace:        http://uri.etsi.org/01903/v1.3.2#
 *
 * Because we generate ALL intermediate XML fragments ourselves (controlled
 * output), we can pre-construct them in canonical form — no external C14N
 * library is needed. Canonical form rules applied here:
 *   - No XML declaration
 *   - No self-closing tags (all elements have explicit open + close)
 *   - Namespace declarations included on every fragment used for digest
 *   - Attributes in document order (we control this)
 *   - UTF-8 encoding throughout
 *
 * Namespace scope for digest computations:
 *   When computing the digest of a sub-element (e.g. xades:SignedProperties),
 *   C14N includes namespace declarations from ANCESTOR elements. Since the
 *   sub-element will eventually be inside a ds:Signature (which declares
 *   xmlns:ds) and an xades:QualifyingProperties (which declares xmlns:xades),
 *   both namespace declarations must appear on the sub-element fragment when
 *   computing its isolated digest.
 */

import { createHash, createSign } from "crypto";
import type { CertInfo } from "./cert";

// ── Constants ──────────────────────────────────────────────────────────────

const NS_DS    = "http://www.w3.org/2000/09/xmldsig#";
const NS_XADES = "http://uri.etsi.org/01903/v1.3.2#";
const ALG_C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const ALG_SHA1 = `${NS_DS}sha1`;
const ALG_RSA_SHA1 = `${NS_DS}rsa-sha1`;
const ALG_ENV_SIG  = `${NS_DS}enveloped-signature`;
const TYPE_SP = "http://uri.etsi.org/01903#SignedProperties";

// ── Crypto helpers ─────────────────────────────────────────────────────────

function sha1Base64(data: string): string {
  return createHash("sha1").update(data, "utf8").digest("base64");
}

function rsaSha1Sign(data: string, privateKeyPem: string): string {
  // createSign("SHA1") + RSA private key = RSA-SHA1 signature
  return createSign("SHA1").update(data, "utf8").sign(privateKeyPem, "base64");
}

// ── C14N for the invoice XML ───────────────────────────────────────────────
// Strips the XML declaration; the rest of the document is already in the form
// we need since invoiceToXml() generates clean, controlled XML.

function c14nDocument(xml: string): string {
  // Remove <?xml...?> declaration (and optional trailing newline)
  return xml.replace(/^<\?xml[^?]*\?>\r?\n?/, "");
}

// ── Signing time in SRI format ─────────────────────────────────────────────
// ISO 8601 with Ecuador timezone offset (-05:00)

function sriSigningTime(): string {
  const now = new Date();
  // Ecuador is UTC-5 year-round (no DST)
  const offset = -5 * 60;
  const localMs = now.getTime() + offset * 60 * 1000;
  const d = new Date(localMs);

  const pad = (n: number, w = 2) => String(n).padStart(w, "0");

  return (
    `${d.getUTCFullYear()}-` +
    `${pad(d.getUTCMonth() + 1)}-` +
    `${pad(d.getUTCDate())}T` +
    `${pad(d.getUTCHours())}:` +
    `${pad(d.getUTCMinutes())}:` +
    `${pad(d.getUTCSeconds())}-05:00`
  );
}

// ── XML fragment builders ──────────────────────────────────────────────────
// All fragments are pre-canonical:
//   - No self-closing tags
//   - Namespace declarations on every root element used for digest
//   - Compact (no extra whitespace) — consistent with C14N

function buildSignedProperties(cert: CertInfo, signingTime: string): string {
  // Namespace declarations: both ds: and xades: are needed because this
  // fragment will be canonicalized as if extracted from inside ds:Signature.
  return (
    `<xades:SignedProperties` +
    ` xmlns:ds="${NS_DS}"` +
    ` xmlns:xades="${NS_XADES}"` +
    ` Id="SignedProperties">` +
    `<xades:SignedSignatureProperties>` +
    `<xades:SigningTime>${signingTime}</xades:SigningTime>` +
    `<xades:SigningCertificate>` +
    `<xades:Cert>` +
    `<xades:CertDigest>` +
    `<ds:DigestMethod Algorithm="${ALG_SHA1}"></ds:DigestMethod>` +
    `<ds:DigestValue>${cert.certDigestSha1}</ds:DigestValue>` +
    `</xades:CertDigest>` +
    `<xades:IssuerSerial>` +
    `<ds:X509IssuerName>${cert.issuerName}</ds:X509IssuerName>` +
    `<ds:X509SerialNumber>${cert.serialNumber}</ds:X509SerialNumber>` +
    `</xades:IssuerSerial>` +
    `</xades:Cert>` +
    `</xades:SigningCertificate>` +
    `</xades:SignedSignatureProperties>` +
    `</xades:SignedProperties>`
  );
}

function buildKeyInfo(cert: CertInfo): string {
  // Namespace: ds: is in scope from parent ds:Signature
  return (
    `<ds:KeyInfo xmlns:ds="${NS_DS}" Id="Certificate">` +
    `<ds:X509Data>` +
    `<ds:X509Certificate>${cert.certDerBase64}</ds:X509Certificate>` +
    `</ds:X509Data>` +
    `<ds:KeyValue>` +
    `<ds:RSAKeyValue>` +
    `<ds:Modulus>${cert.rsaModulus}</ds:Modulus>` +
    `<ds:Exponent>${cert.rsaExponent}</ds:Exponent>` +
    `</ds:RSAKeyValue>` +
    `</ds:KeyValue>` +
    `</ds:KeyInfo>`
  );
}

function buildSignedInfo(
  spDigest:  string,
  kiDigest:  string,
  docDigest: string
): string {
  return (
    `<ds:SignedInfo xmlns:ds="${NS_DS}" Id="SignedInfoId">` +
    `<ds:CanonicalizationMethod Algorithm="${ALG_C14N}"></ds:CanonicalizationMethod>` +
    `<ds:SignatureMethod Algorithm="${ALG_RSA_SHA1}"></ds:SignatureMethod>` +
    // Reference 1: XAdES SignedProperties
    `<ds:Reference Id="SignedPropertiesId" Type="${TYPE_SP}" URI="#SignedProperties">` +
    `<ds:DigestMethod Algorithm="${ALG_SHA1}"></ds:DigestMethod>` +
    `<ds:DigestValue>${spDigest}</ds:DigestValue>` +
    `</ds:Reference>` +
    // Reference 2: KeyInfo
    `<ds:Reference Id="KeyInfoId" URI="#Certificate">` +
    `<ds:DigestMethod Algorithm="${ALG_SHA1}"></ds:DigestMethod>` +
    `<ds:DigestValue>${kiDigest}</ds:DigestValue>` +
    `</ds:Reference>` +
    // Reference 3: Document (enveloped-signature transform)
    `<ds:Reference Id="DocumentId" URI="">` +
    `<ds:Transforms>` +
    `<ds:Transform Algorithm="${ALG_ENV_SIG}"></ds:Transform>` +
    `</ds:Transforms>` +
    `<ds:DigestMethod Algorithm="${ALG_SHA1}"></ds:DigestMethod>` +
    `<ds:DigestValue>${docDigest}</ds:DigestValue>` +
    `</ds:Reference>` +
    `</ds:SignedInfo>`
  );
}

function buildSignatureElement(
  signedInfo:    string,
  sigValue:      string,
  keyInfo:       string,
  signedProps:   string
): string {
  return (
    `<ds:Signature xmlns:ds="${NS_DS}" Id="Signature">` +
    signedInfo +
    `<ds:SignatureValue Id="SignatureValueId">${sigValue}</ds:SignatureValue>` +
    keyInfo +
    `<ds:Object Id="SignatureObjectId">` +
    `<xades:QualifyingProperties xmlns:xades="${NS_XADES}" Target="#Signature">` +
    signedProps +
    `</xades:QualifyingProperties>` +
    `</ds:Object>` +
    `</ds:Signature>`
  );
}

// ── Main: sign XML ─────────────────────────────────────────────────────────

export type SignResult =
  | { ok: true;  signedXml: string; signingTime: string }
  | { ok: false; error: string };

/**
 * Signs the unsigned invoice XML with XAdES-BES using the provided certificate.
 *
 * Steps:
 *  1. Compute document digest: SHA-1(C14N(unsignedXml))
 *  2. Build SignedProperties → compute its digest
 *  3. Build KeyInfo → compute its digest
 *  4. Build SignedInfo with all three digests
 *  5. Sign SignedInfo with RSA-SHA1
 *  6. Assemble the ds:Signature element
 *  7. Append to the unsigned XML just before the closing root tag
 */
export function signXml(unsignedXml: string, cert: CertInfo): SignResult {
  try {
    const signingTime = sriSigningTime();

    // ── 1. Document digest ────────────────────────────────────────────────
    const docC14n   = c14nDocument(unsignedXml);
    const docDigest = sha1Base64(docC14n);

    // ── 2. SignedProperties digest ────────────────────────────────────────
    const signedProps = buildSignedProperties(cert, signingTime);
    const spDigest    = sha1Base64(signedProps);

    // ── 3. KeyInfo digest ─────────────────────────────────────────────────
    const keyInfo  = buildKeyInfo(cert);
    const kiDigest = sha1Base64(keyInfo);

    // ── 4. SignedInfo ─────────────────────────────────────────────────────
    const signedInfo = buildSignedInfo(spDigest, kiDigest, docDigest);

    // ── 5. RSA-SHA1 signature of SignedInfo ───────────────────────────────
    const sigValue = rsaSha1Sign(signedInfo, cert.privateKeyPem);

    // ── 6. Assemble ds:Signature ──────────────────────────────────────────
    const signatureElement = buildSignatureElement(
      signedInfo,
      sigValue,
      keyInfo,
      signedProps
    );

    // ── 7. Append to document before closing root tag ─────────────────────
    // The invoice root tag is <factura ...>...</factura>
    const closingTag = "</factura>";
    if (!unsignedXml.includes(closingTag)) {
      return { ok: false, error: "XML de factura no tiene tag de cierre </factura>." };
    }

    const signedXml = unsignedXml.replace(
      closingTag,
      signatureElement + closingTag
    );

    return { ok: true, signedXml, signingTime };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Error en firma XAdES-BES: ${msg}` };
  }
}
