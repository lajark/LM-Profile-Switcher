// M2-002 static scoring/diff/rationale: deterministic 0..1 proxies, unmeasured
// by contract, high confidence only on exact+safe, diff reports only changes,
// rationale stays bilingual and non-empty.
import { describe, expect, it } from 'vitest';
import { buildRationale, computeSafetyMargin, diffAgainst, scoreCandidate, SEED_RULE_CATALOG } from '@lmps/optimizer';
import type { Rule } from '@lmps/domain';

import { GIB, makeExactEstimate, makeHardware, makeRagBaseline } from './fixtures';

function ragRule(): Rule {
  const rule = SEED_RULE_CATALOG.rules.find((r) => r.taskKind === 'rag');
  if (rule === undefined) throw new Error('rag seed rule missing');
  return rule;
}

function scored(forceLow = false) {
  const profile = makeRagBaseline({
    runtime: { contextLength: 81920, gpuOffload: 'max', evalBatchSize: 20, flashAttention: true },
    generation: { temperature: 0.15 },
  });
  const rule = ragRule();
  const estimate = makeExactEstimate();
  const safety = computeSafetyMargin(estimate, makeHardware(), rule);
  return { profile, rule, estimate, safety, score: scoreCandidate(profile, rule, estimate, safety, forceLow) };
}

describe('scoreCandidate', () => {
  it('is deterministic and unmeasured by contract', () => {
    const { score } = scored();
    expect(score.measured).toBe(false);
    // Re-scoring the same inputs yields the same total.
    const again = scoreCandidate(scored().profile, scored().rule, scored().estimate, scored().safety, false);
    expect(again.total).toBe(score.total);
  });

  it('produces exact proxy totals for the rag mid-draft', () => {
    const { score } = scored();
    expect(score.breakdown).toEqual({ vramEfficiency: 0.5, latency: 0.4375, throughput: 0.039063, quality: 0.7625 });
    // 0.25*0.5 + 0.15*0.4375 + 0.35*0.0390625 + 0.25*0.7625
    expect(score.total).toBe(0.394922);
  });

  it('holds every sub-score in [0,1] and total >= 0', () => {
    const { score } = scored();
    for (const value of Object.values(score.breakdown)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(score.total).toBeGreaterThanOrEqual(0);
  });

  it('reports high confidence only for exact + safe without forceLow', () => {
    expect(scored(false).score.confidence).toBe('high');
    expect(scored(true).score.confidence).toBe('low');

    const rough = scored(false);
    const low = scoreCandidate(rough.profile, rough.rule, makeExactEstimate({ provider: 'rough' }), rough.safety, false);
    expect(low.confidence).toBe('low');
  });

  it('normalises scoring weights that do not sum to one', () => {
    const { profile, rule, estimate, safety } = scored();
    // Due-diligence weights sum to 1.0 already; use a deliberately skewed set.
    const skewed = { ...rule, scoringWeights: { vramEfficiency: 2, latency: 0, throughput: 0, quality: 0 } };
    const onlyVram = scoreCandidate(profile, skewed, estimate, safety, false);
    expect(onlyVram.total).toBeCloseTo(0.5, 6); // all weight on vramEfficiency = 0.5
  });
});

describe('diffAgainst', () => {
  it('reports only changed runtime/generation fields with dot paths', () => {
    const baseline = makeRagBaseline();
    const candidate = makeRagBaseline({
      runtime: { contextLength: 81920, evalBatchSize: 20, flashAttention: true }, // gpuOffload becomes undefined
      generation: { temperature: 0.15 },
    });
    const diff = diffAgainst(candidate, baseline);
    expect(diff).toEqual([
      { path: 'generation.temperature', baseline: 0.3, candidate: 0.15 },
      { path: 'runtime.contextLength', baseline: 8192, candidate: 81920 },
      { path: 'runtime.evalBatchSize', baseline: null, candidate: 20 },
      { path: 'runtime.flashAttention', baseline: null, candidate: true },
    ]);
  });

  it('reports an equal profile as an empty diff', () => {
    const baseline = makeRagBaseline();
    expect(diffAgainst(baseline, baseline)).toEqual([]);
  });

  it('ignores non-runtime/generation sections (model, task, behavior)', () => {
    const candidate = makeRagBaseline({ behavior: { mode: 'manual' } });
    expect(diffAgainst(candidate, makeRagBaseline())).toEqual([]);
  });
});

describe('buildRationale', () => {
  it('combines the rule rationale with a scoring note in both languages', () => {
    const { rule, safety, score } = scored();
    const rationale = buildRationale(rule, safety, score);
    expect(rationale.en).toBe(rule.rationale.en + ' Static score 0.395, high confidence, VRAM headroom 6.0 GiB.');
    expect(rationale['zh-CN']).toBe(rule.rationale['zh-CN'] + ' 该配置静态评分 0.395，高置信度，显存余量 6.0 GiB。');
  });

  it('omits the headroom clause for low-confidence candidates', () => {
    const { profile, rule, estimate, safety } = scored();
    const low = scoreCandidate(profile, rule, { ...estimate, provider: 'rough' }, safety, false);
    const rationale = buildRationale(rule, safety, low);
    expect(rationale.en).not.toContain('VRAM headroom');
    expect(rationale.en).toContain('low confidence');
    expect(rationale['zh-CN']).not.toContain('显存余量');
  });

  it('omits the headroom clause when the margin headroom is unknown', () => {
    const { profile, rule, safety } = scored();
    // A caller never feeds an unsafe margin in production; this guard only pins
    // the note-generation behaviour when headroom is unknown.
    const display = scoreCandidate(profile, rule, makeExactEstimate({ vramTotalBytes: null }), safety, false);
    const rationale = buildRationale(rule, { ...safety, headroomBytes: null }, display);
    expect(rationale.en).not.toContain('VRAM headroom');
    expect(rationale.en.length).toBeGreaterThan(0);
    expect(rationale['zh-CN'].length).toBeGreaterThan(0);
  });

  it('appends an explicit performance/resource warning and Benchmark guidance for Hybrid-memory candidates', () => {
    const rule = ragRule();
    const profile = makeRagBaseline({ runtime: { contextLength: 81920, gpuOffload: 0.5 } });
    const estimate = makeExactEstimate({ vramTotalBytes: 15.7 * GIB, totalMemoryBytes: 15.7 * GIB, systemRamBytes: null, gpuOffload: 0.5 });
    const safety = computeSafetyMargin(estimate, makeHardware(), rule);
    expect(safety.resourceFit).toBe('hybrid-memory');
    const score = scoreCandidate(profile, rule, estimate, safety, false);
    const rationale = buildRationale(rule, safety, score);
    expect(rationale.en).toContain('Benchmark');
    expect(rationale['zh-CN']).toContain('Benchmark');
  });

  it('does not append the Hybrid/Host guidance to a GPU-resident candidate', () => {
    const { rule, safety, score } = scored();
    expect(safety.resourceFit).toBe('gpu-resident');
    const rationale = buildRationale(rule, safety, score);
    expect(rationale.en).not.toContain('Benchmark');
    expect(rationale['zh-CN']).not.toContain('Benchmark');
  });
});