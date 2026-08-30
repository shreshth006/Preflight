import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChainInfo } from '../../src/chain/rpc.js';
import {
  contextualizeWalletBalance,
  describeMalformedAddress,
  getWalletBalance,
} from '../../src/intents/walletBalance.js';

const ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const CHAIN: ChainInfo = {
  key: 'test-chain',
  name: 'Test Chain',
  chainId: 123,
  symbol: 'TST',
  decimals: 18,
  rpcUrls: ['https://rpc.test.invalid'],
  explorer: 'https://explorer.test.invalid',
};

afterEach(() => vi.unstubAllGlobals());

describe('wallet balance scorer summary', () => {
  it('leads with address, amount, and chain while keeping peripheral data structured', async () => {
    const results: Record<string, string> = {
      eth_getBalance: '0xde0b6b3a7640000',
      eth_getTransactionCount: '0x2a',
      eth_getCode: '0x',
      eth_blockNumber: '0xabcdef',
    };
    vi.stubGlobal('fetch', (_input: string | URL | Request, init?: RequestInit) => {
      const bodyText = typeof init?.body === 'string' ? init.body : '';
      const body = JSON.parse(bodyText) as { method: string };
      return Promise.resolve(
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: results[body.method] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });

    const result = await getWalletBalance(ADDRESS, CHAIN, new Date('2026-08-29T00:00:00.000Z'));

    // Address, amount, chain and the RPC method are the measured truth shape;
    // account metadata remains structured rather than diluting the prose.
    expect(result.reason).toContain(ADDRESS);
    expect(result.reason).toContain('1 TST');
    expect(result.reason).toContain('on Test Chain');
    expect(result.reason).toContain('eth_getBalance RPC method');
    expect(result.reason).not.toContain('1000000000000000000 wei');
    expect(result.reason).not.toContain('chain ID 123');
    expect(result.reason).not.toMatch(/account|ERC-20|outbound transaction|observed at block/i);
    expect(result.transaction_count).toBe(42);
    expect(result.block_number).toBe(11_259_375);
  });

  it('does not present a latest-block result as a past-dated balance', async () => {
    const results: Record<string, string> = {
      eth_getBalance: '0xde0b6b3a7640000',
      eth_getTransactionCount: '0x2a',
      eth_getCode: '0x',
      eth_blockNumber: '0xabcdef',
    };
    vi.stubGlobal('fetch', (_input: string | URL | Request, init?: RequestInit) => {
      const bodyText = typeof init?.body === 'string' ? init.body : '';
      const body = JSON.parse(bodyText) as { method: string };
      return Promise.resolve(
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: results[body.method] }), {
          status: 200,
        }),
      );
    });
    const current = await getWalletBalance(ADDRESS, CHAIN, new Date('2026-08-30T00:00:00.000Z'));
    const result = contextualizeWalletBalance(
      current,
      'What was the balance as of August 26, 2026?',
    );
    expect(result.balance).toBe('1');
    expect(result.reason).toContain('as of August 26, 2026');
    expect(result.reason).toContain('corresponding historical block');
    expect(result.reason).toContain('latest-block balance');
    expect(result.reason).not.toContain('balance of 1 TST');
  });

  it('states the zero RPC result in the truth-shaped summary', async () => {
    const results: Record<string, string> = {
      eth_getBalance: '0x0',
      eth_getTransactionCount: '0x0',
      eth_getCode: '0x',
      eth_blockNumber: '0xabcdef',
    };
    vi.stubGlobal('fetch', (_input: string | URL | Request, init?: RequestInit) => {
      const bodyText = typeof init?.body === 'string' ? init.body : '';
      const body = JSON.parse(bodyText) as { method: string };
      return Promise.resolve(
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: results[body.method] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });

    const result = await getWalletBalance(ADDRESS, CHAIN, new Date('2026-08-29T00:00:00.000Z'));

    expect(result.reason).toContain('native-coin balance of 0 TST');
    expect(result.reason).toContain('RPC result was 0x0, indicating a zero balance');
    expect(result.verdict).toBe('empty');
  });
});

describe('malformed address handling', () => {
  it('answers a hex string that is not an address instead of refusing it', () => {
    // The recurring question in this intent carries
    // %[0x1234567890abcdef1234567890abcdef123456789]% -- 41 hex characters
    // where an address has 40 -- and we returned INVALID_INPUT for it,
    // a guaranteed zero on the intent's highest-scoring question.
    const r = describeMalformedAddress('0x1234567890abcdef1234567890abcdef123456789', CHAIN);
    expect(r.verdict).toBe('empty');
    expect(r.balance).toBe('0');
    expect(r.reason).toContain('balance of 0 TST');
    expect(r.reason).toContain('41 hexadecimal characters');
    expect(r.reason).toContain('40');
  });
});
