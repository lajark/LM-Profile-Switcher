/**
 * Versioned estimate-vs-measurement calibration (M6-002, PRD FR-08).
 *
 * Only complete ResourceUsageEvidence v1 can be compared with an estimated
 * whole-model footprint. Legacy absolute-VRAM memoryPeakBytes remains visible
 * for compatibility but never participates in Total Memory calibration.
 * Observations below an estimate are advisory and keep estimated confidence;
 * only observations above the estimate can lower confidence/flag degradation.
 * This module is pure and never mutates or overwrites the original estimate.
 */
import type { BenchmarkResult, LoadEstimate, ResourceUsageEvidence } from '@lmps/domain';

/** Fraction above the estimate that counts as a silent degradation (10%). */
export const MEASUREMENT_TOLERANCE = 0.1;

export type CalibrationNote = 'calibrated' | 'degraded' | 'unavailable';
export type CalibrationRelation =
  | 'observed-below-estimate'
  | 'within-tolerance'
  | 'observed-above-estimate'
  | 'unavailable';

export interface CalibrationVerdict {
  /** Version of the calibration interpretation, independent of result schema. */
  calibrationVersion: 2;
  /** Resource evidence schema version used for the comparison, or null. */
  evidenceVersion: 1 | null;
  /** Evidence quality gate; only complete can be applied. */
  evidenceQuality: ResourceUsageEvidence['completeness'];
  relation: CalibrationRelation;
  rebenchmarkRequired: boolean;
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

function unavailable(
  measuredPeakBytes: number | null,
  evidence: ResourceUsageEvidence | undefined,
): CalibrationVerdict {
  return {
    calibrationVersion: 2,
    evidenceVersion: evidence?.schemaVersion === 1 ? 1 : null,
    evidenceQuality: evidence?.completeness ?? 'unavailable',
    relation: 'unavailable',
    rebenchmarkRequired: true,
    applied: false,
    comparedPeakBytes: measuredPeakBytes,
    estimatedTotalBytes: null,
    ratio: null,
    degraded: false,
    overrunBytes: null,
    confidence: 'estimated',
    note: 'unavailable',
  };
}

function completeEvidence(result: BenchmarkResult): ResourceUsageEvidence | null {
  const evidence = result.metrics.resourceUsage;
  if (
    evidence === undefined ||
    evidence.schemaVersion !== 1 ||
    evidence.method !== 'host-snapshot-delta' ||
    evidence.completeness !== 'complete'
  ) return null;
  const { vramBytes, systemRamBytes, totalBytes } = evidence.peakDelta;
  if (
    ![vramBytes, systemRamBytes, totalBytes].every(
      (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0,
    )
  ) {
    return null;
  }
  return evidence;
}

/**
 * Calibrates only complete v1 delta evidence. A legacy record or partial
 * evidence returns an explicit rebenchmark requirement and is never applied.
 */
export function calibrateEstimate(estimate: LoadEstimate, measured: BenchmarkResult): CalibrationVerdict {
  const legacyPeak = typeof measured.metrics.memoryPeakBytes === 'number' ? measured.metrics.memoryPeakBytes : null;
  const resourceEvidence = measured.metrics.resourceUsage;
  if (measured.status !== 'completed') return unavailable(legacyPeak, resourceEvidence);
  const evidence = completeEvidence(measured);
  if (evidence === null) return unavailable(legacyPeak, resourceEvidence);

  const observed = evidence.peakDelta.totalBytes;
  const est = estimatedTotal(estimate);
  if (observed === null || est === null || est <= 0) return unavailable(legacyPeak, evidence);

  const ratio = observed / est;
  const above = observed > est;
  const degraded = observed > est * (1 + MEASUREMENT_TOLERANCE);
  const relation: CalibrationRelation = degraded || above ? 'observed-above-estimate' : observed < est ? 'observed-below-estimate' : 'within-tolerance';
  return {
    calibrationVersion: 2,
    evidenceVersion: evidence.schemaVersion,
    evidenceQuality: evidence.completeness,
    relation,
    rebenchmarkRequired: false,
    applied: true,
    comparedPeakBytes: observed,
    estimatedTotalBytes: est,
    ratio: Math.round(ratio * 10000) / 10000,
    degraded,
    overrunBytes: degraded ? observed - est : null,
    // A low observation cannot endorse a stronger recommendation. Overrun
    // evidence lowers confidence; otherwise the estimate remains the gate.
    confidence: degraded || above ? 'low' : 'estimated',
    note: degraded ? 'degraded' : 'calibrated',
  };
}
