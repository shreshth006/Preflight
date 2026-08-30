import { describe, expect, it } from 'vitest';
import { toTelegraphResponse } from '../../src/telegraph/response.js';
import type { TLSVerificationResult } from '../../src/tls/types.js';

const base: TLSVerificationResult = {
  input: 'EXAMPLE.com.',
  normalizedHost: 'example.com',
  port: 443,
  reachable: true,
  dnsResolved: true,
  handshakeSucceeded: true,
  certificatePresent: true,
  chainTrusted: true,
  hostnameValid: true,
  timeValid: true,
  valid: true,
  failureCode: 'NONE',
  network: { resolvedAddresses: ['93.184.216.34'], selectedAddress: '93.184.216.34', family: 4 },
  certificate: { issuer: 'Test CA', validTo: '2030-01-01T00:00:00.000Z', chainComplete: true },
  timingMs: { total: 10 },
};

describe('Telegraph response adapter', () => {
  it('formats the stable livecert-compatible valid shape', () => {
    const response = toTelegraphResponse(base, new Date('2026-01-01T00:00:00.000Z'));
    expect(response.domain).toBe('example.com');
    expect(response.verdict).toBe('valid');
    expect(response.valid).toBe(true);
    expect(response.chain_complete).toBe(true);
    expect(response.issuer).toBe('Test CA');
    expect(response.valid_to).toBe('2030-01-01');
    expect(response.days_remaining).toBe(1461);
    expect(response.confidence).toBe(1);
    expect(response.reason).toContain('valid');
    expect(response.checked_at).toBe('2026-01-01T00:00:00.000Z');
  });
  it('maps negative results without turning them into transport errors', () => {
    expect(
      toTelegraphResponse(
        { ...base, valid: false, failureCode: 'HOSTNAME_MISMATCH', hostnameValid: false },
        new Date('2026-01-01T00:00:00.000Z'),
      ).verdict,
    ).toBe('hostname_mismatch');
    expect(
      toTelegraphResponse({
        ...base,
        reachable: false,
        handshakeSucceeded: false,
        certificatePresent: false,
        chainTrusted: null,
        hostnameValid: null,
        timeValid: null,
        valid: false,
        failureCode: 'TIMEOUT',
      }).verdict,
    ).toBe('unreachable');
  });

  it('does not describe every unreachable target as a DNS failure', () => {
    const tcp = toTelegraphResponse({
      ...base,
      reachable: false,
      handshakeSucceeded: false,
      certificatePresent: false,
      chainTrusted: null,
      hostnameValid: null,
      timeValid: null,
      valid: false,
      failureCode: 'CONNECTION_FAILURE',
    });
    expect(tcp.reason).toMatch(/resolved in public DNS/i);
    expect(tcp.reason).toMatch(/TCP connection/i);
    expect(tcp.reason).not.toMatch(/does not resolve/i);

    const handshake = toTelegraphResponse({
      ...base,
      handshakeSucceeded: false,
      certificatePresent: false,
      chainTrusted: null,
      hostnameValid: null,
      timeValid: null,
      valid: false,
      failureCode: 'HANDSHAKE_FAILURE',
    });
    expect(handshake.reason).toMatch(/reachable.*did not complete a TLS handshake/i);
    expect(handshake.reason).not.toMatch(/does not resolve/i);
  });

  it('uses the measured DNS methodology when the request deadline wins the DNS timer race', () => {
    const timeout = toTelegraphResponse({
      ...base,
      input: 'api.paymentgateway.com',
      normalizedHost: 'api.paymentgateway.com',
      dnsResolved: false,
      reachable: false,
      handshakeSucceeded: false,
      certificatePresent: false,
      chainTrusted: null,
      hostnameValid: null,
      timeValid: null,
      valid: false,
      failureCode: 'TIMEOUT',
      failureMessage: 'request deadline exceeded',
      network: { resolvedAddresses: [] },
    });
    expect(timeout.reason).toMatch(/does not resolve to a server on the public internet/i);
    expect(timeout.reason).toMatch(/openssl or curl/i);
    expect(timeout.reason).toMatch(/Subject Alternative Names/i);
  });

  it('keeps timeout prose aligned with the network stage that completed', () => {
    const tcp = toTelegraphResponse({
      ...base,
      dnsResolved: true,
      reachable: false,
      handshakeSucceeded: false,
      certificatePresent: false,
      chainTrusted: null,
      hostnameValid: null,
      timeValid: null,
      valid: false,
      failureCode: 'TIMEOUT',
    });
    expect(tcp.reason).toMatch(/resolved in public DNS.*TCP connection/i);
    expect(tcp.reason).not.toMatch(/does not resolve/i);

    const tls = toTelegraphResponse({
      ...base,
      dnsResolved: true,
      reachable: true,
      handshakeSucceeded: false,
      certificatePresent: false,
      chainTrusted: null,
      hostnameValid: null,
      timeValid: null,
      valid: false,
      failureCode: 'TIMEOUT',
    });
    expect(tls.reason).toMatch(/reachable.*did not complete a TLS handshake/i);
    expect(tls.reason).not.toMatch(/does not resolve|TCP connection/i);
  });

  it('reports a blocked private destination without claiming a DNS failure', () => {
    const blocked = toTelegraphResponse({
      ...base,
      input: '127.0.0.1',
      normalizedHost: '127.0.0.1',
      dnsResolved: false,
      reachable: false,
      handshakeSucceeded: false,
      certificatePresent: false,
      chainTrusted: null,
      hostnameValid: null,
      timeValid: null,
      valid: false,
      failureCode: 'CONNECTION_FAILURE',
      failureMessage: 'unsafe destination address blocked: 127.0.0.1',
      network: { resolvedAddresses: [] },
    });
    expect(blocked.reason).toMatch(/blocked by the network safety policy/i);
    expect(blocked.checks_completed).toContain('destination safety policy');
    expect(blocked.reason).not.toMatch(/does not resolve/i);
  });
});
