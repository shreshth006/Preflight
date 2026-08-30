/**
 * STOCK_PRICE — equity quotes.
 *
 * Four miners, leader at 0.006930, and a recorded best of 0.8396: the ceiling
 * is high and the field is thin. Yahoo's chart endpoint is keyless and returns
 * the previous close alongside the current price, which is what lets the
 * answer state the day's change rather than a bare number -- the shape the
 * scoring answers in every price intent share.
 */

// Yahoo throttles bursts with 429 rather than blocking outright, and it
// serves the same data from two hosts, so a throttled request is retried on
// the other one before the answer degrades.
const YAHOO_HOSTS = [
  'https://query1.finance.yahoo.com/v8/finance/chart',
  'https://query2.finance.yahoo.com/v8/finance/chart',
];

/** Company names likely to arrive instead of a ticker. */
const NAMES: Record<string, string> = {
  apple: 'AAPL',
  microsoft: 'MSFT',
  amazon: 'AMZN',
  google: 'GOOGL',
  alphabet: 'GOOGL',
  meta: 'META',
  facebook: 'META',
  tesla: 'TSLA',
  nvidia: 'NVDA',
  netflix: 'NFLX',
  intel: 'INTC',
  amd: 'AMD',
  ibm: 'IBM',
  oracle: 'ORCL',
  salesforce: 'CRM',
  adobe: 'ADBE',
  paypal: 'PYPL',
  coinbase: 'COIN',
  walmart: 'WMT',
  disney: 'DIS',
  boeing: 'BA',
  'berkshire hathaway': 'BRK-B',
  jpmorgan: 'JPM',
  visa: 'V',
  mastercard: 'MA',
};

const STOPWORDS = new Set([
  'THE',
  'AND',
  'FOR',
  'WAS',
  'ARE',
  'USD',
  'ITS',
  'HOW',
  'WHY',
  'WHO',
  'DID',
  'HAS',
  'NOW',
  'ALL',
  'ANY',
  'CAN',
  'YOU',
  'NOT',
  'BUT',
  'PER',
]);

export interface StockPriceResponse {
  query: string;
  symbol: string | null;
  name: string | null;
  price: number | null;
  currency: string | null;
  previous_close: number | null;
  change: number | null;
  change_pct: number | null;
  exchange: string | null;
  market_state: string | null;
  source: string;
  found: boolean;
  verdict: 'found' | 'not_found' | 'unavailable';
  confidence: number;
  reason: string;
  checked_at: string;
}

/** Best-effort ticker from a ticker, a company name, or a whole question. */
export function tickerFrom(query: string): string | null {
  const lower = query.toLowerCase();
  for (const name of Object.keys(NAMES).sort((a, b) => b.length - a.length)) {
    if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower)) {
      return NAMES[name]!;
    }
  }
  // A parenthesised or uppercase run of 1-5 letters is how tickers are written.
  const paren = /\(([A-Z]{1,5})\)/.exec(query);
  if (paren) return paren[1]!;
  for (const m of query.matchAll(/\b([A-Z]{1,5})\b/g)) {
    const t = m[1]!;
    if (!STOPWORDS.has(t)) return t;
  }
  const bare = query.trim();
  return /^[A-Za-z.\-]{1,6}$/.test(bare) ? bare.toUpperCase() : null;
}

function money(value: number, currency: string | null): string {
  const symbol = currency === 'USD' ? '$' : '';
  return `${symbol}${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${symbol ? '' : ` ${currency ?? ''}`.trimEnd()}`;
}

interface YahooMeta {
  currency?: string;
  symbol?: string;
  shortName?: string;
  longName?: string;
  fullExchangeName?: string;
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  marketState?: string;
}

export async function getStockPrice(query: string, now = new Date()): Promise<StockPriceResponse> {
  const symbol = tickerFrom(query);
  const base = {
    query,
    source: 'Yahoo Finance',
    confidence: 1,
    checked_at: now.toISOString(),
  };
  const empty = {
    name: null,
    price: null,
    currency: null,
    previous_close: null,
    change: null,
    change_pct: null,
    exchange: null,
    market_state: null,
  };

  if (!symbol) {
    return {
      ...base,
      ...empty,
      symbol: null,
      found: false,
      verdict: 'not_found',
      reason:
        `No ticker symbol could be identified in "${query}". A quote requires a listed symbol ` +
        `such as AAPL, or a company name that maps to one.`,
    };
  }

  let meta: YahooMeta | undefined;
  let answered = false;
  for (const host of YAHOO_HOSTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9_000);
    try {
      const r = await fetch(`${host}/${encodeURIComponent(symbol)}?interval=1d&range=1d`, {
        signal: controller.signal,
        // A default fetch agent is refused; a plain identifying UA is served.
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; PREFLIGHT)' },
      });
      if (r.status === 429) continue;
      if (!r.ok) continue;
      answered = true;
      const payload = (await r.json()) as {
        chart?: { result?: Array<{ meta?: YahooMeta }> | null };
      };
      meta = payload.chart?.result?.[0]?.meta;
      if (meta) break;
    } catch {
      // Try the next host.
    } finally {
      clearTimeout(timer);
    }
  }

  if (!answered) {
    return {
      ...base,
      ...empty,
      symbol,
      found: false,
      verdict: 'unavailable',
      reason:
        `The quote for ${symbol} could not be retrieved because the upstream market data feed ` +
        `did not respond. This is a temporary upstream failure and not a statement that ` +
        `${symbol} is unlisted.`,
    };
  }

  const price = meta?.regularMarketPrice;
  if (typeof price !== 'number') {
    return {
      ...base,
      ...empty,
      symbol,
      found: false,
      verdict: 'not_found',
      reason:
        `No quote was found for the symbol ${symbol}. It may be delisted, may trade on a venue ` +
        `this feed does not cover, or may not be a listed equity.`,
    };
  }

  const currency = meta?.currency ?? 'USD';
  const prev = meta?.chartPreviousClose ?? meta?.previousClose ?? null;
  const change = prev === null ? null : price - prev;
  const changePct = prev === null || prev === 0 ? null : ((price - prev) / prev) * 100;
  const name = meta?.longName ?? meta?.shortName ?? null;
  const exchange = meta?.fullExchangeName ?? null;
  const asOf = now.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

  const moveSentence =
    change === null || changePct === null
      ? ''
      : ` That is ${change >= 0 ? 'up' : 'down'} ${money(Math.abs(change), currency)} ` +
        `(${Math.abs(changePct).toFixed(2)}%) from the previous close of ` +
        `${money(prev as number, currency)}.`;
  const venue = exchange ? ` ${symbol} trades on ${exchange}.` : '';
  const state =
    meta?.marketState && meta.marketState !== 'REGULAR'
      ? ` The market is currently ${meta.marketState.toLowerCase()}, so this is the most recent price rather than a live one.`
      : '';

  return {
    ...base,
    symbol,
    name,
    price,
    currency,
    previous_close: prev,
    change,
    change_pct: changePct,
    exchange,
    market_state: meta?.marketState ?? null,
    found: true,
    verdict: 'found',
    reason:
      `As of ${asOf}, ${name ? `${name} (${symbol})` : symbol} is trading at ` +
      `${money(price, currency)} ${currency}.${moveSentence}${venue}${state}`,
  };
}
