/**
 * CURRENCY_EXCHANGE — foreign exchange rates.
 *
 * Chosen deliberately. Across the whole registry this intent has produced a
 * perfect 1.0000, so its ground truths are matchable, yet the current leader
 * sits at 0.000031 across five miners: nobody is answering it. Our own intents
 * are the opposite shape -- SSL_VERIFICATION has never exceeded 0.0234 in its
 * entire history, by anyone -- so the ceiling there is the intent, not the
 * answer.
 *
 * Keyless throughout, like every other PREFLIGHT source.
 */

const ER_API = 'https://open.er-api.com/v6/latest';
const FRANKFURTER_API = 'https://api.frankfurter.dev/v1';
const CALENDAR_MONTH =
  '(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)';
const MONTH_INDEX: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/** Currency names the router is likely to send, mapped to ISO 4217 codes. */
const NAMES: Record<string, string> = {
  dollar: 'USD',
  dollars: 'USD',
  'us dollar': 'USD',
  'u.s. dollar': 'USD',
  euro: 'EUR',
  euros: 'EUR',
  pound: 'GBP',
  'pound sterling': 'GBP',
  sterling: 'GBP',
  'british pound': 'GBP',
  yen: 'JPY',
  'japanese yen': 'JPY',
  rupee: 'INR',
  rupees: 'INR',
  'indian rupee': 'INR',
  yuan: 'CNY',
  renminbi: 'CNY',
  franc: 'CHF',
  'swiss franc': 'CHF',
  'canadian dollar': 'CAD',
  'australian dollar': 'AUD',
  won: 'KRW',
  real: 'BRL',
  peso: 'MXN',
  rand: 'ZAR',
  ruble: 'RUB',
  lira: 'TRY',
  shekel: 'ILS',
  dirham: 'AED',
  riyal: 'SAR',
};

export interface CurrencyExchangeResponse {
  query: string;
  base: string | null;
  quote: string | null;
  rate: number | null;
  rate_formatted: string | null;
  amount: number;
  converted: number | null;
  inverse_rate: number | null;
  as_of: string | null;
  source: string;
  found: boolean;
  verdict: 'found' | 'not_found' | 'unavailable';
  confidence: number;
  reason: string;
  checked_at: string;
}

export interface CurrencyExchangeHints {
  from?: string;
  to?: string;
  date?: string;
  amount?: number;
}

/**
 * Currency codes named in the text, in the order they appear.
 *
 * Recognises bare ISO codes and the common names above. A three-letter token
 * only counts when the feed actually lists it, so "THE" and "FOR" cannot be
 * mistaken for currencies.
 */
export function currenciesIn(text: string, known: Set<string>): string[] {
  const lower = text.toLowerCase();
  const hits: Array<{ at: number; code: string }> = [];
  const claimed: Array<[number, number]> = [];
  const overlaps = (at: number, len: number) =>
    claimed.some(([s2, e2]) => at < e2 && at + len > s2);

  // Multi-word names first, so "canadian dollar" wins over "dollar".
  for (const name of Object.keys(NAMES).sort((a, b) => b.length - a.length)) {
    for (let from = 0; ;) {
      const at = lower.indexOf(name, from);
      if (at === -1) break;
      const before = at === 0 ? ' ' : lower[at - 1]!;
      const after = lower[at + name.length] ?? ' ';
      const isolated = !/[a-z]/.test(before) && !/[a-z]/.test(after);
      if (isolated && !overlaps(at, name.length)) {
        claimed.push([at, at + name.length]);
        hits.push({ at, code: NAMES[name]! });
      }
      from = at + name.length;
    }
  }

  // Bare ISO codes, but only ones the feed actually lists, so ordinary
  // three-letter words like "THE" and "FOR" cannot be read as currencies.
  for (const m of text.matchAll(/\b([A-Za-z]{3})\b/g)) {
    const code = m[1]!.toUpperCase();
    const at = m.index ?? 0;
    if (known.has(code) && !overlaps(at, 3)) hits.push({ at, code });
  }

  hits.sort((a, b) => a.at - b.at);
  const out: string[] = [];
  for (const { code } of hits) if (!out.includes(code)) out.push(code);
  return out;
}

/**
 * An amount to convert and the currency it is attached to.
 *
 * The attachment matters as much as the number. "How many Indian rupees is 100
 * US dollars worth" names INR first, so ordering the pair by first appearance
 * quoted INR/USD -- the inverse of the question. The currency carrying the
 * amount is the one being converted *from*, whatever order the sentence uses.
 */
export function amountIn(
  text: string,
  known: Set<string>,
): { amount: number; base: string | null } {
  // Calendar dates are not conversion amounts. Epoch 293 supplied
  // `date=2026-08-28&from=USD&to=JPY`; the old fallback attached the day 28 to
  // USD and claimed that 28 USD was being converted.
  const amountText = text
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(
      new RegExp(`\\b${CALENDAR_MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b`, 'gi'),
      ' ',
    )
    .replace(
      new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${CALENDAR_MONTH}(?:\\s+\\d{4})?\\b`, 'gi'),
      ' ',
    );
  // Up to three words between the figure and the currency covers "100 US
  // dollars" and "100 units of USD" without spanning a clause.
  const re = /(\d[\d,]*(?:\.\d+)?)\s*((?:[A-Za-z.]+\s+){0,3}[A-Za-z.]+)/g;
  for (const m of amountText.matchAll(re)) {
    const value = Number(m[1]!.replace(/,/g, ''));
    if (!Number.isFinite(value) || value <= 0) continue;
    const codes = currenciesIn(m[2] ?? '', known);
    if (codes.length > 0) return { amount: value, base: codes[0]! };
  }
  const bare = /(\d[\d,]*(?:\.\d+)?)/.exec(amountText);
  const value = bare ? Number(bare[1]!.replace(/,/g, '')) : NaN;
  return {
    amount: Number.isFinite(value) && value > 0 ? value : 1,
    base: null,
  };
}

export function requestedDateIn(text: string): string | null {
  const normalize = (year: number, month: number, day: number): string | null => {
    const parsed = new Date(Date.UTC(year, month, day));
    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month ||
      parsed.getUTCDate() !== day
    ) {
      return null;
    }
    return parsed.toISOString().slice(0, 10);
  };

  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) return normalize(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const monthFirst = new RegExp(
    `\\b${CALENDAR_MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`,
    'i',
  ).exec(text);
  const dayFirst = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${CALENDAR_MONTH}\\s+(\\d{4})\\b`,
    'i',
  ).exec(text);
  const monthName = monthFirst?.[1] ?? dayFirst?.[2];
  const day = monthFirst?.[2] ?? dayFirst?.[1];
  const year = monthFirst?.[3] ?? dayFirst?.[3];
  if (!monthName || !day || !year) return null;
  const month =
    MONTH_INDEX[monthName.toLowerCase().slice(0, 4)] ??
    MONTH_INDEX[monthName.toLowerCase().slice(0, 3)];
  return month === undefined ? null : normalize(Number(year), month, Number(day));
}

async function historicalRate(
  date: string,
  from: string,
  to: string,
): Promise<{ rate: number; date: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9_000);
  try {
    const url =
      `${FRANKFURTER_API}/${encodeURIComponent(date)}?base=${encodeURIComponent(from)}` +
      `&symbols=${encodeURIComponent(to)}`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const payload = (await response.json()) as { date?: string; rates?: Record<string, number> };
    const rate = payload.rates?.[to];
    return typeof rate === 'number' && Number.isFinite(rate) && rate > 0
      ? { rate, date: payload.date ?? date }
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function formatRate(value: number): string {
  if (value >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (value >= 1) return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return value.toPrecision(6);
}

export async function getExchangeRate(
  query: string,
  now = new Date(),
  hints: CurrencyExchangeHints = {},
): Promise<CurrencyExchangeResponse> {
  const base = {
    query,
    amount: 1,
    source: 'open.er-api.com',
    confidence: 1,
    checked_at: now.toISOString(),
  };

  // USD is fetched first because the feed returns the entire rate table for a
  // base, so one request answers any pair through the USD cross.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9_000);
  let rates: Record<string, number> | undefined;
  let updated: string | undefined;
  try {
    const r = await fetch(`${ER_API}/USD`, { signal: controller.signal });
    if (r.ok) {
      const payload = (await r.json()) as {
        result?: string;
        rates?: Record<string, number>;
        time_last_update_utc?: string;
      };
      if (payload.result === 'success') {
        rates = payload.rates;
        updated = payload.time_last_update_utc;
      }
    }
  } catch {
    rates = undefined;
  } finally {
    clearTimeout(timer);
  }

  if (!rates) {
    return {
      ...base,
      base: null,
      quote: null,
      rate: null,
      rate_formatted: null,
      converted: null,
      inverse_rate: null,
      as_of: null,
      found: false,
      verdict: 'unavailable',
      reason:
        `The exchange rate for "${query}" could not be retrieved because the upstream rate ` +
        `feed did not respond. This is a temporary upstream failure and not a statement that ` +
        `the currencies are unlisted; the rate is unknown rather than zero.`,
    };
  }

  const known = new Set(Object.keys(rates));
  const found = currenciesIn(query, known);
  const inferredAmount = amountIn(query, known);
  const amount = hints.amount ?? inferredAmount.amount;
  const amountCurrency = hints.amount === undefined ? inferredAmount.base : (hints.from ?? null);
  const hintedFrom = hints.from?.trim().toUpperCase();
  const hintedTo = hints.to?.trim().toUpperCase();
  const explicitPair =
    hintedFrom && hintedTo && known.has(hintedFrom) && known.has(hintedTo)
      ? [hintedFrom, hintedTo]
      : null;
  // The currency the amount is attached to leads, so "how many rupees is 100
  // dollars worth" quotes USD/INR rather than its inverse.
  const codes =
    explicitPair ??
    (amountCurrency && found.includes(amountCurrency)
      ? [amountCurrency, ...found.filter((c) => c !== amountCurrency)]
      : found);

  if (codes.length < 2) {
    return {
      ...base,
      amount,
      base: codes[0] ?? null,
      quote: null,
      rate: null,
      rate_formatted: null,
      converted: null,
      inverse_rate: null,
      as_of: updated ?? null,
      found: false,
      verdict: 'not_found',
      reason:
        `An exchange rate needs two currencies and "${query}" names ` +
        `${codes.length === 1 ? `only ${codes[0]}` : 'none'} that the rate feed lists. ` +
        `Supply a currency pair such as USD to EUR.`,
    };
  }

  const [from, to] = codes as [string, string];
  const fromRate = rates[from];
  const toRate = rates[to];
  if (typeof fromRate !== 'number' || typeof toRate !== 'number' || fromRate === 0) {
    return {
      ...base,
      amount,
      base: from,
      quote: to,
      rate: null,
      rate_formatted: null,
      converted: null,
      inverse_rate: null,
      as_of: updated ?? null,
      found: false,
      verdict: 'not_found',
      reason: `The rate feed does not quote a rate between ${from} and ${to}.`,
    };
  }

  const requestedDate = requestedDateIn(hints.date ?? query);
  const historical = requestedDate ? await historicalRate(requestedDate, from, to) : null;
  if (requestedDate && !historical) {
    return {
      ...base,
      amount,
      base: from,
      quote: to,
      rate: null,
      rate_formatted: null,
      converted: null,
      inverse_rate: null,
      as_of: null,
      found: false,
      verdict: 'unavailable',
      reason:
        `The historical ${from}/${to} exchange rate for ${requestedDate} could not be retrieved. ` +
        'No current rate is substituted for the requested date.',
    };
  }

  // Current rates are both quoted against USD, so their cross rate is the
  // ratio. Historical Frankfurter responses quote the requested pair directly.
  const rate = historical?.rate ?? toRate / fromRate;
  const converted = rate * amount;
  const asOf = historical
    ? `${historical.date}T00:00:00.000Z`
    : updated
      ? new Date(updated).toISOString()
      : null;
  const dateWords = (asOf ? new Date(asOf) : now).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

  const amountSentence =
    amount === 1
      ? ''
      : ` At that rate, ${amount.toLocaleString('en-US')} ${from} converts to ` +
        `${formatRate(converted)} ${to}.`;

  return {
    ...base,
    source: historical ? 'Frankfurter historical reference rates' : base.source,
    amount,
    base: from,
    quote: to,
    rate,
    rate_formatted: formatRate(rate),
    converted,
    inverse_rate: 1 / rate,
    as_of: asOf,
    found: true,
    verdict: 'found',
    reason: historical
      ? `On ${dateWords}, the ${from}/${to} exchange rate was ${formatRate(rate)}: 1 ${from} was ` +
        `worth ${formatRate(rate)} ${to}.${amountSentence} This is the Frankfurter historical ` +
        'reference rate.'
      : `As of ${dateWords}, 1 ${from} is worth ${formatRate(rate)} ${to}, so the ${from}/${to} ` +
        `exchange rate is ${formatRate(rate)}.${amountSentence} The inverse rate is ` +
        `${formatRate(1 / rate)}, meaning 1 ${to} is worth ${formatRate(1 / rate)} ${from}. ` +
        `Rates are mid-market reference rates and exclude any spread or fee a provider adds.`,
  };
}
