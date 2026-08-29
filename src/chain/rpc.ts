// Public, keyless JSON-RPC endpoints. Two per chain so a single provider
// outage does not take an intent offline: a miner that fails to answer scores
// as if it never answered at all.
export interface ChainInfo {
  key: string;
  name: string;
  chainId: number;
  symbol: string;
  decimals: number;
  rpcUrls: string[];
  explorer: string;
}

export const CHAINS: Record<string, ChainInfo> = {
  ethereum: {
    key: 'ethereum',
    name: 'Ethereum',
    chainId: 1,
    symbol: 'ETH',
    decimals: 18,
    rpcUrls: ['https://ethereum-rpc.publicnode.com', 'https://eth.llamarpc.com'],
    explorer: 'https://etherscan.io',
  },
  base: {
    key: 'base',
    name: 'Base',
    chainId: 8453,
    symbol: 'ETH',
    decimals: 18,
    rpcUrls: ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'],
    explorer: 'https://basescan.org',
  },
  arbitrum: {
    key: 'arbitrum',
    name: 'Arbitrum One',
    chainId: 42_161,
    symbol: 'ETH',
    decimals: 18,
    rpcUrls: ['https://arbitrum-one-rpc.publicnode.com', 'https://arb1.arbitrum.io/rpc'],
    explorer: 'https://arbiscan.io',
  },
  optimism: {
    key: 'optimism',
    name: 'OP Mainnet',
    chainId: 10,
    symbol: 'ETH',
    decimals: 18,
    rpcUrls: ['https://optimism-rpc.publicnode.com', 'https://mainnet.optimism.io'],
    explorer: 'https://optimistic.etherscan.io',
  },
  polygon: {
    key: 'polygon',
    name: 'Polygon PoS',
    chainId: 137,
    symbol: 'POL',
    decimals: 18,
    rpcUrls: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon-rpc.com'],
    explorer: 'https://polygonscan.com',
  },
  'base-sepolia': {
    key: 'base-sepolia',
    name: 'Base Sepolia',
    chainId: 84_532,
    symbol: 'ETH',
    decimals: 18,
    rpcUrls: ['https://sepolia.base.org'],
    explorer: 'https://sepolia.basescan.org',
  },
};

const CHAIN_ALIASES: Record<string, string> = {
  eth: 'ethereum',
  mainnet: 'ethereum',
  'ethereum-mainnet': 'ethereum',
  erc20: 'ethereum',
  l1: 'ethereum',
  'base-mainnet': 'base',
  coinbase: 'base',
  arb: 'arbitrum',
  'arbitrum-one': 'arbitrum',
  op: 'optimism',
  'op-mainnet': 'optimism',
  matic: 'polygon',
  'polygon-pos': 'polygon',
  sepolia: 'base-sepolia',
  basesepolia: 'base-sepolia',
};

/** Resolves a chain name or alias, or undefined when it is not one we serve. */
export function lookupChain(value: string | undefined): ChainInfo | undefined {
  if (!value) return undefined;
  const key = value.trim().toLowerCase().replace(/\s+/g, '-');
  const direct = CHAINS[key];
  if (direct) return direct;
  const aliased = CHAIN_ALIASES[key];
  if (aliased && CHAINS[aliased]) return CHAINS[aliased];
  return undefined;
}

/**
 * Ethereum is the right default when a question names no chain at all, but
 * silently defaulting a chain we do not serve would answer a question that was
 * never asked — "gas on Avalanche" returning Ethereum's gas price. Callers
 * that need to tell those cases apart use `lookupChain`.
 */
export function resolveChain(value: string | undefined): ChainInfo {
  return lookupChain(value) ?? (CHAINS.ethereum as ChainInfo);
}

export const SUPPORTED_CHAINS = Object.values(CHAINS)
  .map((c) => c.name)
  .join(', ');

/** Finds a chain named anywhere in free text, without defaulting. */
export function chainFromText(text: string): ChainInfo | undefined {
  const lowered = text.toLowerCase();
  const names = [...Object.keys(CHAINS), ...Object.keys(CHAIN_ALIASES)].sort(
    (a, b) => b.length - a.length,
  );
  for (const name of names) {
    if (new RegExp(`\\b${name.replace(/-/g, '[- ]?')}\\b`, 'i').test(lowered)) {
      return resolveChain(name);
    }
  }
  return undefined;
}

interface RpcError {
  code?: number;
  message?: string;
}

export async function rpcCall<T>(
  chain: ChainInfo,
  method: string,
  params: unknown[],
  timeoutMs = 8_000,
  /** Treat a null result as "ask the next endpoint" rather than an answer. */
  requireNonNull = false,
): Promise<T> {
  let lastError: unknown;
  for (const url of chain.rpcUrls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
      const payload = (await response.json()) as { result?: T; error?: RpcError };
      if (payload.error) throw new Error(payload.error.message ?? 'rpc error');
      if (payload.result === undefined) throw new Error('rpc response contained no result');
      // A null result is a well-formed answer, so the failover loop below does
      // not treat it as an error. For lookups where null means "I do not have
      // this yet" -- a receipt on a node lagging the chain head -- that answer
      // is worth re-asking elsewhere before it is believed.
      if (payload.result === null && requireNonNull && url !== chain.rpcUrls.at(-1)) {
        lastError = new Error(`${url} returned null`);
        continue;
      }
      return payload.result;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('all rpc endpoints failed');
}

export function hexToBigInt(value: string): bigint {
  return BigInt(value);
}

/** Formats a wei-denominated value with `maxFractionDigits`, trimming zeros. */
export function formatUnits(value: bigint, decimals: number, maxFractionDigits = 6): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = abs % base;
  if (fraction === 0n) return `${negative ? '-' : ''}${whole.toString()}`;
  const digits = fraction.toString().padStart(decimals, '0').slice(0, maxFractionDigits);
  const trimmed = digits.replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole.toString()}${trimmed ? `.${trimmed}` : ''}`;
}

export function isAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value.trim());
}

export function isTxHash(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value.trim());
}
