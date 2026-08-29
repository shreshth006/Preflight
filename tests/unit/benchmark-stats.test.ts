import { describe, expect, it } from 'vitest';
import { nearestRankPercentile } from '../../src/observability/benchmark.js';

describe('benchmark percentiles', () => {
  it('does not hide a single timeout in the 95th percentile of a small corpus', () => {
    const latencies = [...Array.from({ length: 17 }, (_, index) => index + 1), 15_000];
    expect(nearestRankPercentile(latencies, 0.5)).toBe(9);
    expect(nearestRankPercentile(latencies, 0.95)).toBe(15_000);
    expect(nearestRankPercentile(latencies, 0.99)).toBe(15_000);
  });

  it('handles empty input and rejects invalid percentile values', () => {
    expect(nearestRankPercentile([], 0.95)).toBe(0);
    expect(() => nearestRankPercentile([1], 1.01)).toThrow(RangeError);
  });
});
