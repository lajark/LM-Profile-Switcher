/**
 * Estimate-vs-measurement calibration (M5-003, PRD FR-07): a pure module that
 * compares an original engineer estimate (`LoadEstimate`) against measured
 * evidence (`BenchmarkResult.metrics.memoryPeakBytes`) and returns a *separate*
 * read-only verdict. It never mutates the estimate, never writes measured numbers
 * back into `provider:'exact'` data, and never touches the safety defaults
 * (`safe`/`recommendable`/`resourceFit`) — calibration is advisory only. The key
 * invariant is transparent here: when measured peak exceeds the estimate the
 * verdict reports `degraded` + the overrun, it does NOT hide the gap.
 *
 * Pure module: no Node built-ins, no I/O, no CJK.
 */
import type { BenchmarkResult, LoadEstimate } from '@lmps/domain';

/** Fraction above the estimate that counts as a silent degradation (10%). */
export const MEASUREMENT_TOLERANCE = 0.1;

export type CalibrationNote =
  | 'calibrated' // measured peak matched the estimate within tolerance
  | 'degraded' // measured peak exceeded the estimate beyond tolerance
  | 'unavailable'; // no usable completed measurement

export interface CalibrationVerdict {
  applied: boolean;
  comparedPeakBytes: number | null;
  estimatedTotalBytes: number | null;
  ratio: number | null;
  degraded: boolean;
  overrunBytes: number | null;
  confidence: 'measured' | 'low' | 'estimated';
  note: CalibrationNote;
}

/** Whole-footprint estimate: Total Memory, else VRAM + explicit System RAM. */
function estimatedTotal(estimate: LoadEstimate): number | null {
  if (typeof estimate.totalMemoryBytes === 'number') return estimate.totalMemoryBytes;
  if (estimate.vramTotalBytes === null || estimate.systemRamBytes === null) return null;
  return estimate.vramTotalBytes + estimate.systemRamBytes;
}

/**
 * Calibrate an estimate against a completed measurement. Returns a verdict that
 * is advisory only; the original `estimate` object is never changed and its
 * `provider:'exact'` data stays authoritative.
 */
export function calibrateEstimate(estimate: LoadEstimate, measured: BenchmarkResult): CalibrationVerdict {
  const measuredPeak = measured.metrics.memoryPeakBytes;
  if (measured.status !== 'completed' || typeof measuredPeak !== 'number') {
    return { applied: false, comparedPeakBytes: null, estimatedTotalBytes: null, ratio: null, degraded: false, overrunBytes: null, confidence: 'estimated', note: 'unavailable' };
  }

  const est = estimatedTotal(estimate);
  if (est === null || est <= 0) {
    return { applied: false, comparedPeakBytes: measuredPeak, estimatedTotalBytes: null, ratio: null, degraded: false, overrunBytes: null, confidence: 'estimated', note: 'unavailable' };
  }

  const ratio = measuredPeak / est;
  const degraded = measuredPeak > est * (1 + MEASUREMENT_TOLERANCE);
  return {
    applied: true,
    comparedPeakBytes: measuredPeak,
    estimatedTotalBytes: est,
    ratio: Math.round(ratio * 10000) / 10000,
    degraded,
    overrunBytes: degraded ? measuredPeak - est : null,
    confidence: degraded ? 'low' : 'measured',
    note: degraded ? 'degraded' : 'calibrated',
  };
}