import { afterEach, describe, expect, it, vi } from 'vitest';
import { getExchangeRate } from '../../src/intents/currencyExchange.js';

afterEach(() => vi.unstubAllGlobals());

describe('historical currency exchange', () => {
  it('uses the requested date and does not turn its day into an amount', async () => {
    vi.stubGlobal('fetch', (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith('https://open.er-api.com/')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              result: 'success',
              rates: { USD: 1, JPY: 160 },
              time_last_update_utc: 'Sun, 30 Aug 2026 00:02:31 +0000',
            }),
            { status: 200 },
          ),
        );
      }
      expect(url).toBe('https://api.frankfurter.dev/v1/2026-08-28?base=USD&symbols=JPY');
      return Promise.resolve(
        new Response(JSON.stringify({ date: '2026-08-28', rates: { JPY: 159.68 } }), {
          status: 200,
        }),
      );
    });

    const result = await getExchangeRate(
      '2026-08-28 USD JPY',
      new Date('2026-08-30T00:00:00.000Z'),
    );

    expect(result.amount).toBe(1);
    expect(result.rate).toBe(159.68);
    expect(result.as_of).toBe('2026-08-28T00:00:00.000Z');
    expect(result.source).toBe('Frankfurter historical reference rates');
    expect(result.reason).toBe(
      'On August 28, 2026, the USD/JPY exchange rate was 159.68: 1 USD was worth 159.68 JPY. This is the Frankfurter historical reference rate.',
    );
  });

  it('does not silently substitute a current rate when historical data fails', async () => {
    vi.stubGlobal('fetch', (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith('https://open.er-api.com/')) {
        return Promise.resolve(
          new Response(JSON.stringify({ result: 'success', rates: { USD: 1, JPY: 160 } }), {
            status: 200,
          }),
        );
      }
      return Promise.resolve(new Response('{}', { status: 503 }));
    });

    const result = await getExchangeRate('2026-08-28 USD JPY');
    expect(result.verdict).toBe('unavailable');
    expect(result.rate).toBeNull();
    expect(result.reason).toContain('No current rate is substituted');
  });
});
