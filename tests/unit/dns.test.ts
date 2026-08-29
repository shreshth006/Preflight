import dns from 'node:dns';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toTelegraphResponse } from '../../src/telegraph/response.js';
import { verifyTLS } from '../../src/tls/verify.js';

afterEach(() => vi.restoreAllMocks());

describe('DNS error classification', () => {
  it('classifies platform-specific resolver errors as DNS failures', async () => {
    vi.spyOn(dns.promises, 'lookup').mockRejectedValue(
      Object.assign(new Error('getaddrinfo EBUSY api.example.com'), { code: 'EBUSY' }),
    );

    const result = await verifyTLS('api.example.com');
    const response = toTelegraphResponse(result, new Date('2026-08-29T00:00:00.000Z'));

    expect(result.failureCode).toBe('DNS_FAILURE');
    expect(result.dnsResolved).toBe(false);
    expect(response.failure_stage).toBe('dns');
    expect(response.checks_completed).toEqual(['hostname syntax validation']);
    expect(response.recommendation).toContain('resolves in public DNS');
  });
});
