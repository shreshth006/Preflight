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

/**
 * A hex string that was clearly meant to be an EVM address but is not one.
 *
 * The recurring WALLET_BALANCE_CHECK question carries
 * `%[0x1234567890abcdef1234567890abcdef123456789]%` -- 41 hex characters
 * wrapped in a placeholder marker, where a valid address is 40. We rejected
 * the whole request for it and scored zero on the highest-value question in
 * the intent. It is better to recognise the intent and say what is true of
 * it: no account exists at a malformed address, so its balance is zero.
 */
export function findMalformedAddress(values: RequestValues): string | undefined {
  for (const value of values.all()) {
    const m = /0x[0-9a-fA-F]{4,}/.exec(value);
    if (m && !isAddress(m[0])) return m[0];
  }
  return undefined;
}

export function findAddress(values: RequestValues): string | undefined {
  const direct = values.get(['address', 'wallet', 'account', 'holder', 'owner', 'addr']);
  if (direct && isAddress(direct)) return direct;
  for (const value of values.all()) {
    // Placeholder markers such as %[0x...]% wrap the address in some
    // router-supplied questions.
    const match = ADDRESS_PATTERN.exec(value.replace(/%\[|\]%/g, ' '));
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

/**
 * Resolve the protocol/chain named by a TVL question without treating the
 * whole natural-language question as a DefiLlama slug.
 */
export function findTvlSubject(values: RequestValues): string | undefined {
  const direct = values.get(['protocol', 'project', 'slug', 'name']);
  if (direct) return direct;

  for (const value of values.all()) {
    const text = value.trim();
    const protocol = /\b(?:in|of|for)\s+(?:the\s+)?(.+?)\s+protocol\b/i.exec(text)?.[1];
    if (protocol?.trim()) return protocol.trim();

    const tvl =
      /\b(?:tvl|total\s+value\s+locked)\s+(?:in|of|for)\s+(?:the\s+)?(.+?)(?=\s+(?:on|across)\s+(?:the\s+)?[a-z0-9-]+(?:\s+(?:chain|network))?|\s+as\s+of\b|[?.!,]|$)/i.exec(
        text,
      )?.[1];
    if (tvl?.trim()) return tvl.replace(/\s+protocol$/i, '').trim();

    // A direct query such as `aave-v3` remains a valid subject. Question-like
    // prose is not returned wholesale because it would become an invalid slug.
    if (!/\s/.test(text) && /^[a-z0-9._-]+$/i.test(text)) return text;
  }
  return undefined;
}
