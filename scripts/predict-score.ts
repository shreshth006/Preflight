/**
 * Offline estimate of the canonical Telegraph score, for testing an answer
 * without waiting nine hours for an epoch.
 *
 * The node scores `converted_answer` with
 *
 *   0.25 * cos(question, answer)
 *   0.50 * cos(ground_truth, answer)
 *   0.15 * BM25(ground_truth, answer)
 *   0.10 * sigmoid((len(answer) - 50) / 20)
 *
 * BM25 and the length term are reproduced exactly. The two cosine terms use a
 * TF-IDF cosine over the corpus rather than MiniLM embeddings, which is a
 * proxy and not the real thing.
 *
 * Because it is a proxy, it is validated before it is trusted: `--validate`
 * scores every recorded answer in `fixtures/live/scored-receipts.json` and
 * reports Spearman correlation against the scores the node actually gave. A
 * harness that predicts an improvement that does not exist is worse than no
 * harness -- that is exactly how registration 1760 was spent -- so the
 * correlation is printed with every run and a weak one is called out.
 *
 *   npx tsx scripts/predict-score.ts --validate
 *   npx tsx scripts/predict-score.ts --intent SSL_VERIFICATION --answer "..."
 */

import { readFileSync } from 'node:fs';

interface Receipt {
  epoch_id: number;
  intent: string;
  miner: string;
  score: number;
  question: string;
  ground_truth: string;
  converted_answer: string | null;
}

const CORPUS = 'fixtures/live/scored-receipts.json';

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9._-]*/g) ?? []).filter((t) => t.length > 1);
}

function termFreq(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

/** Inverse document frequency over every question, truth and answer we hold. */
function buildIdf(receipts: Receipt[]): Map<string, number> {
  const df = new Map<string, number>();
  const docs: string[] = [];
  for (const r of receipts) {
    docs.push(r.question, r.ground_truth);
    if (r.converted_answer) docs.push(r.converted_answer);
  }
  for (const doc of docs) {
    for (const t of new Set(tokenize(doc))) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const n = docs.length;
  const idf = new Map<string, number>();
  for (const [t, d] of df) idf.set(t, Math.log(1 + (n - d + 0.5) / (d + 0.5)));
  return idf;
}

function cosine(a: string, b: string, idf: Map<string, number>): number {
  const ta = termFreq(tokenize(a));
  const tb = termFreq(tokenize(b));
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [t, f] of ta) {
    const w = f * (idf.get(t) ?? 1);
    na += w * w;
    const g = tb.get(t);
    if (g !== undefined) dot += w * g * (idf.get(t) ?? 1);
  }
  for (const [t, f] of tb) {
    const w = f * (idf.get(t) ?? 1);
    nb += w * w;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/** BM25 of the answer against the ground truth, k1 = 1.2, b = 0.75. */
function bm25(groundTruth: string, answer: string, idf: Map<string, number>, avgLen: number): number {
  const q = tokenize(groundTruth);
  const d = termFreq(tokenize(answer));
  const dl = tokenize(answer).length;
  let score = 0;
  let max = 0;
  for (const t of new Set(q)) {
    const w = idf.get(t) ?? 1;
    max += w * ((1.2 + 1) / 1.2);
    const f = d.get(t);
    if (f === undefined) continue;
    score += w * ((f * (1.2 + 1)) / (f + 1.2 * (1 - 0.75 + (0.75 * dl) / avgLen)));
  }
  return max === 0 ? 0 : score / max;
}

export function predict(
  question: string,
  groundTruth: string,
  answer: string,
  idf: Map<string, number>,
  avgLen: number,
): number {
  const len = answer.length;
  return (
    0.25 * cosine(question, answer, idf) +
    0.5 * cosine(groundTruth, answer, idf) +
    0.15 * bm25(groundTruth, answer, idf, avgLen) +
    0.1 * (1 / (1 + Math.exp(-(len - 50) / 20)))
  );
}

/** Spearman rank correlation. */
function spearman(xs: number[], ys: number[]): number {
  const rank = (v: number[]): number[] => {
    const idx = v.map((value, i) => ({ value, i })).sort((a, b) => a.value - b.value);
    const out = new Array<number>(v.length);
    for (let i = 0; i < idx.length; ) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1]!.value === idx[i]!.value) j += 1;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k += 1) out[idx[k]!.i] = avg;
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
    num += (rx[i]! - mx) * (ry[i]! - my);
    dx += (rx[i]! - mx) ** 2;
    dy += (ry[i]! - my) ** 2;
  }
  return dx === 0 || dy === 0 ? 0 : num / Math.sqrt(dx * dy);
}

function main(): void {
  const receipts = JSON.parse(readFileSync(CORPUS, 'utf8')) as Receipt[];
  const idf = buildIdf(receipts);
  const lens = receipts
    .filter((r) => r.converted_answer)
    .map((r) => tokenize(r.converted_answer!).length);
  const avgLen = lens.reduce((a, b) => a + b, 0) / Math.max(1, lens.length);

  const args = process.argv.slice(2);
  const argOf = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i === -1 ? undefined : args[i + 1];
  };

  if (args.includes('--validate')) {
    const byIntent = new Map<string, Receipt[]>();
    for (const r of receipts) {
      if (!r.converted_answer) continue;
      const list = byIntent.get(r.intent) ?? [];
      list.push(r);
      byIntent.set(r.intent, list);
    }
    console.log('intent                    n   spearman(predicted, actual)');
    console.log('-'.repeat(60));
    const all: Array<[number, number]> = [];
    for (const [intent, rows] of [...byIntent].sort()) {
      const p = rows.map((r) => predict(r.question, r.ground_truth, r.converted_answer!, idf, avgLen));
      const a = rows.map((r) => r.score);
      for (let i = 0; i < p.length; i += 1) all.push([p[i]!, a[i]!]);
      const rho = spearman(p, a);
      const flag = Math.abs(rho) < 0.3 ? '   <-- weak, do not tune on this' : '';
      console.log(`${intent.padEnd(24)} ${String(rows.length).padStart(4)}   ${rho.toFixed(4)}${flag}`);
    }
    const rho = spearman(all.map((t) => t[0]), all.map((t) => t[1]));
    console.log('-'.repeat(60));
    console.log(`${'ALL'.padEnd(24)} ${String(all.length).padStart(4)}   ${rho.toFixed(4)}`);
    return;
  }

  const intent = argOf('--intent');
  const answer = argOf('--answer');
  if (!intent || !answer) {
    console.error('usage: --validate | --intent NAME --answer "text"');
    process.exit(1);
  }
  const rows = receipts.filter((r) => r.intent === intent);
  if (rows.length === 0) {
    console.error(`no receipts for ${intent}`);
    process.exit(1);
  }
  // Most recent question in the intent, which is what the next epoch is
  // most likely to repeat: the pool is small and questions recur verbatim.
  const latest = rows.reduce((a, b) => (a.epoch_id >= b.epoch_id ? a : b));
  const mine = predict(latest.question, latest.ground_truth, answer, idf, avgLen);
  const field = rows
    .filter((r) => r.question === latest.question && r.converted_answer)
    .map((r) => ({
      miner: r.miner,
      actual: r.score,
      predicted: predict(r.question, r.ground_truth, r.converted_answer!, idf, avgLen),
    }))
    .sort((a, b) => b.predicted - a.predicted);

  console.log(`Q: ${latest.question}\n`);
  console.log(`GT: ${latest.ground_truth.slice(0, 240)}\n`);
  console.log('predicted  actual      miner');
  for (const f of field) {
    console.log(`  ${f.predicted.toFixed(4)}   ${f.actual.toExponential(3)}  ${f.miner}`);
  }
  console.log(`  ${mine.toFixed(4)}   —           << your answer`);
  const better = field.filter((f) => f.predicted > mine).length;
  console.log(`\nprojected rank ${better + 1} of ${field.length + 1} on this question`);
}

main();
