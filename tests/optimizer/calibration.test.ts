// M5-003 estimate-vs-measurement calibration: measured peak never overwrites the
// original estimate, never mutates inputs, never touches safety defaults, and
// NEVER hides degradation. Pure module.
import { describe, expect, it } from 'vitest';
import { calibrateEstimate, MEASUREMENT_TOLERANCE } from '@lmps/optimizer';
import type { BenchmarkResult, LoadEstimate } from '@lmps/domain';

import { GIB, NOW, makeExactEstimate } from './fixtures';

function measured(memoryPeakBytes: number | null, status: BenchmarkResult['status'] = 'completed'): BenchmarkResult {
  return {
    schemaVersion: 2,
    id: 'bench-1',
    modelKey: 'synthetic/rag-model',
    taskType: 'rag',
    status,
    metrics: { memoryPeakBytes, samples: 3, decodeTokensPerSecond: 60 },
    startedAt: NOW,
    finishedAt: NOW,
    hardwareFingerprint: 'fp',
    lmStudioVersion: '0.0.0',
  };
}

describe('calibrateEstimate', () => {
  it('is advisory-only: it never mutates the original estimate', () => {
    const estimate: LoadEstimate = makeExactEstimate({ vramTotalBytes: 8 * GIB, totalMemoryBytes: 10 * GIB, systemRamBytes: null });
    const snapshot = structuredClone(estimate);
    calibrateEstimate(estimate, measured(9 * GIB));
    expect(estimate).toEqual(snapshot);
    expect(estimate.provider).toBe('exact'); // authoritative data untouched
  });

  it('marks a completed, in-tolerance peak as calibrated with measured confidence', () => {
    const estimate = makeExactEstimate({ vramTotalBytes: 8 * GIB, totalMemoryBytes: 10 * GIB, systemRamBytes: null });
    const verdict = calibrateEstimate(estimate, measured(9 * GIB));
    expect(verdict.applied).toBe(true);
    expect(verdict.confidence).toBe('measured');
    expect(verdict.note).toBe('calibrated');
    expect(verdict.degraded).toBe(false);
    expect(verdict.overrunBytes).toBeNull();
    expect(verdict.comparedPeakBytes).toBe(9 * GIB);
    expect(verdict.estimatedTotalBytes).toBe(10 * GIB);
    expect(verdict.ratio).toBeCloseTo(0.9, 4);
  });

  it('REPORTS degradation when measured peak exceeds the estimate beyond tolerance', () => {
    const estimate = makeExactEstimate({ vramTotalBytes: 8 * GIB, totalMemoryBytes: 10 * GIB, systemRamBytes: null });
    const peak = 14 * GIB;
    const verdict = calibrateEstimate(estimate, measured(peak));
    expect(verdict.applied).toBe(true);
    expect(verdict.degraded).toBe(true);
    expect(verdict.note).toBe('degraded');
    expect(verdict.confidence).toBe('low'); // evidence overrode the optimistic estimate
    expect(verdict.overrunBytes).toBe(4 * GIB);
    expect(verdict.ratio).toBeCloseTo(1.4, 4);
  });

  it('keeps the tolerance threshold deterministic', () => {
    const estimate = makeExactEstimate({ vramTotalBytes: 8 * GIB, totalMemoryBytes: 10 * GIB, systemRamBytes: null });
    // Exactly (1 + tolerance) * estimate is NOT degraded (strictly greater is).
    const boundary = 10 * GIB * (1 + MEASUREMENT_TOLERANCE);
    expect(calibrateEstimate(estimate, measured(boundary)).degraded).toBe(false);
    expect(calibrateEstimate(estimate, measured(boundary + 1)).degraded).toBe(true);
  });

  it('ignores a non-completed or peak-less measurement (unavailable)', () => {
    const estimate = makeExactEstimate({ vramTotalBytes: 8 * GIB, totalMemoryBytes: 10 * GIB, systemRamBytes: null });
    expect(calibrateEstimate(estimate, measured(9 * GIB, 'failed')).note).toBe('unavailable');
    expect(calibrateEstimate(estimate, measured(9 * GIB, 'canceled')).applied).toBe(false);
    expect(calibrateEstimate(estimate, measured(null)).note).toBe('unavailable');
  });

  it('falls back to VRAM + System RAM when Total Memory is absent', () => {
    const estimate = makeExactEstimate({ vramTotalBytes: 8 * GIB, systemRamBytes: 2 * GIB });
    const verdict = calibrateEstimate(estimate, measured(9 * GIB));
    expect(verdict.estimatedTotalBytes).toBe(10 * GIB);
    expect(verdict.applied).toBe(true);
  });

  it('is unavailable when whole-footprint evidence cannot be derived', () => {
    const estimate = makeExactEstimate({ vramTotalBytes: 8 * GIB, totalMemoryBytes: null, systemRamBytes: null });
    expect(calibrateEstimate(estimate, measured(10 * GIB)).note).toBe('unavailable');
  });
});