import { readFile } from 'node:fs/promises';
import { nearestRankPercentile } from '../src/observability/benchmark.js';
import { verifyTLS } from '../src/tls/verify.js';
import { toTelegraphResponse } from '../src/telegraph/response.js';

interface BenchmarkCase {
  name: string;
  input: string;
  expectedVerdict: string;
}
interface CaseResult {
  name: string;
  input: string;
  expectedVerdict: string;
  actualVerdict: string;
  correct: boolean;
  latencyMs: number;
  failureCode: string;
  error?: string;
}

const corpus = JSON.parse(
  await readFile(new URL('../tests/benchmark-corpus.json', import.meta.url), 'utf8'),
) as BenchmarkCase[];
const only = process.argv.find((arg) => arg.startsWith('--case='))?.slice('--case='.length);
const json = process.argv.includes('--json');
const cases = only ? corpus.filter((item) => item.name === only || item.input === only) : corpus;
if (cases.length === 0) throw new Error(`no benchmark case matched ${only}`);

const results: CaseResult[] = [];
for (const item of cases) {
  const started = performance.now();
  try {
    const verified = await verifyTLS(item.input);
    const response = toTelegraphResponse(verified);
    results.push({
      name: item.name,
      input: item.input,
      expectedVerdict: item.expectedVerdict,
      actualVerdict: response.verdict,
      correct: response.verdict === item.expectedVerdict,
      latencyMs: Math.round(performance.now() - started),
      failureCode: verified.failureCode,
    });
  } catch (error) {
    results.push({
      name: item.name,
      input: item.input,
      expectedVerdict: item.expectedVerdict,
      actualVerdict: 'error',
      correct: false,
      latencyMs: Math.round(performance.now() - started),
      failureCode: 'UNKNOWN',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const latencies = results.map((item) => item.latencyMs).sort((a, b) => a - b);
const correct = results.filter((item) => item.correct).length;
const reasonCounts = Object.fromEntries(
  [...new Set(results.map((item) => item.failureCode))]
    .sort()
    .map((reason) => [reason, results.filter((item) => item.failureCode === reason).length]),
);
const summary = {
  totalCases: results.length,
  correct,
  incorrect: results.length - correct,
  errors: results.filter((item) => item.actualVerdict === 'error').length,
  accuracy: correct / results.length,
  averageLatencyMs: results.reduce((sum, item) => sum + item.latencyMs, 0) / results.length,
  p50: nearestRankPercentile(latencies, 0.5),
  p95: nearestRankPercentile(latencies, 0.95),
  p99: nearestRankPercentile(latencies, 0.99),
  failuresByReason: reasonCounts,
  results,
};
if (json) process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
else {
  process.stdout.write(
    `PREFLIGHT benchmark\nTotal: ${summary.totalCases}\nCorrect: ${summary.correct}\nIncorrect: ${summary.incorrect}\nErrors: ${summary.errors}\nAccuracy: ${(summary.accuracy * 100).toFixed(2)}%\nAverage latency: ${summary.averageLatencyMs.toFixed(1)} ms\np50/p95/p99: ${summary.p50}/${summary.p95}/${summary.p99} ms\nFailures by reason: ${JSON.stringify(summary.failuresByReason)}\n`,
  );
  for (const result of results)
    if (!result.correct)
      process.stdout.write(
        `  FAIL ${result.name}: expected ${result.expectedVerdict}, got ${result.actualVerdict} (${result.failureCode})\n`,
      );
}
