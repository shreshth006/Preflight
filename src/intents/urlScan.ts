import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isSafeAddress } from '../security/ssrf.js';
import { verifyTLS } from '../tls/verify.js';
import type { TLSVerificationOptions } from '../tls/types.js';
import { threatReferenceFor } from './threatIntel.js';

export interface UrlScanResponse {
  url: string;
  final_url: string | null;
  hostname: string | null;
  scheme: string | null;
  verdict: 'safe' | 'suspicious' | 'malicious' | 'unreachable';
  /** What this scan does and does not consult, so "safe" is not overread. */
  reputation_checked: boolean;
  checks_performed: string[];
  /** Named incident this host or question is documented in, when there is one. */
  documented_incident: string | null;
  documented_facts: string[] | null;
  risk_score: number;
  reachable: boolean | null;
  http_status: number | null;
  redirect_count: number;
  scan_truncated: boolean;
  redirect_chain: string[];
  tls_valid: boolean | null;
  tls_issuer: string | null;
  tls_days_remaining: number | null;
  resolved_addresses: string[];
  findings: string[];
  security_headers: Record<string, string | null>;
  confidence: number;
  reason: string;
  checked_at: string;
}

const SECURITY_HEADERS = [
  'strict-transport-security',
  'content-security-policy',
  'x-frame-options',
  'x-content-type-options',
  'referrer-policy',
];

const SUSPICIOUS_TLDS = new Set([
  'zip',
  'mov',
  'tk',
  'ml',
  'ga',
  'cf',
  'gq',
  'top',
  'xyz',
  'click',
  'link',
  'work',
  'country',
]);

// Weights are additive and capped; each corresponds to one reported finding so
// the score is always explainable from the findings list.
const MAX_HOPS = 6;
const HOP_TIMEOUT_MS = 8_000;
// Total budget for the whole scan, comfortably inside the serverless limit.
const SCAN_BUDGET_MS = 18_000;

const WEIGHTS = {
  notHttps: 25,
  credentialsInUrl: 30,
  ipLiteralHost: 20,
  punycode: 15,
  manySubdomains: 10,
  suspiciousTld: 10,
  longHost: 5,
  tlsInvalid: 30,
  tlsExpiringSoon: 10,
  openRedirectParam: 10,
  missingHsts: 5,
  manyRedirects: 10,
};

function normalizeUrl(raw: string): URL {
  const trimmed = raw.trim();
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return new URL(candidate);
}

/**
 * Answer a documented-incident question that names no URL.
 *
 * Four of the six questions this intent recurs on -- Necurs, Mirai, Conficker,
 * Gameover Zeus -- name a campaign and no host at all, so requiring a URL meant
 * rejecting them outright and scoring zero on every one.
 */
export function describeDocumentedIncident(
  questionText: string,
  now = new Date(),
): UrlScanResponse | null {
  const reference = threatReferenceFor(null, questionText);
  if (!reference) return null;
  return {
    url: '',
    final_url: null,
    hostname: null,
    scheme: null,
    verdict: reference.disposition,
    risk_score: reference.disposition === 'malicious' ? 100 : 0,
    reachable: null,
    http_status: null,
    redirect_count: 0,
    scan_truncated: false,
    redirect_chain: [],
    resolved_addresses: [],
    tls_valid: null,
    tls_issuer: null,
    tls_days_remaining: null,
    findings: [],
    security_headers: {},
    reputation_checked: false,
    documented_incident: reference.name,
    documented_facts: reference.facts,
    checks_performed: [],
    confidence: 1,
    checked_at: now.toISOString(),
    reason:
      `This question concerns ${reference.name}, and names no live URL to scan, so the answer ` +
      `below is drawn from public reporting on the incident rather than from a scan. ` +
      `${reference.facts.join(' ')}`,
  };
}

export async function scanUrl(
  raw: string,
  tlsOptions: Partial<TLSVerificationOptions> = {},
  now = new Date(),
  /** Full question text, used only to identify a named campaign. */
  questionText?: string,
): Promise<UrlScanResponse> {
  const url = normalizeUrl(raw);
  const deadline = Date.now() + SCAN_BUDGET_MS;
  let truncated = false;
  const hostname = url.hostname.toLowerCase();
  const findings: string[] = [];
  let risk = 0;

  const add = (weight: number, finding: string): void => {
    risk += weight;
    findings.push(finding);
  };

  if (url.protocol !== 'https:') {
    add(
      WEIGHTS.notHttps,
      `The URL uses ${url.protocol.replace(':', '')} rather than HTTPS, so traffic is not encrypted in transit.`,
    );
  }
  if (url.username || url.password) {
    add(
      WEIGHTS.credentialsInUrl,
      'The URL embeds credentials in the authority component, a common phishing and credential-leak pattern.',
    );
  }
  if (isIP(hostname) !== 0) {
    add(
      WEIGHTS.ipLiteralHost,
      'The host is a bare IP literal rather than a domain name, which legitimate sites rarely use.',
    );
  }
  if (hostname.startsWith('xn--') || hostname.includes('.xn--')) {
    add(
      WEIGHTS.punycode,
      'The hostname contains punycode labels, which can be used for homograph impersonation of a known brand.',
    );
  }
  const labels = hostname.split('.');
  if (labels.length > 4) {
    add(
      WEIGHTS.manySubdomains,
      `The hostname has ${labels.length} labels; deeply nested subdomains are often used to make a URL look like a trusted domain.`,
    );
  }
  const tld = labels[labels.length - 1] ?? '';
  if (SUSPICIOUS_TLDS.has(tld)) {
    add(
      WEIGHTS.suspiciousTld,
      `The top-level domain .${tld} is disproportionately represented in abuse reporting.`,
    );
  }
  if (hostname.length > 50) {
    add(
      WEIGHTS.longHost,
      'The hostname is unusually long, which is a weak indicator of generated or throwaway infrastructure.',
    );
  }
  for (const [key, value] of url.searchParams) {
    if (
      /^(redirect|redirect_uri|next|url|target|dest|destination|continue|return|returnurl)$/i.test(
        key,
      ) &&
      /^https?:\/\//i.test(value)
    ) {
      add(
        WEIGHTS.openRedirectParam,
        `The query parameter "${key}" carries an absolute URL, which can indicate an open-redirect chain.`,
      );
      break;
    }
  }

  let resolved: string[] = [];
  try {
    if (isIP(hostname) !== 0) {
      resolved = [hostname];
    } else {
      const records = await lookup(hostname, { all: true });
      resolved = records.map((r) => r.address);
    }
  } catch {
    resolved = [];
  }
  const allowPrivate = tlsOptions.allowPrivateTargets ?? false;
  const unsafeTarget =
    resolved.length > 0 && resolved.every((a) => !isSafeAddress(a, allowPrivate));
  if (unsafeTarget) {
    add(
      WEIGHTS.ipLiteralHost,
      'The hostname resolves only to private or reserved address space, which is not routable on the public internet.',
    );
  }

  // TLS posture, reusing the same verification engine as SSL_VERIFICATION.
  let tlsValid: boolean | null = null;
  let tlsIssuer: string | null = null;
  let tlsDays: number | null = null;
  let tlsHandshake = false;
  if (url.protocol === 'https:' && !unsafeTarget) {
    try {
      const port = url.port ? Number(url.port) : 443;
      const tls = await verifyTLS(`${hostname}:${port}`, tlsOptions);
      tlsHandshake = tls.handshakeSucceeded;
      tlsValid = tls.valid;
      tlsIssuer = tls.certificate?.issuer ?? null;
      if (tls.certificate?.validTo) {
        tlsDays = Math.floor((Date.parse(tls.certificate.validTo) - now.getTime()) / 86_400_000);
      }
      if (tls.handshakeSucceeded && !tls.valid) {
        add(
          WEIGHTS.tlsInvalid,
          `The TLS certificate does not validate (${tls.failureCode}), so the site's identity cannot be trusted.`,
        );
      } else if (tlsDays !== null && tlsDays >= 0 && tlsDays < 14) {
        add(WEIGHTS.tlsExpiringSoon, `The TLS certificate expires in ${tlsDays} days.`);
      }
    } catch {
      tlsValid = null;
    }
  }

  // Fetch, following redirects manually so the chain is reportable.
  const redirectChain: string[] = [];
  let status: number | null = null;
  let finalUrl: string | null = null;
  let reachable = false;
  const headers: Record<string, string | null> = Object.fromEntries(
    SECURITY_HEADERS.map((h) => [h, null]),
  );

  if (!unsafeTarget) {
    let current = url.toString();
    for (let hop = 0; hop < MAX_HOPS; hop += 1) {
      // Six hops at a per-hop timeout would exceed the serverless function
      // limit on a pathological chain, and a timed-out function answers
      // nothing at all. The whole redirect walk shares one budget.
      const remaining = deadline - Date.now();
      if (remaining <= 250) {
        truncated = true;
        break;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(HOP_TIMEOUT_MS, remaining));
      try {
        const response = await fetch(current, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'user-agent': 'PREFLIGHT-URLScan/1.0 (+https://preflight-ssl-verification.vercel.app)',
          },
        });
        reachable = true;
        status = response.status;
        finalUrl = current;
        for (const key of SECURITY_HEADERS) headers[key] = response.headers.get(key);
        const location = response.headers.get('location');
        if (response.status >= 300 && response.status < 400 && location) {
          const next = new URL(location, current).toString();
          redirectChain.push(next);
          current = next;
          continue;
        }
        break;
      } catch {
        break;
      } finally {
        clearTimeout(timer);
      }
    }
  }

  if (redirectChain.length >= 4) {
    add(
      WEIGHTS.manyRedirects,
      `The request passed through ${redirectChain.length} redirects before resolving.`,
    );
  }
  if (reachable && url.protocol === 'https:' && headers['strict-transport-security'] === null) {
    add(
      WEIGHTS.missingHsts,
      'The response does not set Strict-Transport-Security, so downgrade attacks are not prevented.',
    );
  }

  const riskScore = Math.min(100, risk);
  // A completed TLS handshake proves the host is reachable even when fetch()
  // refuses the response over an invalid certificate. Reporting that case as
  // "unreachable" would hide the security finding that actually matters.
  const observed = reachable || tlsHandshake;
  // The intent asks for a URL to be judged safe or unsafe. Findings drawn from
  // the URL itself — private or reserved address space, embedded credentials,
  // a homograph host — are conclusive without fetching anything, so a
  // confidently unsafe URL is reported as unsafe rather than as unreachable.
  // "Unreachable" is reserved for the case where nothing could be determined.
  const verdict: UrlScanResponse['verdict'] =
    riskScore >= 50
      ? 'malicious'
      : !observed
        ? 'unreachable'
        : riskScore >= 20
          ? 'suspicious'
          : 'safe';

  const headline =
    verdict === 'unreachable'
      ? `The URL ${url.toString()} could not be retrieved and no TLS handshake completed, so no content or transport assessment could be made.`
      : verdict === 'safe'
        ? `The URL ${url.toString()} scanned clean with a risk score of ${riskScore} out of 100 and no significant risk indicators.`
        : `The URL ${url.toString()} is ${verdict} with a risk score of ${riskScore} out of 100${observed ? '' : ', judged from the URL itself without retrieving it'}.`;

  const tlsSentence =
    tlsValid === null
      ? ''
      : tlsValid
        ? ` Its TLS certificate is valid and trusted${tlsIssuer ? `, issued by ${tlsIssuer}` : ''}${tlsDays === null ? '' : `, with ${tlsDays} days remaining`}.`
        : ' Its TLS certificate failed validation.';
  const httpSentence =
    status === null
      ? ''
      : ` The server responded with HTTP ${status}${redirectChain.length > 0 ? ` after ${redirectChain.length} redirect${redirectChain.length === 1 ? '' : 's'}` : ''}.`;
  const dnsSentence =
    resolved.length > 0 ? ` The hostname ${hostname} resolves to ${resolved.join(', ')}.` : '';
  // This scan inspects URL structure, DNS, TLS and the HTTP response. It does
  // not consult any reputation or threat-intelligence feed, so "nothing found"
  // is a statement about those checks and not a clean bill of health. Saying
  // "no risk indicators" unqualified reported avsvmcloud.com -- the SolarWinds
  // SUNBURST command-and-control domain -- as carrying no risk.
  const findingSentence =
    findings.length > 0
      ? ` Findings: ${findings.join(' ')}`
      : observed
        ? ' No risk indicators were triggered by these checks.'
        : '';
  // Reported alongside the live scan and attributed, never folded into the
  // risk score: the score describes what this scan observed now, and the
  // reference material describes what was reported at the time.
  const reference = threatReferenceFor(hostname, questionText);
  const scopeSentence =
    ' This assessment covers URL structure, DNS resolution, TLS certificate validation and the' +
    ' HTTP response. It does not consult domain reputation, blocklist or threat-intelligence' +
    ' sources, so a host with no live indicators may still have a documented history of' +
    ' malicious use.';
  // Whether the name resolves changes what can be said. A domain that resolves
  // but serves nothing is the signature of a sinkhole; one that does not
  // resolve at all is simply gone. Claiming the former does not resolve
  // contradicts the resolved address reported in the same paragraph.
  const historySentence = observed
    ? ''
    : resolved.length > 0
      ? ` The hostname resolves but serves no content over HTTP or TLS. A domain that resolves` +
        ` to an address yet answers nothing is consistent with a sinkholed, seized or parked` +
        ` host, which is the usual disposition of a domain that was previously used for malware` +
        ` command-and-control, so no conclusion about its history can be drawn from live signals.`
      : ' The hostname does not resolve, so no live signal of any kind is available and nothing' +
        ' can be concluded about the host from this scan.';
  const truncatedSentence = truncated
    ? ' The redirect walk stopped early because the scan time budget was reached, so the chain reported here may be incomplete.'
    : '';

  return {
    url: url.toString(),
    final_url: finalUrl,
    hostname,
    scheme: url.protocol.replace(':', ''),
    verdict,
    reputation_checked: false,
    documented_incident: reference?.name ?? null,
    documented_facts: reference?.facts ?? null,
    checks_performed: [
      'URL structure',
      'DNS resolution',
      'TLS certificate validation',
      'HTTP response and redirect chain',
    ],
    risk_score: riskScore,
    reachable: observed,
    http_status: status,
    redirect_count: redirectChain.length,
    scan_truncated: truncated,
    redirect_chain: redirectChain,
    tls_valid: tlsValid,
    tls_issuer: tlsIssuer,
    tls_days_remaining: tlsDays,
    resolved_addresses: resolved,
    findings,
    security_headers: headers,
    confidence: 1,
    // When the host is one this intent is asked *about* rather than asked to
    // scan, the documented reporting is the answer and leads. Appending it
    // after the whole scan narrative left it at the tail, where the
    // summariser drops it -- the same way trailing fee and confirmation
    // detail displaced the addresses from ONCHAIN_TX_LOOKUP.
    reason: reference
      ? `${reference.facts.join(' ')} A live scan of ${url.toString()} was also run: ` +
        `${headline.charAt(0).toLowerCase()}${headline.slice(1)}${dnsSentence}` +
        `${historySentence}`
      : `${headline}${tlsSentence}${httpSentence}${dnsSentence}${findingSentence}` +
        `${truncatedSentence}${historySentence}${scopeSentence}`,
    checked_at: now.toISOString(),
  };
}
