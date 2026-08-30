/**
 * A replica of the per-epoch scoring the Telegraph node performs.
 *
 * Not a reimplementation. Each intent has a champion scoring module, and that
 * module -- the exact `.wasm` the node loads -- is public. This downloads them
 * and calls the same `rank_answer(question, ground_truth, answer)` entry point
 * over the same ABI, so the arithmetic is not approximated at all.
 *
 * The only thing it cannot reproduce is the question the next epoch will ask,
 * so it replays the questions and ground truths already recorded in
 * `fixtures/live/scored-receipts.json`.
 *
 * FIDELITY IS CHECKED, NOT ASSUMED. `--verify` replays every recorded answer
 * from every miner and compares the module's output against the score the node
 * actually recorded. A replica that disagrees with the node is worse than none:
 * that is how registration 1760 was spent, on a proxy that predicted an
 * improvement which did not exist. The agreement figure is printed on every run
 * and a weak one is called out in the output.
 *
 *   node scripts/epoch-replica.mjs --verify
 *   node scripts/epoch-replica.mjs --rank            # score live PREFLIGHT
 *   node scripts/epoch-replica.mjs --rank --intent SSL_VERIFICATION
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { loadScorer } from '../../telegraph-factscore/harness/wasm-abi.mjs';

const RECEIPTS = 'fixtures/live/scored-receipts.json';
const CHAMPIONS = 'fixtures/champions';
const BASE = process.env.PREFLIGHT_BASE ?? 'https://preflight-ssl-verification.vercel.app';

/** Live endpoint that answers each intent, and a probe for the recorded question. */
const ENDPOINTS = {
  SSL_VERIFICATION: (q) =>
    `/ssl-check?domain=${encodeURIComponent(hostFrom(q) ?? 'api.example.com')}`,
  URL_SCAN: (q) =>
    `/url-scan?question=${encodeURIComponent(q)}${explicitUrlFrom(q) ? `&url=${encodeURIComponent(explicitUrlFrom(q))}` : ''}`,
  GAS_PRICE: (q) =>
    `/gas-price?chain=${encodeURIComponent(requestedChainFrom(q) ?? 'ethereum')}` +
    `&question=${encodeURIComponent(q)}`,
  ONCHAIN_TX_LOOKUP: (q) =>
    `/tx-lookup?chain=${encodeURIComponent(namedChainFrom(q) ?? 'ethereum')}` +
    `&hash=${encodeURIComponent(hashFrom(q) ?? '')}&question=${encodeURIComponent(q)}`,
  TVL_LOOKUP: (q) => {
    const chain = namedChainFrom(q);
    return (
      `/tvl?protocol=${encodeURIComponent(protocolFrom(q))}&question=${encodeURIComponent(q)}` +
      (chain ? `&chain=${encodeURIComponent(chain)}` : '')
    );
  },
  CRYPTO_PRICE: (q) => `/crypto-price?question=${encodeURIComponent(q)}`,
  // The question is passed alongside the extracted parameter, because the
  // parameters alone lose information the endpoint uses -- a malformed address
  // in the question text is invisible once only a well-formed one is extracted.
  WALLET_BALANCE_CHECK: (q) =>
    `/wallet-balance?chain=${encodeURIComponent(chainFrom(q))}` +
    `&address=${encodeURIComponent(addressFrom(q) ?? '')}&question=${encodeURIComponent(q)}`,
  CURRENCY_EXCHANGE: (q) => `/fx-rate?pair=${encodeURIComponent(q)}`,
  IP_GEOLOCATION: (q) => `/ip-geolocation?ip=${encodeURIComponent(ipFrom(q) ?? '')}`,
  STOCK_PRICE: (q) => `/stock-price?symbol=${encodeURIComponent(q)}`,
};

const hostFrom = (q) => /\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b/i.exec(q)?.[1] ?? null;
const explicitUrlFrom = (q) => /https?:\/\/\S+/i.exec(q)?.[0] ?? null;
const hashFrom = (q) => /\b0x[0-9a-f]{64}\b/i.exec(q)?.[0] ?? null;
const addressFrom = (q) => /\b0x[0-9a-fA-F]{40}\b/.exec(q)?.[0] ?? null;
const ipFrom = (q) => /\b(?:\d{1,3}\.){3}\d{1,3}\b/.exec(q)?.[0] ?? null;
const namedChainFrom = (q) =>
  /\b(arbitrum|base|optimism|polygon|sepolia|ethereum)\b/i.exec(q)?.[1]?.toLowerCase() ?? null;
const requestedChainFrom = (q) =>
  /\b(arbitrum|base|bitcoin|optimism|polygon|sepolia|solana|ethereum)\b/i
    .exec(q)?.[1]
    ?.toLowerCase() ?? null;
const chainFrom = (q) => namedChainFrom(q) ?? 'ethereum';
const protocolFrom = (q) => /\b(aave\s*v?\d*)\b/i.exec(q)?.[1] ?? 'Aave V3';

function loadChampions() {
  if (!existsSync(CHAMPIONS)) {
    throw new Error(`${CHAMPIONS} is missing — run scripts/fetch-champions.sh first`);
  }
  const byIntent = new Map();
  for (const file of readdirSync(CHAMPIONS)) {
    if (!file.endsWith('.wasm')) continue;
    const intent = file.replace(/_reg\d+\.wasm$/, '');
    byIntent.set(intent, `${CHAMPIONS}/${file}`);
  }
  return byIntent;
}

/** Spearman rank correlation, for comparing replica output against recorded scores. */
function spearman(xs, ys) {
  const rank = (v) => {
    const idx = v.map((value, i) => ({ value, i })).sort((a, b) => a.value - b.value);
    const out = new Array(v.length);
    for (let i = 0; i < idx.length;) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1].value === idx[i].value) j += 1;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k += 1) out[idx[k].i] = avg;
      i = j + 1;
    }
    return out;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const n = xs.length;
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return dx === 0 || dy === 0 ? 0 : num / Math.sqrt(dx * dy);
}

async function verify(receipts, champions, only) {
  console.log('Replaying every recorded answer through the champion module that scored it.\n');
  console.log('intent                    n   spearman   note');
  console.log('-'.repeat(72));
  const overall = [];
  for (const [intent, path] of [...champions].sort()) {
    if (only && intent !== only) continue;
    const rows = receipts.filter((r) => r.intent === intent && r.converted_answer);
    if (rows.length === 0) {
      console.log(`${intent.padEnd(24)}    0   —          no recorded answers`);
      continue;
    }
    const mod = await loadScorer(path, intent);
    const predicted = [];
    const actual = [];
    for (const r of rows) {
      let v;
      try {
        v = mod.score(r.question, r.ground_truth, r.converted_answer);
      } catch {
        continue;
      }
      if (!Number.isFinite(v)) continue;
      predicted.push(v);
      actual.push(r.score);
      overall.push([v, r.score]);
    }
    const rho = predicted.length > 2 ? spearman(predicted, actual) : 0;
    const note = rho >= 0.9 ? 'faithful' : rho >= 0.6 ? 'usable' : 'WEAK — do not tune on this';
    console.log(
      `${intent.padEnd(24)} ${String(predicted.length).padStart(4)}   ${rho.toFixed(4)}     ${note}`,
    );
  }
  if (overall.length > 2) {
    console.log('-'.repeat(72));
    console.log(
      `${'ALL'.padEnd(24)} ${String(overall.length).padStart(4)}   ${spearman(
        overall.map((t) => t[0]),
        overall.map((t) => t[1]),
      ).toFixed(4)}`,
    );
  }
}

async function fetchAnswer(intent, question) {
  const build = ENDPOINTS[intent];
  if (!build) return null;
  const path = build(question);
  // A transient deployment or network failure must not silently remove a
  // truth from the robust sample. One retry is cheap (these are idempotent
  // GETs) and the caller still reports any pair it could not score.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const r = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(30_000) });
      if (!r.ok) continue;
      const body = await r.json();
      if (typeof body.reason === 'string') return body.reason;
    } catch {
      // Retry once, then let the caller expose the missing answer.
    }
  }
  return null;
}

async function rank(receipts, champions, only) {
  console.log(`Scoring live PREFLIGHT answers with each intent's champion module.\n`);
  console.log('intent                  our score   best rival   rank   verdict');
  console.log('-'.repeat(72));
  const summary = [];
  for (const [intent, path] of [...champions].sort()) {
    if (only && intent !== only) continue;
    const rows = receipts.filter((r) => r.intent === intent && r.converted_answer);
    if (rows.length === 0) continue;
    // The most recent recorded question, which the pool repeats verbatim.
    const latest = rows.reduce((a, b) => (a.epoch_id >= b.epoch_id ? a : b));
    const field = rows.filter((r) => r.question === latest.question);
    const answer = await fetchAnswer(intent, latest.question);
    if (!answer) {
      console.log(`${intent.padEnd(22)}  (no live answer)`);
      continue;
    }
    const mod = await loadScorer(path, intent);
    const mine = mod.score(latest.question, latest.ground_truth, answer);
    const rivals = field
      .map((r) => ({
        miner: r.miner,
        score: mod.score(r.question, r.ground_truth, r.converted_answer),
      }))
      .filter((r) => Number.isFinite(r.score) && !r.miner.includes('preflight'))
      .sort((a, b) => b.score - a.score);
    const best = rivals[0];
    const place = rivals.filter((r) => r.score > mine).length + 1;
    const verdict = place === 1 ? 'LEAD' : `behind ${best?.miner ?? '?'}`;
    console.log(
      `${intent.padEnd(22)}  ${mine.toFixed(6)}    ${(best?.score ?? 0).toFixed(6)}     ${String(place).padStart(2)}    ${verdict}`,
    );
    summary.push({ intent, mine, best: best?.score ?? 0, place, of: rivals.length + 1 });
  }
  console.log('-'.repeat(72));
  const leads = summary.filter((s) => s.place === 1).length;
  console.log(`leading ${leads} of ${summary.length} intents measured`);
  return summary;
}

/**
 * Score our live answer against EVERY recorded question-and-truth pair in an
 * intent, not just the most recent one.
 *
 * Each epoch regenerates the ground truth with a language model, so its shape
 * varies even when the question repeats. Tuning against a single recorded
 * truth optimises for one sample of that distribution and says nothing about
 * the rest of it. What decides a run of epochs is the expected score across
 * the distribution and how tightly it holds -- an answer scoring 1.0 on one
 * truth shape and 0.001 on another is worse than one scoring 0.8 on both.
 *
 * So this reports the mean, the worst case, and how many pairs land near 1.0.
 * Raising the worst case matters more than raising the best.
 */
async function robust(receipts, champions, only) {
  console.log('Scoring live answers against every recorded truth in each intent.\n');
  console.log('intent                  pairs   mean     min      p@>0.9  beats-field');
  console.log('-'.repeat(74));
  for (const [intent, path] of [...champions].sort()) {
    if (only && intent !== only) continue;
    // Our live answer can still be scored for an epoch where every historical
    // miner failed to return prose. Keeping only non-empty historical answers
    // would erase those (often hardest) truths from the sample.
    const rows = receipts.filter(
      (r) =>
        r.intent === intent && typeof r.question === 'string' && typeof r.ground_truth === 'string',
    );
    if (rows.length === 0) continue;
    // A repeated question does not imply a repeated target. The daemon
    // regenerates ground truth every epoch, so key the replay corpus by both
    // dimensions. Grouping only by question silently selected the first truth
    // and discarded later truth shapes -- exactly the overfitting this mode is
    // meant to detect.
    const byPair = new Map();
    for (const r of rows) {
      const key = JSON.stringify([r.question, r.ground_truth]);
      if (!byPair.has(key)) byPair.set(key, []);
      byPair.get(key).push(r);
    }
    const mod = await loadScorer(path, intent);
    const scores = [];
    let beats = 0;
    const answers = new Map();
    for (const group of byPair.values()) {
      const { question, ground_truth: groundTruth } = group[0];
      // Different phrasings can resolve to the exact same live request (for
      // example every SSL question currently probes api.example.com). Fetch
      // that endpoint once, while still scoring its answer separately against
      // every question-and-truth pair.
      const answerKey = ENDPOINTS[intent]?.(question) ?? question;
      if (!answers.has(answerKey)) answers.set(answerKey, fetchAnswer(intent, question));
      const answer = await answers.get(answerKey);
      if (!answer) continue;
      let v;
      try {
        v = mod.score(question, groundTruth, answer);
      } catch {
        continue;
      }
      if (!Number.isFinite(v)) continue;
      scores.push(v);
      if (v > Math.max(...group.map((g) => g.score))) beats += 1;
    }
    if (scores.length === 0) {
      console.log(`${intent.padEnd(22)}  (no live answers)`);
      continue;
    }
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const min = Math.min(...scores);
    const near = scores.filter((v) => v > 0.9).length;
    const coverage =
      scores.length === byPair.size ? String(scores.length) : `${scores.length}/${byPair.size}`;
    console.log(
      `${intent.padEnd(22)} ${coverage.padStart(5)}   ${mean.toFixed(4)}   ${min.toFixed(4)}   ` +
        `${String(near).padStart(2)}/${scores.length}    ${beats}/${scores.length}`,
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.includes('--intent') ? args[args.indexOf('--intent') + 1] : null;
  const receipts = JSON.parse(readFileSync(RECEIPTS, 'utf8'));
  const champions = loadChampions();
  if (args.includes('--verify')) await verify(receipts, champions, only);
  else if (args.includes('--rank')) await rank(receipts, champions, only);
  else if (args.includes('--robust')) await robust(receipts, champions, only);
  else console.error('usage: --verify | --rank | --robust [--intent NAME]');
}

await main();
