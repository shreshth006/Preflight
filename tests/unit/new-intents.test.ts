import { describe, expect, it } from 'vitest';
import { amountIn, currenciesIn } from '../../src/intents/currencyExchange.js';
import { ipIn, reservedBlock } from '../../src/intents/ipGeolocation.js';
import { tickerFrom } from '../../src/intents/stockPrice.js';

const KNOWN = new Set(['USD', 'EUR', 'GBP', 'INR', 'JPY', 'CAD', 'CHF']);

describe('currenciesIn', () => {
  it('reads ISO codes in the order they appear', () => {
    expect(currenciesIn('rate from USD to EUR', KNOWN)).toEqual(['USD', 'EUR']);
  });

  it('reads currency names, preferring the longer match', () => {
    // "canadian dollar" must not be read as "dollar".
    expect(currenciesIn('canadian dollar to euro', KNOWN)).toEqual(['CAD', 'EUR']);
  });

  it('ignores three-letter words the feed does not list', () => {
    expect(currenciesIn('what is the rate for USD and EUR', KNOWN)).toEqual(['USD', 'EUR']);
  });
});

describe('amountIn', () => {
  it('attaches the amount to the currency it qualifies', () => {
    // Ordering by first appearance quoted INR/USD, the inverse of the question.
    expect(amountIn('How many Indian rupees is 100 US dollars worth?', KNOWN)).toEqual({
      amount: 100,
      base: 'USD',
    });
  });

  it('handles a bare code after the figure', () => {
    expect(amountIn('Convert 250 EUR to yen', KNOWN)).toEqual({ amount: 250, base: 'EUR' });
  });

  it('defaults to one unit when no figure is given', () => {
    expect(amountIn('USD to EUR rate', KNOWN)).toEqual({ amount: 1, base: null });
  });

  it('does not treat an ISO calendar date as a conversion amount', () => {
    expect(amountIn('2026-08-28 USD JPY', KNOWN)).toEqual({ amount: 1, base: null });
  });
});

describe('ipIn', () => {
  it('finds an address inside a question', () => {
    expect(ipIn('Where is 8.8.8.8 located?')).toBe('8.8.8.8');
  });

  it('rejects a dotted number that is not an address', () => {
    expect(ipIn('version 999.1.1.1 released')).not.toBe('999.1.1.1');
  });

  it('returns null when there is no address', () => {
    expect(ipIn('Where is Google located?')).toBeNull();
  });
});

describe('tickerFrom', () => {
  it('prefers a parenthesised ticker', () => {
    expect(tickerFrom('What is the price of Apple (AAPL)?')).toBe('AAPL');
  });

  it('maps a company name', () => {
    expect(tickerFrom('How is Tesla trading today?')).toBe('TSLA');
  });

  it('does not read a common uppercase word as a ticker', () => {
    expect(tickerFrom('WHY did the stock move')).not.toBe('WHY');
  });
});

describe('reservedBlock', () => {
  it('classifies the documentation ranges that are not lookup failures', () => {
    // 192.0.2.1 appeared in a live question and we reported it as a temporary
    // upstream outage; the ground truth calls it TEST-NET-1, reserved.
    expect(reservedBlock('192.0.2.1')?.name).toContain('TEST-NET-1');
    expect(reservedBlock('198.51.100.7')?.name).toContain('TEST-NET-2');
    expect(reservedBlock('203.0.113.9')?.name).toContain('TEST-NET-3');
  });

  it('classifies private, loopback and link-local space', () => {
    expect(reservedBlock('10.1.2.3')?.rfc).toBe('RFC 1918');
    expect(reservedBlock('172.16.0.1')?.rfc).toBe('RFC 1918');
    expect(reservedBlock('172.32.0.1')).toBeNull(); // outside the /12
    expect(reservedBlock('127.0.0.1')?.rfc).toBe('RFC 1122');
    expect(reservedBlock('169.254.1.1')?.rfc).toBe('RFC 3927');
  });

  it('leaves routable addresses alone', () => {
    expect(reservedBlock('8.8.8.8')).toBeNull();
    expect(reservedBlock('1.1.1.1')).toBeNull();
    expect(reservedBlock('192.0.3.1')).toBeNull(); // adjacent to TEST-NET-1
  });

  it('classifies IPv6 reserved space', () => {
    expect(reservedBlock('::1')?.rfc).toBe('RFC 4291');
    expect(reservedBlock('2001:db8::1')?.rfc).toBe('RFC 3849');
    expect(reservedBlock('2606:4700::1111')).toBeNull();
  });
});
