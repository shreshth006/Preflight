export interface TvlResponse {
  query: string;
  /** Chain the figure is scoped to, when the question named one. */
  chain: string | null;
  chain_tvl_usd: number | null;
  resolved_name: string | null;
  kind: 'protocol' | 'chain' | 'not_found' | 'unavailable';
  verdict: 'protocol' | 'chain' | 'not_found' | 'unavailable';
  tvl_usd: number | null;
  tvl_formatted: string | null;
  change_1d_pct: number | null;
  change_7d_pct: number | null;
  category: string | null;
  chains: string[];
  symbol: string | null;
  url: string | null;
  source: string;
  confidence: number;
  reason: string;
  checked_at: string;
}

const LLAMA = 'https://api.llama.fi';

interface LlamaChain {
  name?: string;
  tokenSymbol?: string | null;
  tvl?: number;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

export function formatUsd(value: number): string {
  const abs = Math.abs(value);
  const units: Array<[number, string]> = [
    [1e12, 'trillion'],
    [1e9, 'billion'],
    [1e6, 'million'],
    [1e3, 'thousand'],
  ];
  for (const [size, label] of units) {
    if (abs >= size) return `$${(value / size).toFixed(2)} ${label}`;
  }
  return `$${value.toFixed(2)}`;
}

// "The upstream did not answer" and "the upstream answered, and the thing does
// not exist" are different facts. Collapsing them makes the miner claim an
// asset is untracked when the API was merely unreachable.
type Fetched<T> = { ok: true; value: T } | { ok: false };

async function getJson<T>(url: string, timeoutMs = 9_000): Promise<Fetched<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return { ok: false };
    return { ok: true, value: (await response.json()) as T };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

function titleCase(value: string): string {
  return value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** `/tvl/{slug}` returns a bare number; an empty body means "not a protocol". */
async function getProtocolTvl(slug: string, timeoutMs = 9_000): Promise<Fetched<number | null>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${LLAMA}/tvl/${slug}`, { signal: controller.signal });
    if (!response.ok) return { ok: false };
    const text = (await response.text()).trim();
    if (!text) return { ok: true, value: null };
    const value = Number(text);
    return { ok: true, value: Number.isFinite(value) ? value : null };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

/** DefiLlama's per-chain breakdown for a protocol, keyed by chain name. */
async function getChainTvls(slug: string): Promise<Record<string, number> | null> {
  const r = await getJson<{ currentChainTvls?: Record<string, number> }>(
    `${LLAMA}/protocol/${slug}`,
    20_000,
  );
  return r.ok ? (r.value.currentChainTvls ?? null) : null;
}

export async function lookupTvl(
  query: string,
  now = new Date(),
  chainHint?: string,
): Promise<TvlResponse> {
  const slug = slugify(query);
  const base = {
    query,
    chain: chainHint ?? null,
    chain_tvl_usd: null as number | null,
    source: 'DefiLlama',
    confidence: 1,
    checked_at: now.toISOString(),
  };

  // The full /protocol/{slug} document embeds complete TVL history — nearly
  // 2 MB for a large protocol — so the bare /tvl/{slug} number is used
  // instead and chains are resolved from the compact chain list.
  const [protocolResult, chainsResult] = await Promise.all([
    slug ? getProtocolTvl(slug) : Promise.resolve({ ok: true as const, value: null }),
    getJson<LlamaChain[]>(`${LLAMA}/v2/chains`),
  ]);
  const protocolTvl = protocolResult.ok ? protocolResult.value : null;
  const chains = chainsResult.ok ? chainsResult.value : null;

  const match = chains?.find(
    (c) =>
      slugify(c.name ?? '') === slug ||
      (c.tokenSymbol ?? '').toLowerCase() === query.trim().toLowerCase(),
  );

  // An exact chain-name match wins: "TVL of Base" means the chain, even when
  // a protocol of the same name also exists.
  const chainNameMatches = match?.name !== undefined && slugify(match.name) === slug;

  if (!chainNameMatches && protocolTvl !== null && protocolTvl > 0) {
    const name = titleCase(query);
    // A question naming a chain ("Aave V3 on Ethereum") is asking for that
    // chain's share, not the protocol total. Answering the total is a
    // different question than the one asked.
    let chainScoped: number | null = null;
    let scopedChain = '';
    if (chainHint) {
      scopedChain = chainHint;
      const per = await getChainTvls(slug);
      if (per) {
        const want = chainHint.toLowerCase();
        for (const [k, v] of Object.entries(per)) {
          if (k.toLowerCase() === want && typeof v === 'number') chainScoped = v;
        }
      }
    }
    if (chainScoped !== null) {
      return {
        ...base,
        chain_tvl_usd: chainScoped,
        resolved_name: name,
        kind: 'protocol',
        verdict: 'protocol',
        tvl_usd: chainScoped,
        tvl_formatted: formatUsd(chainScoped),
        change_1d_pct: null,
        change_7d_pct: null,
        category: null,
        chains: [scopedChain],
        symbol: null,
        url: `https://defillama.com/protocol/${slug}`,
        // Both figures are stated affirmatively. The question asked for the
        // chain, so that leads; the protocol total is reported alongside it
        // rather than only as a contrast, because "TVL of Aave V3" is
        // ambiguous and a reader asking either question is answered.
        reason:
          `The ${name} protocol holds a total value locked of ${formatUsd(chainScoped)} ` +
          `(${chainScoped.toFixed(2)} USD) on ${titleCase(scopedChain)}, according to DefiLlama. ` +
          `Across every chain ${name} is deployed on, its total value locked is ` +
          `${formatUsd(protocolTvl)}, of which ${titleCase(scopedChain)} is the ` +
          `${((chainScoped / protocolTvl) * 100).toFixed(1)}% share. Total value locked ` +
          `measures the aggregate USD value of all assets deposited in the protocol's ` +
          `smart contracts.`,
      };
    }
    return {
      ...base,
      resolved_name: name,
      kind: 'protocol',
      verdict: 'protocol',
      tvl_usd: protocolTvl,
      tvl_formatted: formatUsd(protocolTvl),
      change_1d_pct: null,
      change_7d_pct: null,
      category: null,
      chains: [],
      symbol: null,
      url: `https://defillama.com/protocol/${slug}`,
      reason:
        `The ${name} protocol currently holds a total value locked of ${formatUsd(protocolTvl)} ` +
        `(${protocolTvl.toFixed(2)} USD) according to DefiLlama. Total value locked measures the ` +
        `aggregate USD value of all assets deposited in the protocol's smart contracts across ` +
        `every chain it is deployed on, and is the standard measure of a DeFi protocol's scale.`,
    };
  }

  if (match?.name) {
    const tvl = match.tvl ?? 0;
    return {
      ...base,
      resolved_name: match.name,
      kind: 'chain',
      verdict: 'chain',
      tvl_usd: tvl,
      tvl_formatted: formatUsd(tvl),
      change_1d_pct: null,
      change_7d_pct: null,
      category: 'Chain',
      chains: [match.name],
      symbol: match.tokenSymbol ?? null,
      url: null,
      reason:
        `The ${match.name} chain currently holds a total value locked of ${formatUsd(tvl)} ` +
        `(${tvl.toFixed(2)} USD) across all DeFi protocols tracked on it by DefiLlama` +
        `${match.tokenSymbol ? `, with ${match.tokenSymbol} as its native token` : ''}. ` +
        `Total value locked measures the aggregate USD value of assets deposited in on-chain contracts.`,
    };
  }

  // Neither lookup reached DefiLlama, so nothing can be asserted about whether
  // the subject exists.
  if (!protocolResult.ok && !chainsResult.ok) {
    return {
      ...base,
      resolved_name: null,
      kind: 'unavailable',
      verdict: 'unavailable',
      tvl_usd: null,
      tvl_formatted: null,
      change_1d_pct: null,
      change_7d_pct: null,
      category: null,
      chains: [],
      symbol: null,
      url: null,
      reason:
        `The total value locked for "${query}" could not be retrieved because DefiLlama's API ` +
        `did not respond. This is a temporary upstream failure, not a statement about whether ` +
        `"${query}" exists or how much value is locked in it; the figure is unknown rather than zero.`,
    };
  }

  return {
    ...base,
    resolved_name: null,
    kind: 'not_found',
    verdict: 'not_found',
    tvl_usd: null,
    tvl_formatted: null,
    change_1d_pct: null,
    change_7d_pct: null,
    category: null,
    chains: [],
    symbol: null,
    url: null,
    reason:
      `No protocol or chain matching "${query}" is tracked by DefiLlama, so no total value ` +
      `locked figure can be reported for it. The name may be misspelled, may refer to a ` +
      `protocol that DefiLlama does not index, or may not hold any on-chain deposits.`,
  };
}
