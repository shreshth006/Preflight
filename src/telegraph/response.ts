import type { TLSVerificationResult } from '../tls/types.js';

import type { ParentDomainEvidence } from '../tls/parentDomain.js';

export interface LiveCertResponse {
  chain_complete: boolean | null;
  chain_length?: number | null;
  checked_at: string;
  cipher?: string | null;
  confidence: number;
  days_remaining: number | null;
  domain: string;
  expired?: boolean;
  hostname_match?: boolean;
  issuer: string | null;
  key_bits?: number | null;
  reason: string;
  subject?: string | null;
  subject_alt_names?: string[] | null;
  tls_protocol?: string | null;
  trusted?: boolean;
  unreachable_reason?: string;
  /** Which stage of the connection failed: DNS, TCP, or the TLS handshake. */
  failure_stage?: 'dns' | 'tcp' | 'tls_handshake';
  /** Checks that did run before the failure, and those the failure prevented. */
  checks_completed?: string[];
  checks_blocked?: string[];
  recommendation?: string;
  /** Certificate configuration observable at the registrable domain. */
  parent_domain_evidence?: ParentDomainEvidence;
  verdict:
    | 'valid'
    | 'expired'
    | 'not_yet_valid'
    | 'hostname_mismatch'
    | 'self_signed'
    | 'untrusted'
    | 'unreachable';
  valid: boolean;
  valid_from?: string | null;
  valid_to: string | null;
}

function verdictFor(result: TLSVerificationResult): LiveCertResponse['verdict'] {
  if (result.valid) return 'valid';
  if (!result.reachable || !result.handshakeSucceeded) return 'unreachable';
  switch (result.failureCode) {
    case 'EXPIRED':
      return 'expired';
    case 'NOT_YET_VALID':
      return 'not_yet_valid';
    case 'HOSTNAME_MISMATCH':
      return 'hostname_mismatch';
    case 'UNTRUSTED_CHAIN':
      return /DEPTH_ZERO_SELF_SIGNED/i.test(result.failureMessage ?? '') ||
        (result.certificate?.subject !== undefined &&
          result.certificate.subject === result.certificate.issuer)
        ? 'self_signed'
        : 'untrusted';
    default:
      return 'untrusted';
  }
}

function dateOnly(iso: string | undefined): string | null {
  return iso ? iso.slice(0, 10) : null;
}

function daysRemaining(validTo: string | undefined, now: Date): number | null {
  if (!validTo) return null;
  return Math.floor((Date.parse(validTo) - now.getTime()) / 86_400_000);
}

function certificateContext(result: TLSVerificationResult, days: number | null): string {
  const parts: string[] = [];
  const cert = result.certificate;
  if (cert?.subject) parts.push(`The certificate was issued to ${cert.subject}`);
  if (cert?.issuer) parts.push(`by ${cert.issuer}`);
  const from = dateOnly(cert?.validFrom);
  const to = dateOnly(cert?.validTo);
  if (from && to) parts.push(`and is valid from ${from} to ${to}`);
  else if (to) parts.push(`and is valid until ${to}`);
  const window = parts.length > 0 ? `${parts.join(' ')}.` : '';
  const remaining =
    days === null
      ? ''
      : days < 0
        ? ` It expired ${Math.abs(days)} days ago.`
        : ` It has ${days} days remaining.`;
  const chain = cert?.chainComplete
    ? ` The server presented a complete chain of ${cert.chainLength ?? 'multiple'} certificates including intermediates.`
    : cert?.chainLength
      ? ` The server presented ${cert.chainLength} certificate(s) without a complete intermediate chain.`
      : '';
  const names = cert?.subjectAltNames?.length
    ? ` Subject Alternative Names present: ${cert.subjectAltNames.join(', ')}.`
    : '';
  const protocol = result.tlsProtocol ? ` The connection negotiated ${result.tlsProtocol}` : '';
  const cipher = result.cipher ? ` with cipher suite ${result.cipher}` : '';
  const keyBits = result.keyBits ? ` and a ${result.keyBits}-bit key` : '';
  const connection = protocol ? `${protocol}${cipher}${keyBits}.` : '';
  return `${window}${remaining}${chain}${names}${connection}`;
}

function reasonFor(
  result: TLSVerificationResult,
  verdict: LiveCertResponse['verdict'],
  days: number | null,
): string {
  const domain = result.normalizedHost || result.input;
  if (verdict === 'unreachable')
    return `The TLS/SSL endpoint for ${domain} could not be reached and no certificate could be observed (${result.failureCode}). ${result.failureMessage ?? 'No further connection details were available.'} Because the TLS handshake did not complete, certificate validity, chain trust and hostname verification could not be evaluated for ${domain}.`;

  const context = certificateContext(result, days);
  if (verdict === 'expired')
    return `The TLS/SSL certificate for ${domain} is expired and is therefore not valid. ${context} Chain trust and hostname verification cannot compensate for an expired validity period.`;
  if (verdict === 'not_yet_valid')
    return `The TLS/SSL certificate for ${domain} is not yet valid, because its validity period begins in the future. ${context} A client validating ${domain} today will reject this certificate.`;
  if (verdict === 'hostname_mismatch')
    return `The TLS/SSL certificate presented by ${domain} does not match the requested hostname, so hostname verification fails. ${context} The certificate itself may be well-formed, but it is not valid for ${domain}.`;
  if (verdict === 'self_signed')
    return `The TLS/SSL certificate for ${domain} is self-signed and is not trusted, because it does not chain to a trusted certificate authority. ${context} A client validating ${domain} will reject this certificate as untrusted.`;
  if (verdict === 'untrusted')
    return `The TLS/SSL certificate for ${domain} is not trusted, because the presented certificate chain does not build to a trusted root certificate authority. ${context}`;

  const expiry =
    days === null
      ? 'with no readable expiry'
      : `expiring in ${days} days on ${dateOnly(result.certificate?.validTo)}`;
  const issuer = result.certificate?.issuer ? `, issued by ${result.certificate.issuer}` : '';
  const chain = result.certificate?.chainComplete
    ? `The server presented a complete chain of ${result.certificate.chainLength ?? 'multiple'} certificates including intermediates, building a trusted path to a root.`
    : 'The server did not present a complete certificate chain.';
  const names = result.certificate?.subjectAltNames?.length
    ? ` against Subject Alternative Name ${result.certificate.subjectAltNames.join(', ')}`
    : '';
  const protocol = result.tlsProtocol ? ` The connection negotiated ${result.tlsProtocol}` : '';
  const cipher = result.cipher ? ` with cipher suite ${result.cipher}` : '';
  const keyBits = result.keyBits ? ` and a ${result.keyBits}-bit key` : '';
  // Chain, hostname and validity period are all checked; revocation is not.
  // Reporting "valid" without that caveat overclaims — a revoked certificate
  // still presents a well-formed, in-date, trusted chain.
  return `The TLS/SSL certificate for ${domain} is valid and trusted${issuer}, ${expiry}. ${chain} Hostname validation passes${names}.${protocol}${cipher}${keyBits}. This verdict covers chain trust, hostname match and validity period; revocation status via OCSP or CRL was not checked.`;
}

/**
 * What the registrable domain's certificate says about the requested host.
 *
 * Phrased so it can never be read as a claim that the unreachable host
 * presents this certificate. It reports what the parent serves, and what its
 * SAN list implies for coverage of the host that was asked about.
 */
function parentSentence(
  result: TLSVerificationResult,
  parent: ParentDomainEvidence | null | undefined,
): string {
  if (!parent) return '';
  const host = result.normalizedHost || result.input;
  const issued = parent.issuer ? `, issued by ${parent.issuer}` : '';
  const window =
    parent.valid_from && parent.valid_to
      ? `, valid from ${dateOnly(parent.valid_from)} to ${dateOnly(parent.valid_to)}`
      : parent.valid_to
        ? `, valid until ${dateOnly(parent.valid_to)}`
        : '';
  const sans = parent.subject_alt_names?.length
    ? ` Its Subject Alternative Names are ${parent.subject_alt_names.join(', ')}.`
    : '';
  const coverage = parent.covers_requested_host
    ? ` The name ${parent.covering_san} on that certificate covers ${host}, so the hostname is` +
      ` already within the issued certificate's scope and would validate against it if ${host}` +
      ` were served over TLS.`
    : ` No name on that certificate covers ${host}, so serving ${host} over TLS would require a` +
      ` certificate that names it.`;
  const trust = parent.chain_trusted
    ? ` That certificate chains to a trusted root.`
    : parent.chain_trusted === false
      ? ` That certificate does not chain to a trusted root.`
      : '';
  return (
    ` The certificate configuration is not entirely unobservable, however: the registrable domain` +
    ` ${parent.domain} does serve TLS and presents a certificate${issued}${window}.${sans}` +
    `${coverage}${trust}`
  );
}

export function toTelegraphResponse(
  result: TLSVerificationResult,
  now = new Date(),
  /**
   * Certificate configuration observed at the registrable domain, when the
   * requested host itself could not be reached.
   */
  parent?: ParentDomainEvidence | null,
): LiveCertResponse {
  const verdict = verdictFor(result);
  const days = daysRemaining(result.certificate?.validTo, now);
  const response: LiveCertResponse = {
    chain_complete: result.certificate?.chainComplete ?? null,
    checked_at: now.toISOString(),
    confidence: 1,
    days_remaining: days,
    domain: result.normalizedHost || result.input,
    issuer: result.certificate?.issuer ?? null,
    reason: reasonFor(result, verdict, days) + parentSentence(result, parent),
    valid: result.valid,
    valid_to: dateOnly(result.certificate?.validTo),
    verdict,
  };
  if (result.certificatePresent) {
    response.chain_length = result.certificate?.chainLength ?? null;
    response.cipher = result.cipher ?? null;
    response.expired = result.failureCode === 'EXPIRED';
    response.hostname_match = result.hostnameValid === true;
    response.key_bits = result.keyBits ?? result.certificate?.keyBits ?? null;
    response.subject = result.certificate?.subject ?? null;
    response.subject_alt_names = result.certificate?.subjectAltNames ?? null;
    response.tls_protocol = result.tlsProtocol ?? null;
    response.trusted = result.chainTrusted === true;
    response.valid_from = dateOnly(result.certificate?.validFrom);
  }
  if (!result.reachable || !result.handshakeSucceeded) {
    response.unreachable_reason = result.failureMessage ?? result.failureCode;
    // An unreachable host still produces a real finding: which stage failed,
    // and therefore which checks were and were not able to run. Reporting that
    // as structured fields says what a bare "unreachable" cannot.
    const code = result.failureCode ?? '';
    const stage: 'dns' | 'tcp' | 'tls_handshake' =
      code.includes('DNS') || code.includes('ENOTFOUND') || code.includes('EAI')
        ? 'dns'
        : result.reachable
          ? 'tls_handshake'
          : 'tcp';
    response.failure_stage = stage;
    response.checks_completed =
      stage === 'dns'
        ? ['hostname syntax validation']
        : stage === 'tcp'
          ? ['hostname syntax validation', 'DNS resolution']
          : ['hostname syntax validation', 'DNS resolution', 'TCP connection to port 443'];
    response.checks_blocked = [
      'certificate chain trust',
      'hostname and SAN matching',
      'validity period',
      'signature algorithm and key strength',
    ];
    if (parent) response.parent_domain_evidence = parent;
    response.recommendation =
      stage === 'dns'
        ? `Confirm that ${response.domain} resolves in public DNS, then re-run the certificate chain and hostname checks once it does.`
        : stage === 'tcp'
          ? `Confirm that ${response.domain} accepts TCP connections on port 443 and is not blocked by a firewall, then re-run the certificate chain and hostname checks.`
          : `Confirm that ${response.domain} completes a TLS handshake with a supported protocol version and cipher suite, then re-run the certificate chain and hostname checks.`;
  }
  return response;
}
