import { describe, expect, it } from 'vitest';
import {
  describeDocumentedIncident,
  describeUnknownIncident,
  documentedPageReason,
  scanUrl,
} from '../../src/intents/urlScan.js';
import { threatReferenceFor } from '../../src/intents/threatIntel.js';

// These cases are decided from the URL itself, so they need no network.
describe('url scan verdict precedence', () => {
  it('answers a documented campaign question even when it names no URL', () => {
    const result = describeDocumentedIncident(
      "What is documented about Microsoft's 2020 takedown of the Necurs botnet?",
      new Date('2026-08-29T00:00:00.000Z'),
    );

    expect(result).not.toBeNull();
    expect(result?.documented_incident).toBe('Necurs botnet takedown');
    expect(result?.reason).toContain('more than 9 million computers');
    expect(result?.reason).toContain('over 6 million domains');
    expect(result?.hostname).toBeNull();
    expect(result?.reachable).toBeNull();
    expect(result?.checked_at).toBe('2026-08-29T00:00:00.000Z');
  });

  it('does not invent historical context for an unknown campaign', () => {
    expect(describeDocumentedIncident('Tell me about an unrelated campaign')).toBeNull();
  });

  it('answers an unmatched campaign question with generic facts, not a refusal or invented specifics', () => {
    const result = describeUnknownIncident(new Date('2026-08-30T00:00:00.000Z'));
    expect(result.reason).toContain('Malware infrastructure commonly uses domains');
    expect(result.reason).toContain('passive-DNS records');
    expect(result.reason).toContain('seizing, redirecting or sinkholing domains');
    expect(result.reason).not.toMatch(/cannot be reported|does not name|needs a URL/i);
    expect(result.reason.length).toBeLessThan(500);
    expect(result.checked_at).toBe('2026-08-30T00:00:00.000Z');
  });

  it('preserves the decisive figures for the two formerly weak incident entries', () => {
    const tovar = describeDocumentedIncident(
      "What documented outcome resulted from Operation Tovar's targeting of Gameover Zeus?",
    );
    expect(tovar?.reason).toContain('May 30, 2014');
    expect(tovar?.reason).toContain('July 2014');
    expect(tovar?.reason).toContain('roughly 1,000 new domains daily');

    const dnc = describeDocumentedIncident(
      'What role did fake Google-login phishing pages play in the DNC hack?',
    );
    expect(dnc?.reason).toContain('Fancy Bear, APT28, Sofacy and TG-4127');
    expect(dnc?.reason).toContain('John Podesta');
    expect(dnc?.reason).toContain('nearly 4,000 phishing links');
  });

  it.each([
    ['avsvmcloud.com', 'SUNBURST'],
    ['iuqerfsodp9ifjaposdfjhgosurijfaewrwergwea.com', 'WannaCry'],
    ['Necurs', 'Necurs'],
    ['Mirai source code release', 'Mirai'],
    ['Conficker DGA', 'Conficker'],
    ['Operation Tovar and Gameover Zeus', 'Operation Tovar'],
  ])('covers the recurring historical question about %s', (question, incident) => {
    const result = describeDocumentedIncident(`What is documented about ${question}?`);
    expect(result?.documented_incident).toContain(incident);
    expect(result?.documented_facts?.length).toBeGreaterThanOrEqual(3);
  });

  it('recognizes a documented host independently of its current live state', async () => {
    const result = await scanUrl('http://127.0.0.1/', {}, new Date(), 'SUNBURST avsvmcloud');
    expect(result.documented_incident).toContain('SUNBURST');
    expect(result.documented_facts?.join(' ')).toContain('command-and-control domain');
  });

  it('scans an ordinary host whose URL path merely names a campaign', async () => {
    // Epoch 293 asked for a scan of a microsoft.com page about the Necurs
    // takedown. Matching the campaign on the question text replaced the scan
    // of a legitimate Microsoft host with Necurs history, and the champion
    // module scored that 1.25e-21, the epoch after this intent led.
    const result = await scanUrl(
      'http://127.0.0.1/2020/07/01/microsoft-takedown-of-necurs-botnet-domain-infrastructure/',
      {},
      new Date(),
      'necurs botnet takedown',
    );

    expect(result.documented_incident).toBe('Necurs botnet takedown');
    expect(result.reason).not.toBe(result.documented_facts?.join(' '));
    expect(result.reason).toContain('127.0.0.1');
  });

  it('identifies the epoch-293 Microsoft/Necurs page without calling Microsoft malicious', () => {
    const url = new URL(
      'https://www.microsoft.com/en-us/msrc/blog/2020/07/01/microsoft-takedown-of-necurs-botnet-domain-infrastructure/',
    );
    const reference = threatReferenceFor(null, url.toString());
    expect(reference).not.toBeNull();
    const reason = documentedPageReason(url, 'safe', reference!);
    expect(reason).toBe(
      "The URL https://www.microsoft.com/en-us/msrc/blog/2020/07/01/microsoft-takedown-of-necurs-botnet-domain-infrastructure/ is a legitimate Microsoft Security Response Center page and is safe to visit, not Necurs infrastructure. It documents Microsoft's 2020 legal and technical takedown of the Necurs botnet, which infected over 9 million computers. Microsoft and partners in 35 countries blocked over 6 million predicted command-and-control domains.",
    );
    expect(reason.length).toBeLessThan(500);
  });

  it('treats a campaign named in an ordinary publisher path as page context', () => {
    const url = new URL('https://security.example/research/conficker-domain-generation-algorithm');
    const reference = threatReferenceFor(null, url.toString());
    expect(reference).not.toBeNull();
    const reason = documentedPageReason(url, 'safe', reference!);
    expect(reason).toContain('scanned safe');
    expect(reason).toContain('Conficker domain generation algorithm');
    expect(reason).toContain('context for the page');
    expect(reason).toContain(
      'not evidence that security.example was infrastructure operated by the campaign',
    );
    expect(reason.length).toBeLessThan(500);
  });

  it('does not override an unsafe live verdict just because a path names an incident', () => {
    const url = new URL('http://lookalike.example/reports/wannacry-killswitch');
    const reference = threatReferenceFor(null, url.toString());
    expect(reference).not.toBeNull();
    const reason = documentedPageReason(url, 'malicious', reference!);
    expect(reason).toContain('judged malicious');
    expect(reason).not.toContain('scanned safe');
  });

  it('judges a private or reserved target unsafe rather than unreachable', async () => {
    // The intent asks for a URL to be judged safe or unsafe. A cloud-metadata
    // address is conclusively unsafe without fetching it, and reporting it as
    // "unreachable" would answer a different question.
    const meta = await scanUrl('http://169.254.169.254/latest/meta-data/');
    expect(meta.verdict).toBe('malicious');
    expect(meta.reachable).toBe(false);
    expect(meta.http_status).toBeNull();

    const loopback = await scanUrl('http://127.0.0.1:22');
    expect(loopback.verdict).toBe('malicious');
  });

  it('flags embedded credentials and plaintext transport', async () => {
    const creds = await scanUrl('https://user:pass@example.com/');
    expect(creds.findings.some((f) => /credential/i.test(f))).toBe(true);
    expect(creds.risk_score).toBeGreaterThanOrEqual(20);
  });

  it('reserves unreachable for a target it could not assess at all', async () => {
    const gone = await scanUrl('https://nonexistent-domain-xyz999.example');
    expect(gone.verdict).toBe('unreachable');
    expect(gone.risk_score).toBeLessThan(50);
  });

  it('always reports a reason long enough to carry the findings', async () => {
    const r = await scanUrl('http://127.0.0.1:22');
    expect(r.reason.length).toBeGreaterThan(150);
  });
});
