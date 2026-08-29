export function nearestRankPercentile(sortedValues: readonly number[], percentile: number): number {
  if (sortedValues.length === 0) return 0;
  if (!Number.isFinite(percentile) || percentile < 0 || percentile > 1) {
    throw new RangeError('percentile must be between 0 and 1');
  }

  // Nearest-rank is deliberately conservative for a small reliability corpus:
  // p95 of 18 samples is the 18th value, so one timeout cannot disappear from
  // a public latency claim merely because the corpus is small.
  const rank = Math.max(1, Math.ceil(percentile * sortedValues.length));
  return sortedValues[rank - 1] ?? 0;
}
