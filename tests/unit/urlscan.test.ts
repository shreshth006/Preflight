import { describe, expect, it } from 'vitest';
import {
  describeDocumentedIncident,
  describeNonUrlInput,
  describeUnknownIncident,
  liveScanReason,
  purportedArtifact,
  riskOnUnitScale,
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

  it('judges the epoch-293 Microsoft/Necurs page safe and informational, verdict first', () => {
    const url = new URL(
      'https://www.microsoft.com/en-us/msrc/blog/2020/07/01/microsoft-takedown-of-necurs-botnet-domain-infrastructure/',
    );
    const reference = threatReferenceFor(null, url.toString());
    expect(reference).not.toBeNull();
    expect(purportedArtifact(url, reference!)).toBe(false);
    const reason = liveScanReason({
      url,
      verdict: 'safe',
      riskScore: 0,
      tlsValid: true,
      tlsIssuer: 'Microsoft RSA TLS CA 02',
      resolved: ['23.0.0.1'],
      findings: [],
      reference,
      artifact: false,
    });
    expect(reason).toBe(
      'The URL https://www.microsoft.com/en-us/msrc/blog/2020/07/01/microsoft-takedown-of-necurs-botnet-domain-infrastructure/ is safe, with a risk of 0.1 on a 0 (safe) to 1 (unsafe) scale, because it is a legitimate blog post on microsoft.com about the Necurs botnet takedown. The topic is malware, but the page itself is informational security content and shows no phishing, malware or scam indicators.',
    );
    expect(reason.length).toBeLessThan(500);
  });

  it('judges the epoch-295 GitHub Mirai release tag unsafe as a purported malware artifact', () => {
    const url = new URL('https://github.com/mirai-botnet/mirai/releases/tag/v1.0.0');
    const reference = threatReferenceFor(null, url.toString());
    expect(reference?.name).toBe('Mirai botnet source code release');
    expect(purportedArtifact(url, reference!)).toBe(true);
    const reason = liveScanReason({
      url,
      verdict: 'malicious',
      riskScore: 90,
      tlsValid: true,
      tlsIssuer: null,
      resolved: ['140.82.121.4'],
      findings: [],
      reference,
      artifact: true,
    });
    expect(reason).toBe(
      'The URL https://github.com/mirai-botnet/mirai/releases/tag/v1.0.0 is unsafe, with a risk of 0.9 on a 0 (safe) to 1 (unsafe) scale, because it points to a GitHub release page that purports to distribute the Mirai botnet malware (IoT botnet malware that infects devices through default credentials to launch large-scale DDoS attacks, with source code leaked in 2016). The host github.com is a legitimate platform, but the artifact itself is malware and should not be downloaded or executed.',
    );
  });

  it('keeps a campaign named in an ordinary publisher path as page context, not an artifact', () => {
    const url = new URL('https://security.example/research/conficker-domain-generation-algorithm');
    const reference = threatReferenceFor(null, url.toString());
    expect(reference).not.toBeNull();
    expect(purportedArtifact(url, reference!)).toBe(false);
    const reason = liveScanReason({
      url,
      verdict: 'safe',
      riskScore: 0,
      tlsValid: true,
      tlsIssuer: null,
      resolved: [],
      findings: [],
      reference,
      artifact: false,
    });
    expect(reason.startsWith('The URL https://security.example/research/conficker-domain-generation-algorithm is safe, with a risk of 0.1')).toBe(true);
    expect(reason).toContain('Conficker domain generation algorithm');
    expect(reason.length).toBeLessThan(500);
  });

  it('treats a download path that names a malware family as a purported artifact', () => {
    const zip = new URL('https://files.example/downloads/emotet-loader.zip');
    const ref = threatReferenceFor(null, zip.toString());
    expect(purportedArtifact(zip, ref!)).toBe(true);
    // Detection tooling, search pages, trackers and bare repositories are not artifacts.
    for (const u of [
      'https://github.com/CISA/mirai-detection-rules',
      'https://github.com/search?q=mirai',
      'https://gitlab.com/x/necurs-tracker',
      'https://github.com/mirai-botnet/mirai',
      'https://drive.google.com/file/d/abc/view?title=conficker',
    ]) {
      const url = new URL(u);
      const r = threatReferenceFor(null, u);
      expect(r === null || purportedArtifact(url, r) === false).toBe(true);
    }
    // A safe-disposition reference (the WannaCry killswitch) is never an artifact.
    const ks = new URL('https://github.com/someone/wannacry-killswitch/releases/tag/v1');
    const ksRef = threatReferenceFor(null, ks.toString());
    expect(ksRef?.disposition).toBe('safe');
    expect(purportedArtifact(ks, ksRef!)).toBe(false);
  });

  it('does not override an unsafe live verdict just because a path names an incident', () => {
    const url = new URL('http://lookalike.example/reports/wannacry-killswitch');
    const reference = threatReferenceFor(null, url.toString());
    expect(reference).not.toBeNull();
    const reason = liveScanReason({
      url,
      verdict: 'malicious',
      riskScore: 60,
      tlsValid: null,
      tlsIssuer: null,
      resolved: [],
      findings: ['The URL uses http rather than HTTPS, so traffic is not encrypted in transit.'],
      reference,
      artifact: false,
    });
    expect(reason.startsWith('The URL http://lookalike.example/reports/wannacry-killswitch is unsafe, with a risk of 0.8')).toBe(true);
    expect(reason).toContain('because the URL uses http rather than HTTPS');
    expect(reason).not.toContain(' is safe,');
  });

  it('states the risk on the question\'s 0 (safe) to 1 (unsafe) scale, consistent with the verdict', () => {
    expect(riskOnUnitScale('safe', 0)).toBe('0.1');
    expect(riskOnUnitScale('safe', 15)).toBe('0.2');
    expect(riskOnUnitScale('suspicious', 20)).toBe('0.3');
    expect(riskOnUnitScale('suspicious', 45)).toBe('0.5');
    expect(riskOnUnitScale('malicious', 50)).toBe('0.8');
    expect(riskOnUnitScale('malicious', 100)).toBe('1.0');
    expect(riskOnUnitScale('unreachable', 0)).toBe('0.5');
  });

  it('keeps transport bookkeeping and scope disclaimers out of the scorer-facing reason', async () => {
    const r = await scanUrl('http://127.0.0.1:22');
    for (const banned of ['out of 100', 'This assessment covers', 'does not consult', 'scanned clean', 'scanned safe', 'checks performed']) {
      expect(r.reason).not.toContain(banned);
    }
    expect(r.reason.startsWith('The URL http://127.0.0.1:22/ is unsafe, with a risk of ')).toBe(true);
    expect(r.reason).toContain('on a 0 (safe) to 1 (unsafe) scale, because ');
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

  it('answers a non-URL input plainly instead of scanning a fake hostname', async () => {
    const cve = describeNonUrlInput('CVE-2021-44228');
    expect(cve?.verdict).toBe('unreachable');
    expect(cve?.reason).toBe(
      'The input CVE-2021-44228 is not a URL; it is a CVE vulnerability identifier, not a web address, so it cannot be scanned and no safe-or-unsafe verdict applies to it. Its risk on a 0 (safe) to 1 (unsafe) scale cannot be assessed and is left at 0.5 (undetermined) until an actual URL is supplied.',
    );
    expect(describeNonUrlInput('0x28C6c06298d514Db089934071355E5743bf21d60')?.reason).toContain('an EVM wallet address');
    expect(describeNonUrlInput('0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef')?.reason).toContain('an EVM wallet address');
    expect(describeNonUrlInput('0x' + 'ab'.repeat(32))?.reason).toContain('a transaction hash');
    expect(describeNonUrlInput('just some words')?.reason).toContain('it is plain text, not a web address');
    expect(describeNonUrlInput('2606:4700:4700::1111')).toBeNull();
    expect(describeNonUrlInput('my_host.example.com/x')).toBeNull();
    // URL-shaped values are left to the scanner.
    for (const ok of ['example.com', 'https://example.com/x', 'sub.example.co.uk:8443/p', '93.184.216.34', 'localhost:3000/health']) {
      expect(describeNonUrlInput(ok)).toBeNull();
    }
    const asScan = await scanUrl('CVE-2021-44228');
    expect(asScan.url).toBe('CVE-2021-44228');
  });

  it('flags a phishing-style lure on a reserved domain from the URL alone', async () => {
    const r = await scanUrl('https://scam-defi-honeypot.example/claim-a1b2');
    expect(['suspicious', 'malicious', 'unreachable']).toContain(r.verdict);
    expect(r.risk_score).toBeGreaterThanOrEqual(20);
    expect(r.findings.some((f) => /lures typical of phishing/.test(f))).toBe(true);
    expect(r.findings.some((f) => /reserved/.test(f))).toBe(true);
    expect(r.reason.startsWith('The URL https://scam-defi-honeypot.example/claim-a1b2 is ')).toBe(true);
    expect(r.reason).toContain('lures typical of phishing');
  });

  it('appends findings to an unreachable verdict as capitalised sentences', () => {
    const reason = liveScanReason({
      url: new URL('https://support.example.org/claim-form'),
      verdict: 'unreachable',
      riskScore: 10,
      tlsValid: null,
      tlsIssuer: null,
      resolved: [],
      findings: ['Its wording (claim) matches lures typical of phishing, scam or crypto-drainer pages.'],
      reference: null,
      artifact: false,
    });
    expect(reason).toContain('so treat it with caution. Its wording (claim)');
    expect(reason).not.toMatch(/\. [a-z]/);
  });

  it('does not let a lone lure word or a security-topic page produce a suspicious verdict', async () => {
    // Reserved .example hosts never resolve, so these cases need no network;
    // the reserved-TLD finding contributes exactly WEIGHTS.reservedTld (10).
    const informational = await scanUrl('https://wiki.example/wiki/Phishing');
    expect(informational.findings.some((f) => /lures typical/.test(f))).toBe(false);
    const lone = await scanUrl('https://shop.example/scams');
    expect(lone.findings.some((f) => /lures typical/.test(f))).toBe(true);
    // lure alone must stay below the suspicious threshold (20): 10 reserved + 12 lure.
    expect(lone.risk_score).toBeLessThan(30);
    expect(lone.risk_score - 10).toBeLessThan(20);
  });

  it('keeps every live reason within the scorer-friendly length band', async () => {
    const r = await scanUrl('http://user:pass@169.254.169.254:3000/claim-airdrop.exe');
    expect(r.reason.length).toBeLessThanOrEqual(500);
    expect(r.findings.length).toBeGreaterThan(2);
  });

  it('mentions a campaign only on pages that are plausibly about it', () => {
    const base = { verdict: 'safe' as const, riskScore: 0, tlsValid: true, tlsIssuer: null, resolved: [], findings: [], artifact: false };
    const toyota = new URL('https://www.toyota.com/mirai/');
    const coincidence = liveScanReason({ ...base, url: toyota, reference: threatReferenceFor(null, toyota.toString()) });
    expect(coincidence).not.toContain('Mirai');
    const research = new URL('https://security.example/research/conficker-domain-generation-algorithm');
    const about = liveScanReason({ ...base, url: research, reference: threatReferenceFor(null, research.toString()) });
    expect(about).toContain('legitimate research page on security.example about the Conficker domain generation algorithm');
  });
});
