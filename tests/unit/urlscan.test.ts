import { describe, expect, it } from 'vitest';
import { describeDocumentedIncident, scanUrl } from '../../src/intents/urlScan.js';

// These cases are decided from the URL itself, so they need no network.
describe('url scan verdict precedence', () => {
  it('answers a documented campaign question even when it names no URL', () => {
    const result = describeDocumentedIncident(
      "What is documented about Microsoft's 2020 takedown of the Necurs botnet?",
      new Date('2026-08-29T00:00:00.000Z'),
    );

    expect(result).not.toBeNull();
    expect(result?.documented_incident).toBe('Necurs botnet takedown');
    expect(result?.reason).toContain('more than nine million computers');
    expect(result?.reason).toContain('more than six million');
    expect(result?.hostname).toBeNull();
    expect(result?.reachable).toBeNull();
    expect(result?.checked_at).toBe('2026-08-29T00:00:00.000Z');
  });

  it('does not invent historical context for an unknown campaign', () => {
    expect(describeDocumentedIncident('Tell me about an unrelated campaign')).toBeNull();
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
    expect(result?.documented_facts?.length).toBeGreaterThanOrEqual(4);
  });

  it('recognizes a documented host independently of its current live state', async () => {
    const result = await scanUrl('http://127.0.0.1/', {}, new Date(), 'SUNBURST avsvmcloud');
    expect(result.documented_incident).toContain('SUNBURST');
    expect(result.documented_facts?.join(' ')).toContain('command-and-control domain');
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
