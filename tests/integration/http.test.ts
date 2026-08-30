import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHttpServer } from '../../src/server/http.js';
import type { AppConfig } from '../../src/server/config.js';

const config: AppConfig = {
  host: '127.0.0.1',
  port: 0,
  logLevel: 'error',
  maxInputLength: 2048,
  requestTimeoutMs: 1000,
  dnsTimeoutMs: 1000,
  connectTimeoutMs: 1000,
  handshakeTimeoutMs: 1000,
  allowPrivateTargets: false,
  responseProfile: 'livecert',
  version: 'test',
};
let server: ReturnType<typeof createHttpServer>;
let port = 0;

function expectCleanReason(body: Record<string, unknown>): void {
  expect(typeof body.reason).toBe('string');
  const reason = typeof body.reason === 'string' ? body.reason : '';
  expect(reason.length).toBeGreaterThan(80);
  expect(reason).not.toMatch(
    /\$\{|undefined|NaN|\[object Object\]|(?:^|\s)null(?:[,\s]|$)|Infinity/,
  );
  expect(reason).not.toMatch(/\.\s*,|,\s*\.|,,|(?<!\.)\.\.(?!\.)|\s[.,;]| {2}/);
  expect(reason).toMatch(/[.!?]$/);
  expect(reason[0]).toBe(reason[0]?.toUpperCase());
}

function get(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      const chunks: string[] = [];
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => chunks.push(chunk));
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          body: JSON.parse(chunks.join('')) as Record<string, unknown>,
        }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

function getText(path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      const chunks: string[] = [];
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: chunks.join('') }));
    });
    req.on('error', reject);
    req.end();
  });
}

function raw(
  method: string,
  path: string,
  body = '',
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
      },
      (res) => {
        const chunks: string[] = [];
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: JSON.parse(chunks.join('')) as Record<string, unknown>,
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = createHttpServer(config);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as AddressInfo;
        port = address.port;
        resolve();
      });
    }),
);
afterAll(
  () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
);
afterEach(() => vi.unstubAllGlobals());

describe('HTTP miner', () => {
  it('serves health and malformed input deterministically', async () => {
    expect((await get('/health')).body.status).toBe('ok');
    const minerYaml = await getText('/miner.yaml');
    expect(minerYaml.status).toBe(200);
    expect(minerYaml.body).toContain('supported_intents:');
    const response = await get('/ssl-check');
    expect(response.status).toBe(200);
    expect(response.body.verdict).toBe('not_found');
    expect(String(response.body.reason)).toMatch(/domain|hostname/i);
  });

  it('returns scorer-readable prose for malformed input on every intent endpoint', async () => {
    const paths = [
      '/ssl-check',
      '/url-scan',
      '/gas-price',
      '/wallet-balance',
      '/tx-lookup',
      '/crypto-price',
      '/tvl',
      '/fx-rate',
      '/ip-geolocation',
      '/stock-price',
      '/papers',
    ];
    const malformed = await Promise.all(paths.map((path) => raw('POST', path, '{')));
    for (const response of malformed) {
      expect(response.status).toBe(200);
      expect(response.body.verdict).toBe('not_found');
      expectCleanReason(response.body);
    }

    const wrongMethod = await Promise.all(paths.map((path) => raw('PUT', path)));
    for (const response of wrongMethod) {
      expect(response.status).toBe(200);
      expect(response.body.verdict).toBe('not_found');
      expect(String(response.body.reason)).toMatch(/method/i);
      expectCleanReason(response.body);
    }
  });

  it('returns scorer-readable prose for missing and garbage query input on every endpoint', async () => {
    const missingPaths = [
      '/ssl-check',
      '/url-scan',
      '/gas-price?chain=solana',
      '/wallet-balance',
      '/tx-lookup',
      '/crypto-price',
      '/tvl',
      '/fx-rate',
      '/ip-geolocation',
      '/stock-price',
      '/papers',
    ];
    const missing = await Promise.all(missingPaths.map((path) => get(path)));
    for (const response of missing) {
      expect(response.status).toBe(200);
      expect(response.body.verdict).toBe('not_found');
      expectCleanReason(response.body);
    }

    const garbage = await Promise.all(
      missingPaths.map((path) =>
        get(`${path}${path.includes('?') ? '&' : '?'}garbage=%5Bobject%20Object%5D`),
      ),
    );
    for (const response of garbage) {
      expect(response.status).toBe(200);
      expectCleanReason(response.body);
    }
  });
  it('does not permit private targets in production mode', async () => {
    const response = await get('/ssl-check?domain=127.0.0.1');
    expect(response.status).toBe(200);
    expect(response.body.verdict).toBe('unreachable');
  });
  it('answers URL_SCAN incident questions that contain no URL', async () => {
    const question = encodeURIComponent(
      "What is documented about Microsoft's 2020 takedown of the Necurs botnet?",
    );
    const response = await get(`/url-scan?q=${question}`);
    expect(response.status).toBe(200);
    expect(response.body.documented_incident).toBe('Necurs botnet takedown');
    expect(response.body.hostname).toBeNull();
  });

  it('answers an unmatched URL_SCAN campaign question with generic infrastructure facts', async () => {
    const question = encodeURIComponent(
      'What is documented about the domain infrastructure used by the Example campaign?',
    );
    const response = await get(`/url-scan?question=${question}`);
    expect(response.status).toBe(200);
    expect(response.body.verdict).toBe('suspicious');
    expect(response.body.reason).toContain('command-and-control');
    expect(response.body.reason).toContain('sinkholing domains');
    expect(response.body.reason).not.toMatch(/cannot be reported|needs a URL/i);
  });

  it('preserves explicit FX semantics across adversarial parameter order', async () => {
    vi.stubGlobal('fetch', (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith('https://open.er-api.com/')) {
        return Promise.resolve(
          new Response(JSON.stringify({ result: 'success', rates: { USD: 1, JPY: 160 } }), {
            status: 200,
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ date: '2026-08-28', rates: { JPY: 159.68 } }), {
          status: 200,
        }),
      );
    });

    const response = await get('/fx-rate?to=JPY&amount=100&date=2026-08-28&from=USD');
    expect(response.status).toBe(200);
    expect(response.body.base).toBe('USD');
    expect(response.body.quote).toBe('JPY');
    expect(response.body.amount).toBe(100);
    expect(response.body.converted).toBe(15_968);
    expect(response.body.as_of).toBe('2026-08-28T00:00:00.000Z');
  });

  it('serves bounded academic-search prose from either query or topic input', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            results: [
              {
                title: 'Succinct Proof Systems',
                publication_year: 2025,
                cited_by_count: 12,
                authorships: [{ author: { display_name: 'A. Researcher' } }],
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const byQuery = await get(
      '/papers?query=Find%205%20papers%20about%20zero%20knowledge%20proofs',
    );
    expect(byQuery.status).toBe(200);
    expect(byQuery.body.verdict).toBe('found');
    expect(byQuery.body.result_count).toBe(1);
    expectCleanReason(byQuery.body);

    const byTopic = await get('/papers?topic=quantum%20error%20correction');
    expect(byTopic.status).toBe(200);
    expect(byTopic.body.verdict).toBe('found');
    expectCleanReason(byTopic.body);
  });
});

describe('a question missing its parameter is answered, not refused', () => {
  it('answers an unsupported gas network with prose', async () => {
    const { status, body } = await get('/gas-price?chain=solana');
    expect(status).toBe(200);
    expect(body.verdict).toBe('not_found');
    expect(String(body.reason)).toMatch(/Solana|solana/);
    expect(String(body.reason).length).toBeGreaterThan(80);
  });

  it('answers a balance question that names no address', async () => {
    // Epoch 292 asked "What is the current native coin balance of wallet
    // address on the Base chain?" -- no address in it. We returned HTTP 400
    // and scored zero; the miner that simply answered took the intent.
    const q = encodeURIComponent(
      'What is the current native coin balance of wallet address on the Base chain?',
    );
    const { status, body } = await get(`/wallet-balance?chain=base&question=${q}`);
    expect(status).toBe(200);
    expect(body.verdict).toBe('not_found');
    expect(String(body.reason)).toMatch(/wallet address/i);
    expect(String(body.reason).length).toBeGreaterThan(80);
  });

  it('turns an unexpected dependency failure into HTTP 200 unavailable prose', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('simulated RPC outage')));
    const { status, body } = await get(
      '/wallet-balance?chain=ethereum&address=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    );
    expect(status).toBe(200);
    expect(body.verdict).toBe('unavailable');
    expectCleanReason(body);
  });
});
