// M2-002 end-to-end pure pipeline: unsafe candidates never appear, ordering is
// by descending score, warnings carry stable codes, and the output satisfies the
// strict machine contract (the generator itself throws otherwise).
import { describe, expect, it } from 'vitest';
import { generateCandidateDrafts, generateRecommendation, SEED_RULE_CATALOG } from '@lmps/optimizer';
import { StrictRecommendationSchema } from '@lmps/domain';
import type { Rule } from '@lmps/domain';

import { NOW, RULE_VERSION, makeCapability, makeExactEstimate, makeHardware, makeRagBaseline } from './fixtures';

const { GIB } = { GIB: 1024 ** 3 };

function ragRule(): Rule {
  const rule = SEED_RULE_CATALOG.rules.find((r) => r.taskKind === 'rag');
  if (rule === undefined) throw new Error('rag seed rule missing');
  return rule;
}

function exactEstimates(): Map<string, ReturnType<typeof makeExactEstimate>> {
  const map = new Map<string, ReturnType<typeof makeExactEstimate>>();
  for (const draft of generateCandidateDrafts(makeRagBaseline(), ragRule())) {
    map.set(draft.id, makeExactEstimate());
  }
  return map;
}

describe('generateRecommendation', () => {
  it('assembles 3-6 safe, strictly-valid candidates ranked by score', () => {
    const recommendation = generateRecommendation(
      makeRagBaseline(),
      ragRule(),
      exactEstimates(),
      makeCapability(),
      makeHardware(),
      NOW,
      RULE_VERSION,
    );
    expect(StrictRecommendationSchema.safeParse(recommendation).success).toBe(true);
    expect(recommendation.baselineProfileId).toBe('rag-prime');
    expect(recommendation.taskKind).toBe('rag');
    expect(recommendation.ruleVersion).toBe(RULE_VERSION);
    expect(recommendation.generatedAt).toBe(NOW);
    expect(recommendation.warnings).toEqual([]);
    expect(recommendation.selectedIndex).toBe(0);
    expect(recommendation.candidates.length).toBeGreaterThanOrEqual(3);
    expect(recommendation.candidates.length).toBeLessThanOrEqual(6);

    for (const candidate of recommendation.candidates) {
      expect(candidate.safety.safe).toBe(true);
      expect(candidate.score.confidence).toBe('high');
      expect(candidate.estimate.provider).toBe('exact');
      expect(candidate.rationale.en.length).toBeGreaterThan(0);
      expect(candidate.rationale['zh-CN'].length).toBeGreaterThan(0);
      expect(candidate.diff.length).toBeGreaterThan(0);
    }

    // Strictly non-increasing totals; full context + batch with zero temperature
    // (the low-high mix) outranks every other rag draft.
    for (let i = 0; i < recommendation.candidates.length - 1; i += 1) {
      const a = recommendation.candidates[i]!;
      const b = recommendation.candidates[i + 1]!;
      expect(a.score.total).toBeGreaterThanOrEqual(b.score.total);
    }
    expect(recommendation.candidates[0]?.id).toBe('rag-prime-low-high');
  });

  it('is deterministic: identical inputs yield an identical recommendation', () => {
    const baseline = makeRagBaseline();
    const rule = ragRule();
    const inputs = (): [typeof baseline, typeof rule, Map<string, ReturnType<typeof makeExactEstimate>>, ReturnType<typeof makeCapability>, ReturnType<typeof makeHardware>, string, string] => [
      baseline,
      rule,
      exactEstimates(),
      makeCapability(),
      makeHardware(),
      NOW,
      RULE_VERSION,
    ];
    const first = generateRecommendation(...inputs());
    const second = generateRecommendation(...inputs());
    expect(second).toEqual(first);
  });

  it('drops every candidate and clears the winner when safety fails closed', () => {
    const roughEstimates = new Map(
      [...exactEstimates().entries()].map(([id]) => [id, makeExactEstimate({ provider: 'rough' })] as const),
    );
    const recommendation = generateRecommendation(
      makeRagBaseline(),
      ragRule(),
      roughEstimates,
      makeCapability(),
      makeHardware(),
      NOW,
      RULE_VERSION,
    );
    expect(recommendation.candidates).toEqual([]);
    expect(recommendation.selectedIndex).toBeNull();
    expect(recommendation.warnings).toContain('unsafe-drop:rough-estimate');
  });

  it('drops a candidate whose estimate is missing and warns by id', () => {
    const estimates = exactEstimates();
    const missingId = [...estimates.keys()][0];
    expect(missingId).toBeDefined();
    if (missingId === undefined) return;
    estimates.delete(missingId);

    const recommendation = generateRecommendation(
      makeRagBaseline(),
      ragRule(),
      estimates,
      makeCapability(),
      makeHardware(),
      NOW,
      RULE_VERSION,
    );
    expect(recommendation.candidates.length).toBeLessThan(6);
    expect(recommendation.candidates.every((candidate) => candidate.id !== missingId)).toBe(true);
    expect(recommendation.warnings).toContain(`estimate-missing:${missingId}`);
  });

  it('flags unknown capabilities and downgrades confidence without dropping', () => {
    const capability = makeCapability({
      capabilities: [
        { field: 'runtime.contextLength', support: 'exact' },
        { field: 'runtime.flashAttention', support: 'unknown' },
      ],
    });
    const recommendation = generateRecommendation(
      makeRagBaseline(),
      ragRule(),
      exactEstimates(),
      capability,
      makeHardware(),
      NOW,
      RULE_VERSION,
    );
    expect(recommendation.warnings).toContain('unknown-capability');
    expect(recommendation.candidates.length).toBeGreaterThanOrEqual(3);
    expect(recommendation.candidates.every((candidate) => candidate.score.confidence === 'low')).toBe(true);
  });

  it('reports an architecture mismatch as empty candidates', () => {
    // 'vision' sits outside the rag rule's ['dense','moe'] applicability.
    const visionBaseline = makeRagBaseline({ model: { modelKey: 'vision/model', family: 'synthetic', architecture: 'vision' } });
    const recommendation = generateRecommendation(
      visionBaseline,
      ragRule(),
      exactEstimates(),
      makeCapability(),
      makeHardware(),
      NOW,
      RULE_VERSION,
    );
    expect(recommendation.candidates).toEqual([]);
    expect(recommendation.selectedIndex).toBeNull();
    expect(recommendation.warnings).toEqual(['architecture-mismatch']);
  });

  it('over-vram candidates are dropped with a stable reason code', () => {
    const estimates = exactEstimates();
    const [firstId] = estimates.keys();
    estimates.set(firstId!, makeExactEstimate({ vramTotalBytes: 20 * GIB }));
    const recommendation = generateRecommendation(
      makeRagBaseline(),
      ragRule(),
      estimates,
      makeCapability(),
      makeHardware(),
      NOW,
      RULE_VERSION,
    );
    expect(recommendation.candidates.some((candidate) => candidate.id === firstId)).toBe(false);
    expect(recommendation.warnings).toContain('unsafe-drop:over-vram');
  });
});