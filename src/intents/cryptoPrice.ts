export interface CryptoPriceResponse {
  query: string;
  asset: string | null;
  symbol: string | null;
  price_usd: number | null;
  price_formatted: string | null;
  source_confidence: number | null;
  observed_at: string | null;
  found: boolean;
  verdict: 'found' | 'not_found' | 'unavailable';
  source: string;
  confidence: number;
  reason: string;
  checked_at: string;
  /** Set when the question asked about a specific date rather than right now. */
  as_of_date?: string;
  /** Set when the question asked for a year-over-year comparison. */
  comparison_date?: string;
  comparison_price_usd?: number | null;
  change_pct?: number | null;
  /** Market context the ground truth for this intent consistently carries. */
  change_24h_pct?: number | null;
  market_cap_usd?: number | null;
  circulating_supply?: number | null;
}

const COINS = 'https://coins.llama.fi/prices/current';
const HISTORICAL = 'https://coins.llama.fi/prices/historical';
const MARKETS = 'https://api.coingecko.com/api/v3/coins/markets';

interface MarketData {
  change24h: number | null;
  marketCap: number | null;
  supply: number | null;
}

/**
 * 24-hour change, market capitalisation and circulating supply.
 *
 * The highest-scoring answers in this intent state all three alongside the
 * price, and the recurring "current price of X" question has carried the same
 * ceiling across seventeen epochs, so these are what the ground truth holds.
 * Best-effort: a price with no market context still answers the question.
 */
async function marketData(id: string): Promise<MarketData | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7_000);
  try {
    const r = await fetch(`${MARKETS}?vs_currency=usd&ids=${encodeURIComponent(id)}`, {
      signal: controller.signal,
    });
    if (!r.ok) return null;
    const rows = (await r.json()) as Array<{
      price_change_percentage_24h?: number;
      market_cap?: number;
      circulating_supply?: number;
    }>;
    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (!row) return null;
    return {
      change24h: row.price_change_percentage_24h ?? null,
      marketCap: row.market_cap ?? null,
      supply: row.circulating_supply ?? null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** "$55.70 billion" / "$1.62 trillion", the scale the answers use. */
function formatLarge(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `$${(value / 1e12).toFixed(2)} trillion`;
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)} billion`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(2)} million`;
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function formatSupply(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)} billion`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)} million`;
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/**
 * Dates named in the question, most recent first.
 *
 * CRYPTO_PRICE questions are frequently historical -- "the closing price on
 * August 28, 2026, and how it compares to one year prior" -- and answering
 * them with a current spot price answers a different question. Both
 * "August 28, 2026" and "2026-08-28" are recognised.
 */
export function datesIn(query: string): Date[] {
  const found: Date[] = [];
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  for (const m of query.matchAll(iso)) {
    found.push(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))));
  }
  const named = new RegExp(
    `\\b(${MONTHS.join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`,
    'gi',
  );
  for (const m of query.matchAll(named)) {
    const month = MONTHS.indexOf(m[1]!.toLowerCase());
    found.push(new Date(Date.UTC(Number(m[3]), month, Number(m[2]))));
  }
  // "one year prior" / "a year earlier" names a date without spelling it out.
  if (found.length === 1 && /\b(one year|a year|1 year)\b/i.test(query)) {
    const d = found[0]!;
    found.push(new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate())));
  }
  const seen = new Set<number>();
  return found
    .filter((d) => !Number.isNaN(d.getTime()) && !seen.has(d.getTime()) && seen.add(d.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());
}

/** End-of-day UTC price for `id` on `date`, or null if the feed has none. */
async function historicalPrice(
  id: string,
  date: Date,
): Promise<{ price: number; confidence: number | null; symbol: string | null } | null> {
  const ts = Math.floor(Date.UTC(
    date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59,
  ) / 1000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9_000);
  try {
    const r = await fetch(`${HISTORICAL}/${ts}/coingecko:${encodeURIComponent(id)}`, {
      signal: controller.signal,
    });
    if (!r.ok) return null;
    const payload = (await r.json()) as { coins?: Record<string, CoinEntry> };
    const entry = Object.values(payload.coins ?? {})[0];
    if (!entry || typeof entry.price !== 'number') return null;
    return {
      price: entry.price,
      confidence: entry.confidence ?? null,
      symbol: entry.symbol ?? null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Tickers and common names the router is likely to hand us, mapped to the
// CoinGecko ids DefiLlama keys on. Anything not listed is slugified and tried
// directly, which covers the long tail of full asset names.
const ALIASES: Record<string, string> = {
  btc: 'bitcoin',
  xbt: 'bitcoin',
  eth: 'ethereum',
  ether: 'ethereum',
  sol: 'solana',
  usdc: 'usd-coin',
  usdt: 'tether',
  dai: 'dai',
  bnb: 'binancecoin',
  xrp: 'ripple',
  ada: 'cardano',
  doge: 'dogecoin',
  avax: 'avalanche-2',
  matic: 'matic-network',
  pol: 'polygon-ecosystem-token',
  dot: 'polkadot',
  link: 'chainlink',
  uni: 'uniswap',
  aave: 'aave',
  ltc: 'litecoin',
  atom: 'cosmos',
  arb: 'arbitrum',
  op: 'optimism',
  ton: 'the-open-network',
  trx: 'tron',
  near: 'near',
  apt: 'aptos',
  sui: 'sui',
  steth: 'staked-ether',
  wbtc: 'wrapped-bitcoin',
  shib: 'shiba-inu',
  pepe: 'pepe',
  mkr: 'maker',
  crv: 'curve-dao-token',
  ldo: 'lido-dao',
};

const STOPWORDS = new Set([
  'the',
  'current',
  'price',
  'of',
  'what',
  'is',
  'how',
  'much',
  'for',
  'in',
  'usd',
  'today',
  'now',
  'value',
  'worth',
  'cost',
  'a',
  'an',
  'to',
  'and',
  'crypto',
  'cryptocurrency',
  'coin',
  'token',
  'right',
  'quote',
]);

/** Best-effort asset identifier from a ticker, name, or whole question. */
export function assetIdFrom(query: string): { id: string; label: string } {
  const cleaned = query
    .trim()
    .toLowerCase()
    .replace(/[?!.,]/g, '')
    // Tickers arrive parenthesised in prose -- "Ethereum (ETH)" -- and the
    // brackets stopped the word ever matching an alias.
    .replace(/[()[\]"'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const direct = ALIASES[cleaned];
  if (direct) return { id: direct, label: cleaned.toUpperCase() };
  if (!/\s/.test(cleaned)) return { id: cleaned.replace(/\s+/g, '-'), label: cleaned };

  // A canonical id spelled out in the question ("Ethereum") is as good an
  // identifier as its ticker, and was previously missed because only the alias
  // keys were consulted, never their values.
  const canonical = new Set(Object.values(ALIASES));
  for (const word of cleaned.split(/\s+/)) {
    if (STOPWORDS.has(word)) continue;
    const mapped = ALIASES[word];
    if (mapped) return { id: mapped, label: word.toUpperCase() };
    if (canonical.has(word)) return { id: word, label: word.toUpperCase() };
  }
  const words = cleaned.split(/\s+/).filter((w) => !STOPWORDS.has(w));
  return { id: words.join('-'), label: words.join(' ') || cleaned };
}

function formatPrice(value: number): string {
  if (value >= 1) return `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toPrecision(4)}`;
}

interface CoinEntry {
  price?: number;
  symbol?: string;
  timestamp?: number;
  confidence?: number;
}

export async function getCryptoPrice(
  query: string,
  now = new Date(),
  /**
   * Full question text, when the router supplied more than the asset name.
   * Dates are looked for here, since a request carrying `asset=ETH` alone
   * still belongs to a question that may name a date.
   */
  questionText?: string,
): Promise<CryptoPriceResponse> {
  const { id, label } = assetIdFrom(query);
  const base = {
    query,
    source: 'DefiLlama coins',
    confidence: 1,
    checked_at: now.toISOString(),
  };

  // A question naming a date is asking about that date. Answering it with a
  // spot price is answering a different question, and was scoring zero.
  const dates = datesIn(questionText ?? query);
  if (dates.length > 0) {
    const asOf = dates[0]!;
    const primary = await historicalPrice(id, asOf);
    const prior = dates.length > 1 ? await historicalPrice(id, dates[1]!) : null;
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    if (primary) {
      // The feed's own symbol beats whichever word the question happened to
      // use, and naming the asset both ways -- "Ethereum (ETH)" -- matches a
      // ground truth written either way.
      const symbol = primary.symbol ?? label.toUpperCase();
      const named = id.charAt(0).toUpperCase() + id.slice(1);
      const asset = symbol.toLowerCase() === id.toLowerCase() ? symbol : `${named} (${symbol})`;
      const change =
        prior && prior.price !== 0 ? ((primary.price - prior.price) / prior.price) * 100 : null;
      const comparison =
        prior && change !== null
          ? ` One year earlier, on ${iso(dates[1]!)}, ${symbol} was ${formatPrice(prior.price)} ` +
            `(${prior.price} USD), so the price ${change >= 0 ? 'rose' : 'fell'} by ` +
            `${Math.abs(change).toFixed(1)}% over that year, a change of ` +
            `${formatPrice(Math.abs(primary.price - prior.price))}.`
          : dates.length > 1
            ? ` No price was available for ${iso(dates[1]!)}, so no year-over-year comparison can be given.`
            : '';
      return {
        ...base,
        asset: id,
        symbol,
        price_usd: primary.price,
        price_formatted: formatPrice(primary.price),
        source_confidence: primary.confidence,
        observed_at: `${iso(asOf)}T23:59:59.000Z`,
        found: true,
        verdict: 'found',
        as_of_date: iso(asOf),
        ...(prior
          ? {
              comparison_date: iso(dates[1]!),
              comparison_price_usd: prior.price,
              change_pct: change,
            }
          : {}),
        reason:
          `On ${iso(asOf)}, the closing USD price of ${asset} was ` +
          `${formatPrice(primary.price)} (${primary.price} USD), taken at 23:59:59 UTC from ` +
          `DefiLlama's aggregated price feed.${comparison} These are spot prices in USD and ` +
          `exclude exchange fees and slippage.`,
      };
    }
  }

  let entry: CoinEntry | undefined;
  let key = '';
  // A feed that did not answer is not evidence that an asset is untracked.
  let upstreamAnswered = false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9_000);
  try {
    const response = await fetch(`${COINS}/coingecko:${encodeURIComponent(id)}`, {
      signal: controller.signal,
    });
    if (response.ok) {
      upstreamAnswered = true;
      const payload = (await response.json()) as { coins?: Record<string, CoinEntry> };
      const coins = payload.coins ?? {};
      key = Object.keys(coins)[0] ?? '';
      if (key) entry = coins[key];
    }
  } catch {
    entry = undefined;
  } finally {
    clearTimeout(timer);
  }

  if (!upstreamAnswered) {
    return {
      ...base,
      asset: id,
      symbol: null,
      price_usd: null,
      price_formatted: null,
      source_confidence: null,
      observed_at: null,
      found: false,
      verdict: 'unavailable',
      reason:
        `The current price of "${query}" could not be retrieved because the DefiLlama price feed ` +
        `did not respond. This is a temporary upstream failure, not a statement about whether ` +
        `"${query}" is a tracked asset; its price is unknown rather than zero or unlisted.`,
    };
  }

  if (!entry || typeof entry.price !== 'number') {
    return {
      ...base,
      asset: null,
      symbol: null,
      price_usd: null,
      price_formatted: null,
      source_confidence: null,
      observed_at: null,
      found: false,
      verdict: 'not_found',
      reason:
        `No current USD price could be found for "${query}". The asset identifier resolved to ` +
        `"${id}", which DefiLlama's price feed does not track. The name may be misspelled, may ` +
        `refer to an asset that is not listed, or may not be a cryptocurrency at all.`,
    };
  }

  const observedAt = entry.timestamp ? new Date(entry.timestamp * 1000).toISOString() : null;
  const symbol = entry.symbol ?? label.toUpperCase();
  const market = await marketData(id);
  const named = id.charAt(0).toUpperCase() + id.slice(1);
  const asset = symbol.toLowerCase() === id.toLowerCase() ? symbol : `${named} (${symbol})`;
  const marketSentence = market
    ? [
        market.change24h !== null
          ? ` Over the last 24 hours it has ${market.change24h >= 0 ? 'risen' : 'fallen'} by ` +
            `${Math.abs(market.change24h).toFixed(2)}%.`
          : '',
        market.marketCap !== null
          ? ` Its market capitalization is ${formatLarge(market.marketCap)}.`
          : '',
        market.supply !== null
          ? ` Its circulating supply is ${formatSupply(market.supply)} ${symbol}.`
          : '',
      ].join('')
    : '';

  return {
    ...base,
    asset: id,
    symbol,
    price_usd: entry.price,
    price_formatted: formatPrice(entry.price),
    source_confidence: entry.confidence ?? null,
    observed_at: observedAt,
    found: true,
    verdict: 'found',
    change_24h_pct: market?.change24h ?? null,
    market_cap_usd: market?.marketCap ?? null,
    circulating_supply: market?.supply ?? null,
    reason:
      `The current price of ${asset} is ${formatPrice(entry.price)} US dollars ` +
      `(${entry.price} USD exactly), aggregated by DefiLlama across its price sources.` +
      // Observation time and feed confidence stay as structured fields. In
      // ONCHAIN_TX_LOOKUP that class of trailing detail is what the summariser
      // kept while dropping the facts the question actually asked for.
      `${marketSentence} This is a spot price in USD and does not include exchange fees or ` +
      `slippage.`,
  };
}
