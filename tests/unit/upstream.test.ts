import { afterEach, describe, expect, it, vi } from 'vitest';
import { lookupTvl } from '../../src/intents/tvl.js';
import { getCryptoPrice } from '../../src/intents/cryptoPrice.js';

afterEach(() => vi.unstubAllGlobals());

function failLlama(): void {
  const real = globalThis.fetch;
  vi.stubGlobal('fetch', (...args: Parameters<typeof fetch>) => {
    const target = args[0];
    const url =
      typeof target === 'string' ? target : target instanceof URL ? target.href : target.url;
    if (url.includes('llama.fi')) return Promise.reject(new Error('simulated outage'));
    return real(...args);
  });
}

describe('upstream failure is not evidence of absence', () => {
  it('reports TVL as unavailable rather than not_found when DefiLlama is down', async () => {
    failLlama();
    const r = await lookupTvl('aave');
    expect(r.verdict).toBe('unavailable');
    expect(r.tvl_usd).toBeNull();
    // The old behaviour asserted the protocol was untracked, which is false
    // when the API simply did not answer.
    expect(r.reason).not.toMatch(/does not (track|index)/i);
    expect(r.reason).toMatch(/did not respond/i);
    expect(r.reason.length).toBeGreaterThan(150);
  });

  it('does not claim TVL is untracked when either required lookup fails', async () => {
    vi.stubGlobal('fetch', (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/tvl/')) return Promise.reject(new Error('protocol lookup failed'));
      if (url.includes('/v2/chains')) {
        return Promise.resolve(
          new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
        );
      }
      return Promise.reject(new Error(`unexpected URL: ${url}`));
    });
    const r = await lookupTvl('aave');
    expect(r.verdict).toBe('unavailable');
    expect(r.reason).not.toMatch(/does not (track|index)/i);
  });

  it('does not substitute an all-chain TVL for a missing chain-specific figure', async () => {
    vi.stubGlobal('fetch', (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/tvl/aave')) return Promise.resolve(new Response('100'));
      if (url.endsWith('/v2/chains')) return Promise.resolve(new Response('[]'));
      if (url.endsWith('/protocol/aave')) return Promise.reject(new Error('breakdown failed'));
      return Promise.reject(new Error(`unexpected URL: ${url}`));
    });
    const r = await lookupTvl('aave', new Date('2026-08-30T00:00:00.000Z'), 'Ethereum');
    expect(r.verdict).toBe('unavailable');
    expect(r.tvl_usd).toBeNull();
    expect(r.reason).toMatch(/not substituted/i);
  });

  it('reports a price as unavailable rather than not_found when the feed is down', async () => {
    failLlama();
    const r = await getCryptoPrice('BTC');
    expect(r.verdict).toBe('unavailable');
    expect(r.price_usd).toBeNull();
    expect(r.reason).not.toMatch(/does not track/i);
    expect(r.reason).toMatch(/did not respond/i);
  });

  it('does not substitute a current price when a historical lookup fails', async () => {
    const requested: string[] = [];
    vi.stubGlobal('fetch', (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      requested.push(url);
      return Promise.resolve(new Response('upstream error', { status: 503 }));
    });
    const r = await getCryptoPrice(
      'ETH',
      new Date('2026-08-30T00:00:00.000Z'),
      'What was the price of ETH on August 28, 2026?',
    );
    expect(r.verdict).toBe('unavailable');
    expect(r.as_of_date).toBe('2026-08-28');
    expect(r.reason).toMatch(/historical price feed did not respond/i);
    expect(requested.some((url) => url.includes('/prices/current/'))).toBe(false);
  });

  it('still reports a genuinely unknown asset as not_found', async () => {
    const r = await getCryptoPrice('definitelynotarealassetxyz123');
    expect(r.verdict).toBe('not_found');
  });
});
