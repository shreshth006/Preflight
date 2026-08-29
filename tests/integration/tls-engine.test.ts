import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tls from 'node:tls';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyTLS } from '../../src/tls/verify.js';

let root = '';
let server: tls.Server;
let port = 0;
let wrongServer: tls.Server;
let wrongPort = 0;
let ecdsaServer: tls.Server;
let ecdsaPort = 0;
let selfSignedServer: tls.Server;
let selfSignedPort = 0;
let plainServer: net.Server;
let plainPort = 0;
let stallingServer: net.Server;
let stallingPort = 0;

function listen(serverToStart: net.Server | tls.Server): Promise<number> {
  return new Promise((resolve) => {
    serverToStart.listen(0, '127.0.0.1', () => {
      const address = serverToStart.address();
      resolve(address && typeof address === 'object' ? address.port : 0);
    });
  });
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'preflight-tls-'));
  const ext = join(root, 'ext.cnf');
  writeFileSync(ext, '[v3]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(root, 'ca.key'),
      '-out',
      join(root, 'ca.crt'),
      '-subj',
      '/CN=PREFLIGHT Test CA',
      '-days',
      '2',
    ],
    { stdio: 'ignore' },
  );
  execFileSync(
    'openssl',
    ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', join(root, 'ecdsa.key')],
    { stdio: 'ignore' },
  );
  execFileSync(
    'openssl',
    [
      'req',
      '-new',
      '-key',
      join(root, 'ecdsa.key'),
      '-out',
      join(root, 'ecdsa.csr'),
      '-subj',
      '/CN=localhost',
    ],
    { stdio: 'ignore' },
  );
  execFileSync(
    'openssl',
    [
      'x509',
      '-req',
      '-in',
      join(root, 'ecdsa.csr'),
      '-CA',
      join(root, 'ca.crt'),
      '-CAkey',
      join(root, 'ca.key'),
      '-CAcreateserial',
      '-out',
      join(root, 'ecdsa.crt'),
      '-days',
      '2',
      '-extfile',
      ext,
      '-extensions',
      'v3',
    ],
    { stdio: 'ignore' },
  );
  execFileSync(
    'openssl',
    [
      'req',
      '-new',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(root, 'server.key'),
      '-out',
      join(root, 'server.csr'),
      '-subj',
      '/CN=localhost',
    ],
    { stdio: 'ignore' },
  );
  execFileSync(
    'openssl',
    [
      'x509',
      '-req',
      '-in',
      join(root, 'server.csr'),
      '-CA',
      join(root, 'ca.crt'),
      '-CAkey',
      join(root, 'ca.key'),
      '-CAcreateserial',
      '-out',
      join(root, 'server.crt'),
      '-days',
      '2',
      '-extfile',
      ext,
      '-extensions',
      'v3',
    ],
    { stdio: 'ignore' },
  );
  const wrongExt = join(root, 'wrong-ext.cnf');
  writeFileSync(wrongExt, '[v3]\nsubjectAltName=DNS:other.test\n');
  execFileSync(
    'openssl',
    [
      'req',
      '-new',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(root, 'wrong.key'),
      '-out',
      join(root, 'wrong.csr'),
      '-subj',
      '/CN=other.test',
    ],
    { stdio: 'ignore' },
  );
  execFileSync(
    'openssl',
    [
      'x509',
      '-req',
      '-in',
      join(root, 'wrong.csr'),
      '-CA',
      join(root, 'ca.crt'),
      '-CAkey',
      join(root, 'ca.key'),
      '-CAcreateserial',
      '-out',
      join(root, 'wrong.crt'),
      '-days',
      '2',
      '-extfile',
      wrongExt,
      '-extensions',
      'v3',
    ],
    { stdio: 'ignore' },
  );
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(root, 'self.key'),
      '-out',
      join(root, 'self.crt'),
      '-subj',
      '/CN=localhost',
      '-days',
      '2',
      '-addext',
      'subjectAltName=DNS:localhost',
    ],
    { stdio: 'ignore' },
  );
  server = tls.createServer(
    { key: readFileSync(join(root, 'server.key')), cert: readFileSync(join(root, 'server.crt')) },
    (socket) => socket.end(),
  );
  wrongServer = tls.createServer(
    { key: readFileSync(join(root, 'wrong.key')), cert: readFileSync(join(root, 'wrong.crt')) },
    (socket) => socket.end(),
  );
  ecdsaServer = tls.createServer(
    { key: readFileSync(join(root, 'ecdsa.key')), cert: readFileSync(join(root, 'ecdsa.crt')) },
    (socket) => socket.end(),
  );
  selfSignedServer = tls.createServer(
    { key: readFileSync(join(root, 'self.key')), cert: readFileSync(join(root, 'self.crt')) },
    (socket) => socket.end(),
  );
  plainServer = net.createServer((socket) => socket.end());
  stallingServer = net.createServer(() => undefined);
  port = await listen(server);
  wrongPort = await listen(wrongServer);
  ecdsaPort = await listen(ecdsaServer);
  selfSignedPort = await listen(selfSignedServer);
  plainPort = await listen(plainServer);
  stallingPort = await listen(stallingServer);
});

afterAll(() => {
  server.close();
  wrongServer.close();
  ecdsaServer.close();
  selfSignedServer.close();
  plainServer.close();
  stallingServer.close();
  rmSync(root, { recursive: true, force: true });
});

describe('local TLS engine', () => {
  it('validates a trusted local certificate with SNI and a custom CA', async () => {
    const result = await verifyTLS(`localhost:${port}`, {
      allowPrivateTargets: true,
      ca: readFileSync(join(root, 'ca.crt')),
    });
    expect(result.valid).toBe(true);
    expect(result.hostnameValid).toBe(true);
    expect(result.chainTrusted).toBe(true);
    expect(result.network.selectedAddress).toBe('127.0.0.1');
  });
  it('classifies a trusted-but-wrong hostname separately', async () => {
    const result = await verifyTLS(`localhost:${wrongPort}`, {
      allowPrivateTargets: true,
      ca: readFileSync(join(root, 'ca.crt')),
    });
    expect(result.valid).toBe(false);
    expect(result.failureCode).toBe('HOSTNAME_MISMATCH');
  });
  it('validates a trusted ECDSA certificate', async () => {
    const result = await verifyTLS(`localhost:${ecdsaPort}`, {
      allowPrivateTargets: true,
      ca: readFileSync(join(root, 'ca.crt')),
    });
    expect(result.valid).toBe(true);
  });
  it('classifies a self-signed certificate separately from a trusted certificate', async () => {
    const result = await verifyTLS(`localhost:${selfSignedPort}`, { allowPrivateTargets: true });
    expect(result.valid).toBe(false);
    expect(result.failureCode).toBe('UNTRUSTED_CHAIN');
    expect(result.failureMessage).toMatch(/SELF_SIGNED/i);
  });
  it('classifies a non-TLS service as a handshake failure', async () => {
    const result = await verifyTLS(`localhost:${plainPort}`, { allowPrivateTargets: true });
    expect(result.valid).toBe(false);
    expect(['HANDSHAKE_FAILURE', 'TIMEOUT']).toContain(result.failureCode);
  });
  it('starts the handshake timeout only after the TCP connection succeeds', async () => {
    const result = await verifyTLS(`localhost:${stallingPort}`, {
      allowPrivateTargets: true,
      requestTimeoutMs: 1_000,
      connectTimeoutMs: 50,
      handshakeTimeoutMs: 150,
    });
    expect(result.failureCode).toBe('TIMEOUT');
    expect(result.failureMessage).toBe('TLS handshake timed out');
    expect(result.reachable).toBe(true);
    expect(result.network.selectedAddress).toBe('127.0.0.1');
    expect(result.timingMs.connect).toBeLessThan(50);
    expect(result.timingMs.handshake).toBeGreaterThanOrEqual(100);
  });
  it('classifies NXDOMAIN without throwing', async () => {
    const result = await verifyTLS('preflight-nxdomain.invalid', { dnsTimeoutMs: 1000 });
    expect(result.valid).toBe(false);
    expect(result.failureCode).toBe('DNS_FAILURE');
  });
});
