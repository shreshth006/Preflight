import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChainInfo } from '../../src/chain/rpc.js';
import { lookupTransaction } from '../../src/intents/onchainTx.js';

const HASH = `0x${'1'.repeat(64)}`;
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

function stubRpc(receiptStatus: string | undefined): void {
  vi.stubGlobal('fetch', (_input: string | URL | Request, init?: RequestInit) => {
    if (typeof init?.body !== 'string') throw new TypeError('expected a string RPC request body');
    const request = JSON.parse(init.body) as { method: string };
    const result: Record<string, unknown> = {
      eth_getTransactionByHash: {
        blockNumber: '0x64',
        from: `0x${'2'.repeat(40)}`,
        to: `0x${'3'.repeat(40)}`,
        value: '0x0',
        nonce: '0x1',
        input: '0x',
      },
      eth_getTransactionReceipt: {
        blockNumber: '0x64',
        gasUsed: '0x5208',
        effectiveGasPrice: '0x3b9aca00',
        ...(receiptStatus === undefined ? {} : { status: receiptStatus }),
      },
      eth_blockNumber: '0x64',
    };
    return Promise.resolve(
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: result[request.method] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
}

describe('transaction outcome accuracy', () => {
  it('counts the inclusion block as the first confirmation', async () => {
    stubRpc('0x1');
    const result = await lookupTransaction(HASH, CHAIN);
    expect(result.block_number).toBe(100);
    expect(result.confirmations).toBe(1);
    expect(result.verdict).toBe('success');
  });

  it('does not call a mined transaction failed when the receipt has no status', async () => {
    stubRpc(undefined);
    const result = await lookupTransaction(HASH, CHAIN);
    expect(result.verdict).toBe('unavailable');
    expect(result.reason).toContain('status unavailable');
    expect(result.reason).not.toMatch(/reverted|failed/);
  });

  it('does not call an RPC outage evidence that a transaction was not found', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('simulated RPC outage')));
    const result = await lookupTransaction(HASH, CHAIN);
    expect(result.verdict).toBe('unavailable');
    expect(result.reason).toMatch(/RPC endpoint failed to answer/i);
    expect(result.reason).not.toMatch(/^No transaction/);
  });
});
