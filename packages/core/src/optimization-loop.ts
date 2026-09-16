/**
 * Model-first optimization loop (M7-004).
 *
 * This module owns the ordering and evidence rules for one model/scenario:
 * baseline preflight benchmark → bounded recommendation → selected-candidate
 * re-benchmark → explicit save. It does not call LM Studio or the file system;
 * those capabilities enter through the RecommendationService, BenchmarkService
 * and small persistence seams. Save, default selection and activation remain
 * separate operations.
 */
import type { BenchmarkResult, Candidate, CompositeProfile, Recommendation } from '@lmps/domain';

import type { BenchmarkRunOptions, BenchmarkService } from './benchmark.js';
import { isActivationError } from './errors.js';
import type { RecommendationService } from './recommendation.js';

export type OptimizationBenchmarkDecision = 'run' | 'skip' | 'not-run';
export type OptimizationCandidateEvidence = 'measured' | 'unmeasured' | 'failed' | 'canceled' | 'not-run';
export type OptimizationLoopStatus =
  | 'ready-to-save'
  | 'baseline-skipped'
  | 'baseline-failed'
  | 'candidate-skipped'
  | 'candidate-failed'
  | 'canceled'
  | 'no-candidate';

export interface OptimizationPreflightPort {
  /** Checks that the selected baseline can be tested without loading it. */
  check(profile: CompositeProfile): Promise<void>;
}

export interface OptimizationProfilePort {
  get(id: string): CompositeProfile;
  create(profile: CompositeProfile): CompositeProfile;
}

export interface OptimizationDefaultPort {
  get(modelKey: string, taskType: string): string | null;
  set(modelKey: string, taskType: string, profileId: string): unknown;
}

export interface OptimizationLoopPorts {
  recommendation: RecommendationService;
  benchmark: BenchmarkService;
  preflight: OptimizationPreflightPort;
  profiles: OptimizationProfilePort;
  defaults: OptimizationDefaultPort;
  now(): string;
}

export interface OptimizationPrepareOptions {
  /** Defaults to run. A skip is retained in the returned preparation. */
  baselineBenchmark?: Exclude<OptimizationBenchmarkDecision, 'not-run'>;
  /** Defaults to run. A skip permits save but marks the candidate unmeasured. */
  candidateBenchmark?: Exclude<OptimizationBenchmarkDecision, 'not-run'>;
  /** Explicit candidate id; otherwise Recommendation.selectedIndex is used. */
  candidateId?: string;
  /** Bounds and prompt suite forwarded to both benchmark phases. */
  benchmark?: Omit<BenchmarkRunOptions, 'signal'>;
  signal?: AbortSignal;
}

export interface OptimizationBenchmarkPhase {
  decision: OptimizationBenchmarkDecision;
  result: BenchmarkResult | null;
}

export interface OptimizationPreparation {
  baselineProfile: CompositeProfile;
  baselineBenchmark: OptimizationBenchmarkPhase;
  recommendation: Recommendation | null;
  selectedCandidate: Candidate | null;
  candidateBenchmark: OptimizationBenchmarkPhase;
  candidateEvidence: OptimizationCandidateEvidence;
  status: OptimizationLoopStatus;
}

export interface SaveOptimizationOptions {
  id: string;
  displayName?: CompositeProfile['displayName'];
  /** Explicitly promote this saved profile even when another default exists. */
  setDefault?: boolean;
}

export interface SavedOptimizationProfile {
  profile: CompositeProfile;
  isDefault: boolean;
}

export const OPTIMIZATION_ERROR_CODES = [
  'OPTIMIZATION_CANDIDATE_NOT_FOUND',
  'OPTIMIZATION_NO_CANDIDATE',
  'OPTIMIZATION_CANDIDATE_NOT_MEASURED',
  'OPTIMIZATION_DEFAULT_STALE',
  'OPTIMIZATION_PROFILE_MISMATCH',
] as const;
export type OptimizationErrorCode = (typeof OPTIMIZATION_ERROR_CODES)[number];

export function isOptimizationLoopError(error: unknown): error is OptimizationLoopError {
  return error instanceof OptimizationLoopError;
}

export class OptimizationLoopError extends Error {
  readonly code: OptimizationErrorCode;

  constructor(code: OptimizationErrorCode, message: string) {
    super(message);
    this.name = 'OptimizationLoopError';
    this.code = code;
  }
}

export interface OptimizationLoopService {
  prepare(baseline: CompositeProfile, options?: OptimizationPrepareOptions): Promise<OptimizationPreparation>;
  save(preparation: OptimizationPreparation, options: SaveOptimizationOptions): SavedOptimizationProfile;
  setDefault(profileId: string): CompositeProfile;
  getDefault(modelKey: string, taskType: string): CompositeProfile | null;
}

/** Build the loop against injected recommendation, benchmark and persistence seams. */
export function createOptimizationLoopService(ports: OptimizationLoopPorts): OptimizationLoopService {
  return {
    prepare: (baseline, options = {}) => prepare(ports, baseline, options),
    save: (preparation, options) => save(ports, preparation, options),
    setDefault: (profileId) => setDefault(ports, profileId),
    getDefault: (modelKey, taskType) => getDefault(ports, modelKey, taskType),
  };
}

async function prepare(
  ports: OptimizationLoopPorts,
  baseline: CompositeProfile,
  options: OptimizationPrepareOptions,
): Promise<OptimizationPreparation> {
  const baselineDecision = options.baselineBenchmark ?? 'run';
  const candidateDecision = options.candidateBenchmark ?? 'run';
  let baselineResult: BenchmarkResult | null = null;

  // Safety preflight is distinct from measurement: it may estimate resources
  // or check host policy, but it must not load the model.
  await ports.preflight.check(baseline);

  if (baselineDecision === 'run') {
    baselineResult = await ports.benchmark.run(baseline, { ...options.benchmark, signal: options.signal });
    if (baselineResult.status === 'canceled' || baselineResult.status === 'failed') {
      return {
        baselineProfile: baseline,
        baselineBenchmark: { decision: 'run', result: baselineResult },
        recommendation: null,
        selectedCandidate: null,
        candidateBenchmark: { decision: 'not-run', result: null },
        candidateEvidence: baselineResult.status === 'canceled' ? 'canceled' : 'failed',
        status: baselineResult.status === 'canceled' ? 'canceled' : 'baseline-failed',
      };
    }
  }

  let recommendation: Recommendation;
  try {
    recommendation = await ports.recommendation.recommend(baseline, { signal: options.signal });
  } catch (error) {
    if (isActivationError(error) && error.code === 'ACTIVATION_CANCELED') {
      return {
        baselineProfile: baseline,
        baselineBenchmark: { decision: baselineDecision, result: baselineResult },
        recommendation: null,
        selectedCandidate: null,
        candidateBenchmark: { decision: 'not-run', result: null },
        candidateEvidence: 'canceled',
        status: 'canceled',
      };
    }
    throw error;
  }
  const candidate = selectCandidate(recommendation, options.candidateId);
  if (candidate === null) {
    return {
      baselineProfile: baseline,
      baselineBenchmark: { decision: baselineDecision, result: baselineResult },
      recommendation,
      selectedCandidate: null,
      candidateBenchmark: { decision: 'not-run', result: null },
      candidateEvidence: 'not-run',
      status: 'no-candidate',
    };
  }

  if (candidateDecision === 'skip') {
    return {
      baselineProfile: baseline,
      baselineBenchmark: { decision: baselineDecision, result: baselineResult },
      recommendation,
      selectedCandidate: candidate,
      candidateBenchmark: { decision: 'skip', result: null },
      candidateEvidence: 'unmeasured',
      status: baselineDecision === 'skip' ? 'baseline-skipped' : 'candidate-skipped',
    };
  }

  const candidateResult = await ports.benchmark.run(candidate.profile, { ...options.benchmark, signal: options.signal });
  if (candidateResult.status === 'canceled') {
    return {
      baselineProfile: baseline,
      baselineBenchmark: { decision: baselineDecision, result: baselineResult },
      recommendation,
      selectedCandidate: candidate,
      candidateBenchmark: { decision: 'run', result: candidateResult },
      candidateEvidence: 'canceled',
      status: 'canceled',
    };
  }
  if (candidateResult.status === 'failed') {
    return {
      baselineProfile: baseline,
      baselineBenchmark: { decision: baselineDecision, result: baselineResult },
      recommendation,
      selectedCandidate: candidate,
      candidateBenchmark: { decision: 'run', result: candidateResult },
      candidateEvidence: 'failed',
      status: 'candidate-failed',
    };
  }
  return {
    baselineProfile: baseline,
    baselineBenchmark: { decision: baselineDecision, result: baselineResult },
    recommendation,
    selectedCandidate: candidate,
    candidateBenchmark: { decision: 'run', result: candidateResult },
    candidateEvidence: 'measured',
    status: 'ready-to-save',
  };
}

function selectCandidate(recommendation: Recommendation, candidateId?: string): Candidate | null {
  if (candidateId !== undefined) {
    const candidate = recommendation.candidates.find((entry) => entry.id === candidateId);
    if (candidate === undefined) throw new OptimizationLoopError('OPTIMIZATION_CANDIDATE_NOT_FOUND', 'candidate does not exist');
    return candidate;
  }
  if (recommendation.selectedIndex === null) return null;
  return recommendation.candidates[recommendation.selectedIndex] ?? null;
}

function save(
  ports: OptimizationLoopPorts,
  preparation: OptimizationPreparation,
  options: SaveOptimizationOptions,
): SavedOptimizationProfile {
  const candidate = preparation.selectedCandidate;
  if (candidate === null || preparation.recommendation === null) {
    throw new OptimizationLoopError('OPTIMIZATION_NO_CANDIDATE', 'no candidate is ready to save');
  }
  if (
    preparation.candidateEvidence === 'failed' ||
    preparation.candidateEvidence === 'canceled' ||
    preparation.candidateEvidence === 'not-run'
  ) {
    throw new OptimizationLoopError('OPTIMIZATION_CANDIDATE_NOT_MEASURED', 'candidate benchmark did not complete');
  }

  const timestamp = ports.now();
  const withoutValidation = { ...candidate.profile };
  delete withoutValidation.validation;
  const saved: CompositeProfile = {
    ...withoutValidation,
    id: options.id,
    ...(options.displayName === undefined ? {} : { displayName: options.displayName }),
    metadata: { ...candidate.profile.metadata, createdAt: timestamp, updatedAt: timestamp },
  };
  const result = preparation.candidateBenchmark.result;
  if (preparation.candidateEvidence === 'measured' && result?.status === 'completed') {
    saved.validation = {
      source: 'benchmarked',
      benchmarkId: result.id,
      testedAt: timestamp,
      hardwareFingerprint: result.hardwareFingerprint,
      lmStudioVersion: result.lmStudioVersion,
      runtimeVersion: result.runtimeVersion,
      adapterCapabilityVersion: result.adapterCapabilityVersion,
      memoryPeakBytes: result.metrics.memoryPeakBytes ?? null,
      ...(result.metrics.resourceUsage === undefined ? {} : { resourceUsage: result.metrics.resourceUsage }),
    };
  }
  // Read the existing selection before creating a document so a corrupted default index cannot leave a newly saved profile half-committed.
  const existingDefault = ports.defaults.get(saved.model.modelKey, saved.task.type);
  const created = ports.profiles.create(saved);
  const shouldBeDefault = options.setDefault === true || existingDefault === null;
  if (shouldBeDefault) ports.defaults.set(created.model.modelKey, created.task.type, created.id);
  return { profile: created, isDefault: shouldBeDefault };
}

function setDefault(ports: OptimizationLoopPorts, profileId: string): CompositeProfile {
  const profile = ports.profiles.get(profileId);
  ports.defaults.set(profile.model.modelKey, profile.task.type, profile.id);
  return profile;
}

function getDefault(ports: OptimizationLoopPorts, modelKey: string, taskType: string): CompositeProfile | null {
  const profileId = ports.defaults.get(modelKey, taskType);
  if (profileId === null) return null;
  let profile: CompositeProfile;
  try {
    profile = ports.profiles.get(profileId);
  } catch {
    throw new OptimizationLoopError('OPTIMIZATION_DEFAULT_STALE', 'default profile is missing');
  }
  if (profile.model.modelKey !== modelKey || profile.task.type !== taskType) {
    throw new OptimizationLoopError('OPTIMIZATION_PROFILE_MISMATCH', 'default profile does not match the model and scenario');
  }
  return profile;
}
