import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChainInfo } from '../../src/chain/rpc.js';
import { getWalletBalance } from '../../src/intents/walletBalance.js';

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

    expect(result.reason).toContain(`${ADDRESS} on Test Chain (chain ID 123)`);
    expect(result.reason).toContain('1 TST');
    expect(result.reason).toContain('1000000000000000000 wei');
    expect(result.reason).not.toMatch(/outbound transaction|observed at block/i);
    expect(result.transaction_count).toBe(42);
    expect(result.block_number).toBe(11_259_375);
  });
});
