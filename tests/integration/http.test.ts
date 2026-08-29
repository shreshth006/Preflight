import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

describe('HTTP miner', () => {
  it('serves health and malformed input deterministically', async () => {
    expect((await get('/health')).body.status).toBe('ok');
    const minerYaml = await getText('/miner.yaml');
    expect(minerYaml.status).toBe(200);
    expect(minerYaml.body).toContain('supported_intents:');
    const response = await get('/ssl-check');
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_INPUT');
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
});

describe('a question missing its parameter is answered, not refused', () => {
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
});
