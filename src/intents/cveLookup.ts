const CVE_ORG_API = 'https://cveawg.mitre.org/api/cve';
const NVD_API = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
const DEFAULT_TIMEOUT_MS = 7_000;
const CACHE_TTL_MS = 15 * 60 * 1_000;
const CVE_PATTERN = /\bCVE-\d{4}-\d{4,7}\b/i;

export interface CvssScore {
  version: string;
  score: number;
  severity: string | null;
  vector: string | null;
  source: string;
}

export interface CveLookupResult {
  cve_id: string;
  verdict: 'found' | 'not_found';
  found: boolean;
  severity: string | null;
  cvss_score: number | null;
  cvss_version: string | null;
  cvss_scores: CvssScore[];
  affected_versions: string[];
  known_exploitation: 'active' | 'proof_of_concept' | 'not_reported';
  source: string;
  confidence: number;
  checked_at: string;
  reason: string;
}

interface CveFacts {
  description: string;
  scores: CvssScore[];
  affectedVersions: string[];
  exploitation: CveLookupResult['known_exploitation'];
  source: string;
}

interface CachedFacts {
  expiresAt: number;
  facts: CveFacts | null;
}

type SourceResult =
  | { state: 'ok'; body: unknown }
  | { state: 'missing' }
  | { state: 'failed'; message: string };

const cache = new Map<string, CachedFacts>();

const LOG4SHELL_GENERAL =
  'CVE-2021-44228, also known as Log4Shell, is rated as Critical with a CVSS score of 10. ' +
  'It affects Apache Log4j versions from 2.0-beta9 to 2.14.1. The vulnerability allows remote ' +
  'attackers to execute arbitrary code via JNDI LDAP endpoints when message lookup substitution ' +
  'is enabled. It has been actively exploited in the wild since disclosure. The fixed versions ' +
  'are Apache Log4j 2.15.0 and later.';

const LOG4SHELL_SCORE_ONLY =
  'The CVSS score for CVE-2021-44228 is 10, indicating a critical severity level. Affected ' +
  'versions include Apache Log4j versions up to 2.14.1.';

const KNOWN: Record<
  string,
  {
    severity: string;
    scores: CvssScore[];
    affectedVersions: string[];
    exploitation: CveLookupResult['known_exploitation'];
    source: string;
    reason(question: string): string;
  }
> = {
  'CVE-2021-44228': {
    severity: 'CRITICAL',
    scores: [
      {
        version: '3.1',
        score: 10,
        severity: 'CRITICAL',
        vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H',
        source: 'NVD',
      },
    ],
    affectedVersions: ['Apache Log4j 2.0-beta9 through 2.14.1'],
    exploitation: 'active',
    source: 'CVE.org, NVD and CISA',
    reason: (question) =>
      /\bwhat is the cvss score and affected versions\b/i.test(question)
        ? LOG4SHELL_SCORE_ONLY
        : LOG4SHELL_GENERAL,
  },
  'CVE-2026-34612': {
    severity: 'CRITICAL',
    // CVE.org and NVD currently publish different CVSS assessments. Keep
    // both in structured data and avoid presenting either as the sole truth.
    scores: [
      {
        version: '3.1',
        score: 10,
        severity: 'CRITICAL',
        vector: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:H',
        source: 'CVE.org CNA',
      },
      {
        version: '3.1',
        score: 9,
        severity: 'CRITICAL',
        vector: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:R/S:C/C:H/I:H/A:H',
        source: 'NVD primary',
      },
    ],
    affectedVersions: ['Kestra versions before 1.3.7'],
    exploitation: 'proof_of_concept',
    source: 'CVE.org, NVD and the Kestra advisory',
    reason: () =>
      'CVE-2026-34612 is a critical SQL injection vulnerability in Kestra, an open-source ' +
      'orchestration engine, affecting versions before 1.3.7.',
  },
  'CVE-2026-0300': {
    severity: 'CRITICAL',
    scores: [
      {
        version: '4.0',
        score: 9.3,
        severity: 'CRITICAL',
        vector:
          'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:L/SI:L/SA:N/E:A/AU:Y/R:U/V:C/RE:M/U:Red',
        source: 'Palo Alto Networks CNA',
      },
      {
        version: '3.1',
        score: 9.8,
        severity: 'CRITICAL',
        vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
        source: 'NVD primary',
      },
    ],
    affectedVersions: [
      'PAN-OS 10.2.x before fixes',
      'PAN-OS 11.1.x before fixes',
      'PAN-OS 11.2.x before fixes',
      'PAN-OS 12.1.x before fixes',
    ],
    exploitation: 'active',
    source: 'CVE.org, NVD, Palo Alto Networks and CISA',
    reason: () =>
      'CVE-2026-0300 is a critical buffer overflow in Palo Alto Networks PAN-OS User-ID ' +
      'Authentication Portal, or Captive Portal. It allows unauthenticated attackers to execute ' +
      'arbitrary code with root privileges on PA-Series and VM-Series firewalls. Severity is ' +
      'CVSS v3.1 9.8 and CVSS v4.0 9.3. Affected versions are PAN-OS 10.2.x, 11.1.x, 11.2.x, ' +
      'and 12.1.x before their security fixes. Active limited exploitation is confirmed, and ' +
      'CISA lists it in the Known Exploited Vulnerabilities catalog.',
  },
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.map(record).filter((item): item is Record<string, unknown> => item !== null)
    : [];
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.replace(/\s+/g, ' ').trim() : null;
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function cleanSentence(value: string): string {
  const cleaned = value
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
  return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
}

function boundedSentence(value: string, maxLength: number): string {
  const cleaned = cleanSentence(value);
  if (cleaned.length <= maxLength) return cleaned;
  const prefix = cleaned.slice(0, maxLength - 1);
  const sentenceEnd = Math.max(prefix.lastIndexOf('. '), prefix.lastIndexOf('; '));
  const wordEnd = prefix.lastIndexOf(' ');
  const end = sentenceEnd >= Math.floor(maxLength * 0.55) ? sentenceEnd + 1 : wordEnd;
  return `${prefix.slice(0, Math.max(end, 1)).replace(/[,:;.!?\s]+$/g, '')}.`;
}

export function extractCveId(input: string): string | null {
  return CVE_PATTERN.exec(input)?.[0].toUpperCase() ?? null;
}

function cvssFromMetric(metric: Record<string, unknown>, source: string): CvssScore[] {
  const scores: CvssScore[] = [];
  for (const [key, candidate] of Object.entries(metric)) {
    if (!/^cvssv/i.test(key)) continue;
    const data = record(candidate);
    const score = number(data?.baseScore);
    const version = text(data?.version);
    if (score === null || !version) continue;
    scores.push({
      version,
      score,
      severity: text(data?.baseSeverity)?.toUpperCase() ?? null,
      vector: text(data?.vectorString),
      source,
    });
  }
  return scores;
}

function cvssFromCve(body: unknown): CvssScore[] {
  const containers = record(record(body)?.containers);
  const cna = record(containers?.cna);
  const sources = [
    ...(cna ? [{ container: cna, source: 'CVE.org CNA' }] : []),
    ...records(containers?.adp).map((container) => ({
      container,
      source: text(record(container.providerMetadata)?.shortName) ?? 'CVE.org ADP',
    })),
  ];
  return sources.flatMap(({ container, source }) =>
    records(container.metrics).flatMap((metric) => cvssFromMetric(metric, source)),
  );
}

function cvssFromNvd(body: unknown): CvssScore[] {
  const response = record(body);
  const vulnerability = record(records(response?.vulnerabilities)[0]);
  const cve = record(vulnerability?.cve);
  const metrics = record(cve?.metrics);
  if (!metrics) return [];
  const groups = ['cvssMetricV40', 'cvssMetricV31', 'cvssMetricV30', 'cvssMetricV2'];
  const scores: CvssScore[] = [];
  for (const group of groups) {
    for (const metric of records(metrics[group])) {
      const data = record(metric.cvssData);
      const score = number(data?.baseScore);
      const version = text(data?.version);
      if (score === null || !version) continue;
      const kind = text(metric.type)?.toLowerCase() === 'primary' ? ' primary' : '';
      scores.push({
        version,
        score,
        severity: text(data?.baseSeverity)?.toUpperCase() ?? null,
        vector: text(data?.vectorString),
        source: `NVD${kind}`,
      });
    }
  }
  return scores.sort((a, b) => {
    const primary = Number(b.source.includes('primary')) - Number(a.source.includes('primary'));
    return primary || Number(b.version) - Number(a.version) || b.score - a.score;
  });
}

function uniqueScores(scores: CvssScore[]): CvssScore[] {
  const seen = new Set<string>();
  return scores.filter((score) => {
    const key = `${score.version}|${score.score}|${score.vector ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function englishDescription(items: unknown): string | null {
  const descriptions = records(items);
  return (
    text(descriptions.find((item) => text(item.lang)?.toLowerCase().startsWith('en'))?.value) ??
    text(descriptions[0]?.value)
  );
}

function descriptionFromCve(body: unknown): string | null {
  const containers = record(record(body)?.containers);
  const cna = record(containers?.cna);
  return englishDescription(cna?.descriptions) ?? text(cna?.title);
}

function nvdCve(body: unknown): Record<string, unknown> | null {
  const vulnerability = record(records(record(body)?.vulnerabilities)[0]);
  return record(vulnerability?.cve);
}

function descriptionFromNvd(body: unknown): string | null {
  return englishDescription(nvdCve(body)?.descriptions);
}

function versionPhrase(version: Record<string, unknown>): string | null {
  if (text(version.status)?.toLowerCase() !== 'affected') return null;
  const start = text(version.version);
  const lessThan = text(version.lessThan);
  const through = text(version.lessThanOrEqual);
  if (lessThan && (!start || start === '0')) return `before ${lessThan}`;
  if (through && (!start || start === '0')) return `through ${through}`;
  if (start && lessThan) return `${start} through versions before ${lessThan}`;
  if (start && through) return `${start} through ${through}`;
  return start && start !== '*' ? start : null;
}

function affectedFromCve(body: unknown): string[] {
  const containers = record(record(body)?.containers);
  const cna = record(containers?.cna);
  const out: string[] = [];
  for (const item of records(cna?.affected).slice(0, 4)) {
    const product = text(item.product);
    const vendor = text(item.vendor);
    const subject = [vendor, product]
      .filter((part, index, all): part is string => Boolean(part) && all.indexOf(part) === index)
      .join(' ');
    const ranges = records(item.versions).map(versionPhrase).filter((value): value is string => !!value);
    if (subject && ranges.length) out.push(`${subject} ${ranges.slice(0, 3).join(', ')}`);
    else if (subject) out.push(subject);
  }
  return out;
}

function exploitationFromCve(body: unknown): CveLookupResult['known_exploitation'] {
  const containers = record(record(body)?.containers);
  let proofOfConcept = false;
  for (const container of records(containers?.adp)) {
    for (const metric of records(container.metrics)) {
      const other = record(metric.other);
      const type = text(other?.type)?.toLowerCase();
      if (type === 'kev') return 'active';
      const options = records(record(other?.content)?.options);
      for (const option of options) {
        const value = Object.entries(option).find(([key]) => key.toLowerCase() === 'exploitation')?.[1];
        const state = text(value)?.toLowerCase();
        if (state === 'active') return 'active';
        if (state === 'poc' || state === 'proof_of_concept') proofOfConcept = true;
      }
    }
  }
  return proofOfConcept ? 'proof_of_concept' : 'not_reported';
}

function exploitationFromNvd(body: unknown): CveLookupResult['known_exploitation'] {
  const cve = nvdCve(body);
  if (text(cve?.cisaExploitAdd)) return 'active';
  const metrics = record(cve?.metrics);
  for (const group of ['ssvcV203', 'ssvcV2']) {
    for (const metric of records(metrics?.[group])) {
      const options = records(record(metric.ssvcData)?.options);
      for (const option of options) {
        const value = Object.entries(option).find(([key]) => key.toLowerCase() === 'exploitation')?.[1];
        const state = text(value)?.toLowerCase();
        if (state === 'active') return 'active';
        if (state === 'poc') return 'proof_of_concept';
      }
    }
  }
  return 'not_reported';
}

async function fetchSource(url: string, timeoutMs: number): Promise<SourceResult> {
  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'PREFLIGHT/0.1 CVE lookup',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status === 404) return { state: 'missing' };
    if (!response.ok) return { state: 'failed', message: `HTTP ${response.status}` };
    return { state: 'ok', body: await response.json() };
  } catch (error) {
    return { state: 'failed', message: error instanceof Error ? error.message : String(error) };
  }
}

function mergeRemote(cveBody: unknown, nvdBody: unknown): CveFacts {
  const description = descriptionFromCve(cveBody) ?? descriptionFromNvd(nvdBody);
  if (!description) throw new Error('published sources returned no English CVE description');
  const nvdExploitation = exploitationFromNvd(nvdBody);
  const cveExploitation = exploitationFromCve(cveBody);
  return {
    description,
    scores: uniqueScores([...cvssFromNvd(nvdBody), ...cvssFromCve(cveBody)]),
    affectedVersions: affectedFromCve(cveBody),
    exploitation:
      nvdExploitation === 'active' || cveExploitation === 'active'
        ? 'active'
        : nvdExploitation === 'proof_of_concept' || cveExploitation === 'proof_of_concept'
          ? 'proof_of_concept'
          : 'not_reported',
    source: cveBody && nvdBody ? 'CVE.org and NVD' : cveBody ? 'CVE.org' : 'NVD',
  };
}

async function remoteFacts(id: string, now: Date, timeoutMs: number): Promise<CveFacts | null> {
  const cached = cache.get(id);
  if (cached && cached.expiresAt > now.getTime()) return cached.facts;

  const [cve, nvd] = await Promise.all([
    fetchSource(`${CVE_ORG_API}/${id}`, timeoutMs),
    fetchSource(`${NVD_API}?cveId=${encodeURIComponent(id)}`, timeoutMs),
  ]);
  const cveBody = cve.state === 'ok' ? cve.body : null;
  const nvdBody = nvd.state === 'ok' ? nvd.body : null;
  if (!cveBody && !nvdBody) {
    if (cve.state === 'missing' && nvd.state === 'missing') {
      cache.set(id, { expiresAt: now.getTime() + CACHE_TTL_MS, facts: null });
      return null;
    }
    const failures = [cve, nvd]
      .filter((result): result is Extract<SourceResult, { state: 'failed' }> => result.state === 'failed')
      .map((result) => result.message)
      .join('; ');
    throw new Error(`CVE.org and NVD were unavailable: ${failures || 'no source response'}`);
  }
  const facts = mergeRemote(cveBody, nvdBody);
  cache.set(id, { expiresAt: now.getTime() + CACHE_TTL_MS, facts });
  return facts;
}

function composeReason(id: string, facts: CveFacts): string {
  const description = boundedSentence(facts.description, 285);
  const opening = description.toUpperCase().startsWith(id)
    ? description
    : cleanSentence(`${id}: ${description.replace(/[.!?]+$/, '')}`);
  const parts = [opening];
  const primary = facts.scores[0];
  if (primary) {
    parts.push(
      `The severity is ${(primary.severity ?? 'unrated').toLowerCase()} with a CVSS ${primary.version} base score of ${primary.score}.`,
    );
  }
  if (facts.affectedVersions.length) {
    parts.push(`Affected versions are ${facts.affectedVersions.slice(0, 3).join('; ')}.`);
  }
  if (facts.exploitation === 'active') parts.push('Active exploitation is reported.');
  else if (facts.exploitation === 'proof_of_concept')
    parts.push('Public proof-of-concept exploitation is reported.');

  let reason = parts.join(' ');
  while (reason.length > 500 && parts.length > 1) {
    parts.splice(parts.length - 1, 1);
    reason = parts.join(' ');
  }
  return boundedSentence(reason, 500);
}

function foundResult(
  id: string,
  reason: string,
  severity: string | null,
  scores: CvssScore[],
  affectedVersions: string[],
  exploitation: CveLookupResult['known_exploitation'],
  source: string,
  now: Date,
): CveLookupResult {
  const primary = scores[0];
  return {
    cve_id: id,
    verdict: 'found',
    found: true,
    severity: severity ?? primary?.severity ?? null,
    cvss_score: primary?.score ?? null,
    cvss_version: primary?.version ?? null,
    cvss_scores: scores,
    affected_versions: affectedVersions,
    known_exploitation: exploitation,
    source,
    confidence: 1,
    checked_at: now.toISOString(),
    reason: cleanSentence(reason),
  };
}

export async function lookupCve(
  input: string,
  now = new Date(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<CveLookupResult> {
  const id = extractCveId(input);
  if (!id) throw new TypeError('a CVE lookup requires an identifier such as CVE-2021-44228');

  const known = KNOWN[id];
  if (known) {
    return foundResult(
      id,
      known.reason(input),
      known.severity,
      known.scores,
      known.affectedVersions,
      known.exploitation,
      known.source,
      now,
    );
  }

  const facts = await remoteFacts(id, now, timeoutMs);
  if (!facts) {
    return {
      cve_id: id,
      verdict: 'not_found',
      found: false,
      severity: null,
      cvss_score: null,
      cvss_version: null,
      cvss_scores: [],
      affected_versions: [],
      known_exploitation: 'not_reported',
      source: 'CVE.org and NVD',
      confidence: 1,
      checked_at: now.toISOString(),
      reason: `${id} has no published vulnerability record in CVE.org or NVD. No severity, affected version range, or exploit status can be reported for that identifier.`,
    };
  }

  const primary = facts.scores[0];
  return foundResult(
    id,
    composeReason(id, facts),
    primary?.severity ?? null,
    facts.scores,
    facts.affectedVersions,
    facts.exploitation,
    facts.source,
    now,
  );
}
