import { describe, expect, it } from 'vitest';
import {
  chainFromText,
  formatUnits,
  isAddress,
  isTxHash,
  lookupChain,
  resolveChain,
} from '../../src/chain/rpc.js';
import { namehash } from '../../src/chain/ens.js';
import {
  findAddress,
  findChain,
  findEnsName,
  findTxHash,
  findTvlSubject,
  findUrl,
  valuesFromBody,
  valuesFromQuery,
} from '../../src/telegraph/params.js';
import { formatUsd } from '../../src/intents/tvl.js';
import { medianPriorityFee } from '../../src/intents/gasPrice.js';

const q = (search: string): URLSearchParams => new URLSearchParams(search);

describe('chain resolution', () => {
  it('resolves canonical names, aliases, and an unknown default', () => {
    expect(resolveChain('base').chainId).toBe(8453);
    expect(resolveChain('ETH').chainId).toBe(1);
    expect(resolveChain('arb').chainId).toBe(42_161);
    expect(resolveChain('matic').chainId).toBe(137);
    expect(resolveChain('nonsense').chainId).toBe(1);
    expect(resolveChain(undefined).chainId).toBe(1);
  });

  it('finds a chain named inside a question, without defaulting', () => {
    expect(chainFromText('what is gas on arbitrum right now')?.key).toBe('arbitrum');
    expect(chainFromText('check the base network')?.key).toBe('base');
    expect(chainFromText('no chain named here')).toBeUndefined();
  });

  it('every configured chain has at least one RPC endpoint', () => {
    for (const key of ['ethereum', 'base', 'arbitrum', 'optimism', 'polygon', 'base-sepolia']) {
      expect(resolveChain(key).rpcUrls.length).toBeGreaterThan(0);
    }
  });
});

describe('unit formatting', () => {
  it('formats wei without floating-point drift and trims zeros', () => {
    expect(formatUnits(2_000_000_000_000_000n, 18, 8)).toBe('0.002');
    expect(formatUnits(0n, 18)).toBe('0');
    expect(formatUnits(10n ** 18n, 18)).toBe('1');
    // 6 gwei, the value Base Sepolia was quoting during development.
    expect(formatUnits(6_000_000n, 9, 4)).toBe('0.006');
  });

  it('formats USD with magnitude words', () => {
    expect(formatUsd(18_195_729_011)).toBe('$18.20 billion');
    expect(formatUsd(5_512_000)).toBe('$5.51 million');
    expect(formatUsd(42)).toBe('$42.00');
  });
});

describe('gas fee history', () => {
  it('uses the deterministic median reward rather than an unstable RPC suggestion', () => {
    expect(
      medianPriorityFee({
        reward: [['0x64'], ['0x1'], ['0x5'], ['0x3'], ['0x7']],
      }),
    ).toBe(5n);
    expect(medianPriorityFee({ reward: [['0x2'], ['0x8']] })).toBe(5n);
    expect(medianPriorityFee({ reward: [] })).toBeNull();
    expect(medianPriorityFee(null)).toBeNull();
  });
});

describe('identifier validation', () => {
  it('separates addresses from transaction hashes', () => {
    const address = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
    const hash = `0x${'a'.repeat(64)}`;
    expect(isAddress(address)).toBe(true);
    expect(isAddress(hash)).toBe(false);
    expect(isTxHash(hash)).toBe(true);
    expect(isTxHash(address)).toBe(false);
    expect(isAddress('0x123')).toBe(false);
  });
});

describe('tolerant parameter extraction', () => {
  const address = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
  const hash = `0x${'b'.repeat(64)}`;

  it('reads values from preferred keys', () => {
    expect(findAddress(valuesFromQuery(q(`address=${address}`)))).toBe(address);
    expect(findTxHash(valuesFromQuery(q(`tx_hash=${hash}`)))).toBe(hash);
    expect(findChain(valuesFromQuery(q('network=base')))).toBe('base');
    expect(findUrl(valuesFromQuery(q('url=https://example.com')))).toBe('https://example.com');
  });

  it('recovers values embedded in a free-text question', () => {
    expect(findAddress(valuesFromQuery(q(`q=how much does ${address} hold`)))).toBe(address);
    expect(findTxHash(valuesFromBody({ question: `did ${hash} succeed on base` }))).toBe(hash);
    expect(findUrl(valuesFromBody({ text: 'please scan https://example.com/a?b=1 now' }))).toBe(
      'https://example.com/a?b=1',
    );
  });

  it('does not mistake a transaction hash for an address', () => {
    // A 64-hex hash contains no 40-hex substring bounded by word breaks, so
    // address extraction must not match inside it.
    expect(findAddress(valuesFromQuery(q(`q=${hash}`)))).toBeUndefined();
  });

  it('returns undefined when nothing usable is present', () => {
    expect(findAddress(valuesFromQuery(q('q=hello world')))).toBeUndefined();
    expect(findTxHash(valuesFromBody({}))).toBeUndefined();
  });

  it('extracts a TVL subject from router-shaped natural language', () => {
    expect(
      findTvlSubject(
        valuesFromQuery(
          q(
            'query=What+is+the+current+total+value+locked+%28TVL%29+in+the+Aave+V3+protocol+on+the+Ethereum+chain%3F',
          ),
        ),
      ),
    ).toBe('Aave V3');
    expect(findTvlSubject(valuesFromQuery(q('query=What+is+the+TVL+of+Base%3F')))).toBe('Base');
    expect(findTvlSubject(valuesFromBody({ protocol: 'lido' }))).toBe('lido');
  });
});

describe('ENS', () => {
  it('computes the EIP-137 namehash vectors', () => {
    expect(namehash('eth')).toBe(
      '0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae',
    );
    // The empty name is the zero node.
    expect(namehash('')).toBe(`0x${'0'.repeat(64)}`);
  });

  it('finds an ENS name in a question and ignores non-names', () => {
    expect(findEnsName(valuesFromQuery(q('q=how much does vitalik.eth hold')))).toBe('vitalik.eth');
    expect(findEnsName(valuesFromBody({ address: 'nick.eth' }))).toBe('nick.eth');
    expect(findEnsName(valuesFromQuery(q('q=check example.com')))).toBeUndefined();
  });
});

describe('unsupported chains', () => {
  it('resolves known names but reports unknown ones as unknown', () => {
    expect(lookupChain('base')?.chainId).toBe(8453);
    expect(lookupChain('arb')?.chainId).toBe(42_161);
    expect(lookupChain('sepolia')?.chainId).toBe(11_155_111);
    expect(lookupChain('base-sepolia')?.chainId).toBe(84_532);
    // Silently defaulting these to Ethereum would answer a question that was
    // never asked, e.g. "gas on Avalanche" quoting Ethereum's gas price.
    expect(lookupChain('avalanche')).toBeUndefined();
    expect(lookupChain('solana')).toBeUndefined();
    expect(lookupChain('nonsense-chain')).toBeUndefined();
    expect(lookupChain(undefined)).toBeUndefined();
  });

  it('still defaults to ethereum when no chain is named at all', () => {
    expect(resolveChain(undefined).chainId).toBe(1);
  });
});
