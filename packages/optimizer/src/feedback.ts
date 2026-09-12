/**
 * Measured-feedback loop: close the loop between the Benchmark audit
 * log and the candidate ranking. Candidates whose exact configuration was
 * measured on this host (matching `logs/benchmarks.ndjson` records) rank above
 * unmeasured ones — a real number on this machine beats any static estimate —
 * and measured candidates rank among themselves by decode throughput (70%)
 * blended with inverse TTFT (30%), both max-normalized inside the candidate
 * set. The static score stays untouched in `score.total` (cold-start prior),
 * the effective ranking value lands in `score.adjustedTotal`, and a measured
 * candidate's confidence is `high` because it is backed by evidence, not by
 * an `exact` estimate.
 *
 * Matching is value-based, never id-based: a draft derived from a baseline and
 * a saved clone profile compare equal when model identity, task type, the six
 * tunable parameters and the hardware fingerprint agree. Missing values on
 * both sides count as equal (both defer to LM Studio defaults).
 *
 * Pure module: deterministic, no I/O, no clock — `recordedAt` comes from the
 * records themselves.
 */
import type { BenchmarkResult, Candidate, CompositeProfile } from '@lmps/domain';

/** Evidence attached to a matched candidate (mirrors `score.measuredEvidence`). */
export interface MeasuredEvidence {
  decodeTokensPerSecond: number;
  ttftMs: number | null;
  samples: number;
  recordedAt: string;
}

/** Tunable parameters a measured record must agree on (see `configSnapshotOf`). */
type ConfigFields = Pick<
  CompositeProfile['runtime'] & CompositeProfile['generation'],
  'gpuOffload' | 'contextLength' | 'evalBatchSize' | 'flashAttention' | 'temperature' | 'topP'
>;

function configKeysOf(profile: CompositeProfile): ConfigFields {
  return {
    gpuOffload: profile.runtime.gpuOffload ?? null,
    contextLength: profile.runtime.contextLength ?? null,
    evalBatchSize: profile.runtime.evalBatchSize ?? null,
    flashAttention: profile.runtime.flashAttention ?? null,
    temperature: profile.generation.temperature ?? null,
    topP: profile.generation.topP ?? null,
  };
}

function configMatches(record: BenchmarkResult, keys: ConfigFields): boolean {
  const config = record.config;
  if (config === undefined || config === null) return false;
  for (const field of Object.keys(keys) as Array<keyof ConfigFields>) {
    const left = config[field] ?? null;
    const right = keys[field] ?? null;
    if (left !== right) return false;
  }
  return true;
}

/** Timestamp used for "most recent wins": finishedAt when present, else startedAt. */
function recordedAtOf(record: BenchmarkResult): string {
  return record.finishedAt ?? record.startedAt;
}

function fingerprintCompatible(recordFingerprint: string | null | undefined, current: string | null): boolean {
  const left = recordFingerprint ?? null;
  return left === null || current === null || left === current;
}

/**
 * Find the evidence for one candidate configuration: the most recent completed
 * record with a decode figure whose model identity, quantization, task type,
 * tunable parameters and hardware fingerprint all agree. `null` when nothing
 * measured this exact configuration on this host.
 */
export function matchMeasuredEvidence(
  results: readonly BenchmarkResult[],
  profile: CompositeProfile,
  hardwareFingerprint: string | null,
): MeasuredEvidence | null {
  const keys = configKeysOf(profile);
  let best: BenchmarkResult | null = null;
  for (const record of results) {
    if (record.status !== 'completed') continue;
    const decode = record.metrics.decodeTokensPerSecond;
    if (typeof decode !== 'number') continue;
    if (record.modelKey !== profile.model.modelKey) continue;
    if ((record.quantization ?? null) !== (profile.model.quantization ?? null)) continue;
    if (record.taskType !== profile.task.type) continue;
    if (!configMatches(record, keys)) continue;
    if (!fingerprintCompatible(record.hardwareFingerprint, hardwareFingerprint)) continue;
    if (best === null || recordedAtOf(record) >= recordedAtOf(best)) best = record;
  }
  if (best === null) return null;
  return {
    decodeTokensPerSecond: best.metrics.decodeTokensPerSecond as number,
    ttftMs: best.metrics.ttftMs ?? null,
    samples: best.metrics.samples ?? 0,
    recordedAt: recordedAtOf(best),
  };
}

function round(value: number, decimals = 4): number {
  return Math.round(value * 10 ** decimals) / 10 ** decimals;
}

/**
 * Effective ranking value for one measured candidate: 70% decode throughput +
 * 30% inverse TTFT, each max-normalized across the measured candidate set
 * (TTFT-free evidence holds the neutral 0.5). Unmeasured candidates keep their
 * static `total`.
 */
export function measuredBlend(evidence: MeasuredEvidence, maxDecode: number, maxTtftMs: number | null): number {
  const decodeNorm = maxDecode > 0 ? evidence.decodeTokensPerSecond / maxDecode : 0;
  const ttftNorm = evidence.ttftMs === null || maxTtftMs === null || maxTtftMs <= 0 ? 0.5 : 1 - evidence.ttftMs / maxTtftMs;
  return round(0.7 * decodeNorm + 0.3 * ttftNorm);
}

function effectiveTotal(candidate: Candidate): number {
  return candidate.score.adjustedTotal ?? candidate.score.total;
}

/**
 * Attach measured evidence to the scored candidates and return them re-sorted
 * by the effective ranking value (measured group first, then value desc, id
 * asc as the deterministic tie-break). Pure: the input array and its candidate
 * objects are never mutated; unmatched candidates come back unchanged.
 */
export function applyMeasuredFeedback(
  candidates: readonly Candidate[],
  results: readonly BenchmarkResult[],
  hardwareFingerprint: string | null,
): Candidate[] {
  const evidence = candidates.map((candidate) => matchMeasuredEvidence(results, candidate.profile, hardwareFingerprint));
  const measured = evidence.filter((item): item is MeasuredEvidence => item !== null);

  let maxDecode = 0;
  let maxTtft: number | null = null;
  for (const item of measured) {
    maxDecode = Math.max(maxDecode, item.decodeTokensPerSecond);
    if (item.ttftMs !== null) maxTtft = maxTtft === null ? item.ttftMs : Math.max(maxTtft, item.ttftMs);
  }

  const ranked = candidates.map((candidate, index) => {
    const item = evidence[index];
    if (item === undefined || item === null) return candidate;
    return {
      ...candidate,
      score: {
        ...candidate.score,
        measured: true,
        confidence: 'high',
        measuredEvidence: item,
        adjustedTotal: measuredBlend(item, maxDecode, maxTtft),
      },
    } satisfies Candidate;
  });

  return ranked.sort(
    (a, b) =>
      Number(b.score.measured) - Number(a.score.measured) ||
      effectiveTotal(b) - effectiveTotal(a) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
