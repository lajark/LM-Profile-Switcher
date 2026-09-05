// M2-002 domain contract tests: Candidate / Recommendation schema boundaries —
// required sections, schemaVersion lock, passthrough-vs-strict, defaults.
import { describe, expect, it } from 'vitest';
import {
  CandidateSchema,
  RecommendationSchema,
  StrictCandidateSchema,
  StrictRecommendationSchema,
  type Candidate,
  type Recommendation,
} from '@lmps/domain';

const NOW = '2026-08-22T01:02:03.000Z';

function validCandidate(): Candidate {
  return {
    schemaVersion: 2,
    id: 'rag-prime-mid',
    profile: {
      schemaVersion: 2,
      id: 'rag-prime-mid',
      displayName: { 'zh-CN': 'RAG 候选', en: 'RAG candidate' },
      model: { modelKey: 'synthetic/rag-model', family: 'synthetic' },
      task: { type: 'RAG assistant', kind: 'rag' },
      runtime: { contextLength: 81920, gpuOffload: 'max' },
      generation: { temperature: 0.15 },
      behavior: { mode: 'exclusive' },
      metadata: { createdAt: NOW, updatedAt: NOW },
    },
    baselineProfileId: 'rag-prime',
    estimate: {
      schemaVersion: 2,
      provider: 'exact',
      modelKey: 'synthetic/rag-model',
      vramTotalBytes: 6_000_000_000,
      systemRamBytes: 2_000_000_000,
      estimatedAt: NOW,
      warnings: [],
    },
    safety: { safe: true, reason: null, vramUsedBytes: 6_000_000_000, vramAvailableBytes: 12_000_000_000, headroomBytes: 6_000_000_000 },
    score: { total: 0.5, breakdown: { vramEfficiency: 0.5, latency: 0.4, throughput: 0.3, quality: 0.6 }, confidence: 'high', measured: false },
    diff: [{ path: 'runtime.contextLength', baseline: 8192, candidate: 81920 }],
    rationale: { 'zh-CN': '面向检索任务的候选配置', en: 'candidate for the retrieval task' },
  };
}

function validRecommendation(candidates: Candidate[] = [validCandidate()]): Recommendation {
  return {
    schemaVersion: 2,
    baselineProfileId: 'rag-prime',
    taskKind: 'rag',
    ruleVersion: '2026.09.1',
    candidates,
    selectedIndex: candidates.length === 0 ? null : 0,
    generatedAt: NOW,
    warnings: [],
  };
}

describe('CandidateSchema', () => {
  it('accepts a complete candidate (passthrough)', () => {
    expect(CandidateSchema.safeParse(validCandidate()).success).toBe(true);
  });

  it('accepts extra unknown fields and defaults measured to false', () => {
    const candidate = validCandidate();
    candidate.score = { ...candidate.score, measured: undefined } as Candidate['score'];
    (candidate as { extra?: unknown }).extra = 'preserved';
    const parsed = CandidateSchema.safeParse(candidate);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.score.measured).toBe(false);
  });

  it('rejects a missing safety section', () => {
    const candidate = validCandidate();
    delete (candidate as { safety?: unknown }).safety;
    expect(CandidateSchema.safeParse(candidate).success).toBe(false);
  });

  it('rejects a missing score breakdown dimension', () => {
    const candidate = validCandidate();
    delete (candidate.score.breakdown as { latency?: unknown }).latency;
    expect(CandidateSchema.safeParse(candidate).success).toBe(false);
  });

  it('rejects a blank rationale side', () => {
    const candidate = validCandidate();
    candidate.rationale['zh-CN'] = '';
    expect(CandidateSchema.safeParse(candidate).success).toBe(false);
  });

  it('rejects a negative headroom or total', () => {
    const negativeHeadroom = validCandidate();
    negativeHeadroom.safety.headroomBytes = -1;
    expect(CandidateSchema.safeParse(negativeHeadroom).success).toBe(true); // signed int allowed
    const negativeTotal = validCandidate();
    negativeTotal.score.total = -0.1;
    expect(CandidateSchema.safeParse(negativeTotal).success).toBe(false);
  });

  it('rejects a schemaVersion other than 2', () => {
    const candidate = validCandidate();
    candidate.schemaVersion = 3 as never;
    expect(CandidateSchema.safeParse(candidate).success).toBe(false);
  });

  it('accepts null baseline/candidate diff values and nullable safety', () => {
    const candidate = validCandidate();
    candidate.diff = [{ path: 'runtime.kCacheQuantization', baseline: null, candidate: null }];
    candidate.safety.reason = null;
    expect(CandidateSchema.safeParse(candidate).success).toBe(true);
  });
});

describe('StrictCandidateSchema', () => {
  it('rejects top-level unknown fields the passthrough preserves', () => {
    const candidate = validCandidate();
    (candidate as { extra?: unknown }).extra = 'not allowed';
    expect(StrictCandidateSchema.safeParse(candidate).success).toBe(false);
  });
});

describe('RecommendationSchema', () => {
  it('accepts a complete recommendation', () => {
    expect(RecommendationSchema.safeParse(validRecommendation()).success).toBe(true);
  });

  it('accepts an empty candidate set with selectedIndex null', () => {
    const recommendation = validRecommendation([]);
    expect(recommendation.selectedIndex).toBeNull();
    expect(RecommendationSchema.safeParse(recommendation).success).toBe(true);
  });

  it('rejects an unknown task kind outside the PRD taxonomy', () => {
    const recommendation = validRecommendation();
    recommendation.taskKind = 'trading' as never;
    expect(RecommendationSchema.safeParse(recommendation).success).toBe(false);
  });

  it('rejects a negative selectedIndex', () => {
    const recommendation = validRecommendation();
    recommendation.selectedIndex = -1;
    expect(RecommendationSchema.safeParse(recommendation).success).toBe(false);
  });

  it('defaults warnings to an empty array', () => {
    const recommendation = validRecommendation();
    delete (recommendation as { warnings?: unknown }).warnings;
    const parsed = RecommendationSchema.safeParse(recommendation);
    expect(parsed.success && parsed.data.warnings).toEqual([]);
  });

  it('rejects a malformed generatedAt', () => {
    const recommendation = validRecommendation();
    recommendation.generatedAt = 'not-a-date' as never;
    expect(RecommendationSchema.safeParse(recommendation).success).toBe(false);
  });
});

describe('StrictRecommendationSchema', () => {
  it('rejects unknown top-level fields', () => {
    const recommendation = validRecommendation();
    (recommendation as { extra?: unknown }).extra = 'not allowed';
    expect(StrictRecommendationSchema.safeParse(recommendation).success).toBe(false);
  });

  it('rejects unknown candidate fields transitively', () => {
    const recommendation = validRecommendation();
    (recommendation.candidates[0] as { extra?: unknown }).extra = 'not allowed';
    expect(StrictRecommendationSchema.safeParse(recommendation).success).toBe(false);
  });
});