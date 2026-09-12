// Measured-feedback loop (方案B): value-based matching of benchmark records to
// candidate configurations, measured-first ranking with the 70/30 decode/TTFT
// blend, and purity of the transformation. Cross-checks that the optimizer's
// local config projection stays in sync with the benchmark package's
// `configSnapshotOf` (the record writer).
import { describe, expect, it } from 'vitest';
import { applyMeasuredFeedback, matchMeasuredEvidence, measuredBlend } from '@lmps/optimizer';
import { configSnapshotOf } from '@lmps/benchmark';
import type { BenchmarkResult, Candidate, CompositeProfile } from '@lmps/domain';

import { NOW, makeRagBaseline } from './fixtures';

const FINGERPRINT = 'fp-5060ti';

function makeResult(overrides: Partial<BenchmarkResult> = {}): BenchmarkResult {
  // Real records always carry the full six-key snapshot (configSnapshotOf), so
  // the fixture does too — only profileId is replaced to prove ids never match.
  const snapshot = configSnapshotOf(makeRagBaseline());
  return {
    schemaVersion: 2,
    id: 'bench-1',
    modelKey: 'synthetic/rag-model',
    quantization: null,
    taskType: 'RAG assistant',
    status: 'completed',
    metrics: { decodeTokensPerSecond: 20, ttftMs: 200, samples: 3 },
    hardwareFingerprint: FINGERPRINT,
    startedAt: NOW,
    finishedAt: NOW,
    errorCode: null,
    config: { ...snapshot, profileId: 'rag-clone' },
    ...overrides,
  };
}

function makeCandidate(id: string, overrides: Partial<CompositeProfile> = {}, score: Partial<Candidate['score']> = {}): Candidate {
  const profile = makeRagBaseline({ id, ...overrides });
  return {
    schemaVersion: 2,
    id,
    profile,
    baselineProfileId: 'rag-prime',
    estimate: {
      schemaVersion: 2,
      provider: 'exact',
      modelKey: 'synthetic/rag-model',
      vramTotalBytes: 6 * 1024 ** 3,
      systemRamBytes: 2 * 1024 ** 3,
      estimatedAt: NOW,
      warnings: [],
    },
    safety: {
      safe: true,
      reason: null,
      vramUsedBytes: 6 * 1024 ** 3,
      vramAvailableBytes: 12 * 1024 ** 3,
      headroomBytes: 6 * 1024 ** 3,
      resourceFit: 'gpu-resident',
      recommendable: true,
      vramReserveBytes: 1024 ** 3,
      ramUsedBytes: null,
      ramAvailableBytes: null,
      ramReserveBytes: null,
      ramHeadroomBytes: null,
    },
    score: {
      total: 0.5,
      breakdown: { vramEfficiency: 0.5, latency: 0.5, throughput: 0.5, quality: 0.5 },
      confidence: 'high',
      measured: false,
      ...score,
    },
    diff: [],
    rationale: { 'zh-CN': '理由', en: 'rationale' },
  };
}

describe('configSnapshotOf sync guard', () => {
  it('optimizer matching keys equal the benchmark record projection (minus profileId)', () => {
    const profile = makeRagBaseline({ runtime: { contextLength: 4096, gpuOffload: 0.75, flashAttention: true }, generation: { temperature: 0.7, topP: 0.9 } });
    const snapshot = configSnapshotOf(profile);
    const keys = { ...snapshot, profileId: null };
    expect(keys).toEqual({
      profileId: null,
      gpuOffload: 0.75,
      contextLength: 4096,
      evalBatchSize: null,
      flashAttention: true,
      temperature: 0.7,
      topP: 0.9,
    });
  });
});

describe('matchMeasuredEvidence', () => {
  it('matches a completed record by model identity, task type, config values and fingerprint', () => {
    const evidence = matchMeasuredEvidence([makeResult()], makeRagBaseline(), FINGERPRINT);
    expect(evidence).not.toBeNull();
    expect(evidence?.decodeTokensPerSecond).toBe(20);
    expect(evidence?.samples).toBe(3);
    expect(evidence?.recordedAt).toBe(NOW);
  });

  it('ignores failed/canceled records and records without a decode figure', () => {
    const failed = makeResult({ status: 'failed' });
    const noDecode = makeResult({ metrics: { samples: 3 } });
    expect(matchMeasuredEvidence([failed, noDecode], makeRagBaseline(), FINGERPRINT)).toBeNull();
  });

  it('rejects mismatches on modelKey, quantization, taskType, config and fingerprint', () => {
    const base = makeRagBaseline();
    expect(matchMeasuredEvidence([makeResult({ modelKey: 'other/model' })], base, FINGERPRINT)).toBeNull();
    expect(matchMeasuredEvidence([makeResult({ quantization: 'Q8_0' })], base, FINGERPRINT)).toBeNull();
    expect(matchMeasuredEvidence([makeResult({ taskType: 'coding' })], base, FINGERPRINT)).toBeNull();
    expect(matchMeasuredEvidence([makeResult({ config: { ...configSnapshotOf(makeRagBaseline()), profileId: 'x', gpuOffload: 0.25 } })], base, FINGERPRINT)).toBeNull();
    expect(matchMeasuredEvidence([makeResult({ hardwareFingerprint: 'other-gpu' })], base, FINGERPRINT)).toBeNull();
  });

  it('treats null/undefined config values on both sides as equal (defer-to-defaults)', () => {
    const profile = makeRagBaseline({ runtime: { gpuOffload: null }, generation: {} });
    const record = makeResult({ config: { profileId: 'x', gpuOffload: null } });
    expect(matchMeasuredEvidence([record], profile, FINGERPRINT)).not.toBeNull();
  });

  it('ignores legacy records without a config snapshot', () => {
    expect(matchMeasuredEvidence([makeResult({ config: undefined })], makeRagBaseline(), FINGERPRINT)).toBeNull();
  });

  it('prefers the most recent matching record', () => {
    const older = makeResult({ id: 'old', metrics: { decodeTokensPerSecond: 10, samples: 3 }, finishedAt: '2026-08-01T00:00:00.000Z' });
    const newer = makeResult({ id: 'new', metrics: { decodeTokensPerSecond: 30, samples: 3 }, finishedAt: '2026-09-01T00:00:00.000Z' });
    const evidence = matchMeasuredEvidence([older, newer], makeRagBaseline(), FINGERPRINT);
    expect(evidence?.decodeTokensPerSecond).toBe(30);
  });

  it('accepts records with a null fingerprint when the current host reports one', () => {
    expect(matchMeasuredEvidence([makeResult({ hardwareFingerprint: null })], makeRagBaseline(), FINGERPRINT)).not.toBeNull();
  });
});

describe('measuredBlend', () => {
  it('weights decode 70% and inverse TTFT 30% with max-normalization', () => {
    const fastest = { decodeTokensPerSecond: 20, ttftMs: 100, samples: 3, recordedAt: NOW };
    const slowest = { decodeTokensPerSecond: 10, ttftMs: 200, samples: 3, recordedAt: NOW };
    expect(measuredBlend(fastest, 20, 200)).toBeCloseTo(0.7 + 0.15, 4);
    expect(measuredBlend(slowest, 20, 200)).toBeCloseTo(0.35, 4);
  });

  it('holds the neutral 0.5 TTFT share when evidence carries no TTFT', () => {
    const noTtft = { decodeTokensPerSecond: 20, ttftMs: null, samples: 3, recordedAt: NOW };
    expect(measuredBlend(noTtft, 20, null)).toBeCloseTo(0.7 + 0.15, 4);
  });
});

describe('applyMeasuredFeedback', () => {
  it('ranks a measured candidate above statically stronger unmeasured ones', () => {
    // c-static carries a config no record measured (context 4096) so only
    // c-measured collects evidence despite the weaker static total.
    const measured = makeCandidate('c-measured', {}, { total: 0.4 });
    const unmeasured = makeCandidate('c-static', { runtime: { contextLength: 4096, gpuOffload: 'max' } }, { total: 0.9 });
    const ranked = applyMeasuredFeedback([unmeasured, measured], [makeResult()], FINGERPRINT);
    expect(ranked[0]?.id).toBe('c-measured');
    expect(ranked[0]?.score.measured).toBe(true);
    expect(ranked[0]?.score.confidence).toBe('high');
    expect(ranked[0]?.score.measuredEvidence?.decodeTokensPerSecond).toBe(20);
    expect(ranked[0]?.score.adjustedTotal).toBeDefined();
    expect(ranked[1]?.score.measured).toBe(false);
    expect(ranked[1]?.score.adjustedTotal).toBeUndefined();
  });

  it('orders measured candidates by decode throughput', () => {
    const slow = makeCandidate('c-slow', { runtime: { contextLength: 8192, gpuOffload: 0.25 } }, { total: 0.9 });
    const fast = makeCandidate('c-fast', { runtime: { contextLength: 8192, gpuOffload: 'max' } }, { total: 0.4 });
    const results = [
      makeResult({ id: 'r-slow', config: { ...configSnapshotOf(slow.profile), profileId: 'x' }, metrics: { decodeTokensPerSecond: 5, ttftMs: 300, samples: 3 } }),
      makeResult({ id: 'r-fast', config: { ...configSnapshotOf(fast.profile), profileId: 'y' }, metrics: { decodeTokensPerSecond: 10, ttftMs: 150, samples: 3 } }),
    ];
    const ranked = applyMeasuredFeedback([slow, fast], results, FINGERPRINT);
    expect(ranked.map((c) => c.id)).toEqual(['c-fast', 'c-slow']);
  });

  it('is pure: inputs are not mutated', () => {
    const candidate = makeCandidate('c-1', {}, { total: 0.4 });
    const ranked = applyMeasuredFeedback([candidate], [makeResult()], FINGERPRINT);
    expect(candidate.score.measured).toBe(false);
    expect(ranked[0]).not.toBe(candidate);
  });

  it('keeps the static order when nothing matches (id tie-break preserved)', () => {
    const a = makeCandidate('a', {}, { total: 0.4 });
    const b = makeCandidate('b', {}, { total: 0.4 });
    const ranked = applyMeasuredFeedback([b, a], [], FINGERPRINT);
    expect(ranked.map((c) => c.id)).toEqual(['a', 'b']);
  });
});
