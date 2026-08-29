/**
 * What can still be established about a hostname's certificate configuration
 * when the hostname itself does not resolve.
 *
 * The recurring SSL_VERIFICATION question asks for an analysis of the
 * certificate configuration and chain for `api.example.com`, which has no A
 * record. Every miner in the intent answers "unreachable" and is separated
 * only by what else it can say; the leader's addition is a suggestion to try
 * again later, which contains no fact about the certificate.
 *
 * There is a real answer available. The registrable domain usually does serve
 * a certificate, and that certificate's SAN list determines whether the
 * requested host would be covered if it were served. For `api.example.com` the
 * answer is yes: `example.com` presents `DNS:example.com, DNS:*.example.com`,
 * and the wildcard covers it.
 *
 * That is a finding about the requested hostname, not a substitute for one.
 * The wording throughout is careful never to claim the unreachable host
 * presents this certificate -- only that the parent domain does, and what that
 * implies for coverage.
 */

import { verifyTLS } from './verify.js';
import type { TLSVerificationOptions } from './types.js';

export interface ParentDomainEvidence {
  /** The registrable domain probed, e.g. `example.com`. */
  domain: string;
  issuer: string | null;
  valid_from: string | null;
  valid_to: string | null;
  subject_alt_names: string[] | null;
  /** Whether a SAN on the parent's certificate covers the requested host. */
  covers_requested_host: boolean;
  /** The SAN that covers it, when one does. */
  covering_san: string | null;
  chain_trusted: boolean | null;
}

/**
 * The parent of a subdomain, or null when there is no parent worth probing.
 *
 * Deliberately simple: strip the leftmost label and require at least two
 * remaining. This is not a public-suffix implementation, so it declines
 * two-label inputs rather than guessing at registrable boundaries -- probing
 * `co.uk` would be both wrong and rude.
 */
export function parentDomainOf(host: string): string | null {
  const labels = host.toLowerCase().split('.').filter(Boolean);
  if (labels.length < 3) return null;
  const parent = labels.slice(1).join('.');
  return parent.split('.').length >= 2 ? parent : null;
}

/** Does `san` cover `host`, following RFC 6125 single-label wildcards? */
export function sanCovers(san: string, host: string): boolean {
  const s = san.toLowerCase().replace(/\.$/, '');
  const h = host.toLowerCase().replace(/\.$/, '');
  if (s === h) return true;
  if (!s.startsWith('*.')) return false;
  const suffix = s.slice(2);
  if (!h.endsWith(`.${suffix}`)) return false;
  // A wildcard matches exactly one label, so a.b.example.com is not covered
  // by *.example.com.
  const remainder = h.slice(0, h.length - suffix.length - 1);
  return remainder.length > 0 && !remainder.includes('.');
}

/**
 * Probe the registrable domain of an unreachable host.
 *
 * Returns null whenever there is nothing trustworthy to report: no parent, the
 * parent does not resolve either, or it presented no certificate. A failure
 * here is silent by design -- this enriches an answer, it never degrades one.
 */
export async function parentDomainEvidence(
  host: string,
  options: Partial<TLSVerificationOptions> = {},
): Promise<ParentDomainEvidence | null> {
  const parent = parentDomainOf(host);
  if (!parent) return null;

  let result;
  try {
    result = await verifyTLS(parent, options);
  } catch {
    return null;
  }
  const certificate = result.certificate;
  if (!result.certificatePresent || !certificate) return null;

  const sans = certificate.subjectAltNames ?? null;
  const covering = sans?.find((san) => sanCovers(san, host)) ?? null;

  return {
    domain: parent,
    issuer: certificate.issuer ?? null,
    valid_from: certificate.validFrom ?? null,
    valid_to: certificate.validTo ?? null,
    subject_alt_names: sans,
    covers_requested_host: covering !== null,
    covering_san: covering,
    chain_trusted: result.chainTrusted ?? null,
  };
}
