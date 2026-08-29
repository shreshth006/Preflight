import { isAddress, isTxHash } from '../chain/rpc.js';

/**
 * Router-supplied parameters arrive under whatever key the Engine chose, and
 * daemon traffic is free text, so every intent reads its inputs the same
 * tolerant way SSL_VERIFICATION reads a hostname: preferred keys first, then
 * any string value, then a pattern match over the text.
 */
export interface RequestValues {
  get(keys: string[]): string | undefined;
  all(): string[];
  text(): string;
}

export function valuesFromQuery(query: URLSearchParams): RequestValues {
  const entries = [...query.entries()];
  return {
    get(keys) {
      for (const key of keys) {
        const found = entries.find(([k]) => k.toLowerCase() === key);
        if (found?.[1]?.trim()) return found[1].trim();
      }
      return undefined;
    },
    all: () => entries.map(([, v]) => v).filter(Boolean),
    text: () => entries.map(([, v]) => v).join(' '),
  };
}

function flatten(value: unknown, depth = 0): Array<[string, string]> {
  if (depth > 4) return [];
  if (typeof value === 'string') return [['', value]];
  if (Array.isArray(value)) return value.flatMap((v) => flatten(v, depth + 1));
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      typeof v === 'string' ? [[k.toLowerCase(), v] as [string, string]] : flatten(v, depth + 1),
    );
  }
  return [];
}

export function valuesFromBody(body: unknown): RequestValues {
  const entries = flatten(body);
  return {
    get(keys) {
      for (const key of keys) {
        const found = entries.find(([k]) => k === key);
        if (found?.[1]?.trim()) return found[1].trim();
      }
      return undefined;
    },
    all: () => entries.map(([, v]) => v).filter(Boolean),
    text: () => entries.map(([, v]) => v).join(' '),
  };
}

const ADDRESS_PATTERN = /\b0x[0-9a-fA-F]{40}\b/;
const TXHASH_PATTERN = /\b0x[0-9a-fA-F]{64}\b/;
const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>]+/i;

export function findAddress(values: RequestValues): string | undefined {
  const direct = values.get(['address', 'wallet', 'account', 'holder', 'owner', 'addr']);
  if (direct && isAddress(direct)) return direct;
  for (const value of values.all()) {
    const match = ADDRESS_PATTERN.exec(value);
    if (match) return match[0];
  }
  return undefined;
}

const ENS_PATTERN = /\b([a-z0-9-_]+(?:\.[a-z0-9-_]+)*\.eth)\b/i;

/** An ENS name given directly, or named inside a free-text question. */
export function findEnsName(values: RequestValues): string | undefined {
  const direct = values.get(['ens', 'ens_name', 'name', 'address', 'wallet', 'account']);
  if (direct && ENS_PATTERN.test(direct)) return ENS_PATTERN.exec(direct)?.[1];
  for (const value of values.all()) {
    const match = ENS_PATTERN.exec(value);
    if (match) return match[1];
  }
  return undefined;
}

export function findTxHash(values: RequestValues): string | undefined {
  const direct = values.get(['hash', 'tx', 'tx_hash', 'txhash', 'transaction', 'transaction_hash']);
  if (direct && isTxHash(direct)) return direct;
  for (const value of values.all()) {
    const match = TXHASH_PATTERN.exec(value);
    if (match) return match[0];
  }
  return undefined;
}

export function findUrl(values: RequestValues): string | undefined {
  const direct = values.get([
    'url',
    'link',
    'target',
    'uri',
    'address',
    'site',
    'website',
    'domain',
  ]);
  if (direct) return direct;
  for (const value of values.all()) {
    const match = URL_PATTERN.exec(value);
    if (match) return match[0];
  }
  return undefined;
}

export function findChain(values: RequestValues): string | undefined {
  return values.get(['chain', 'network', 'chain_id', 'chainid', 'blockchain']);
}

export function findSubject(values: RequestValues): string | undefined {
  return values.get([
    'asset',
    'coin',
    'ticker',
    'protocol',
    'project',
    'name',
    'slug',
    'query',
    'q',
    'symbol',
    'token',
    'chain',
    'input',
    'text',
    'question',
  ]);
}
