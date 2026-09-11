// M2-002 deterministic draft generation + hard-constraint filtering. The rule
// under test is the rag seed (full constraint/hint shape, presets.ts).
import { describe, expect, it } from 'vitest';
import {
  filterByHardConstraints,
  generateCandidateDrafts,
  generateLadderDrafts,
  SEED_RULE_CATALOG,
  toCapabilityPath,
  type HardConstraintFilter,
} from '@lmps/optimizer';
import type { CapabilityMatrix, Rule } from '@lmps/domain';

import { makeCapability, makeRagBaseline } from './fixtures';

function ragRule(): Rule {
  const rule = SEED_RULE_CATALOG.rules.find((r) => r.taskKind === 'rag');
  if (rule === undefined) throw new Error('rag seed rule missing');
  return rule;
}

describe('generateCandidateDrafts', () => {
  it('is deterministic: identical input yields identical drafts', () => {
    const baseline = makeRagBaseline();
    const rule = ragRule();
    const once = generateCandidateDrafts(baseline, rule);
    const twice = generateCandidateDrafts(baseline, rule);
    expect(twice).toEqual(once);
  });

  it('keeps the baseline as the base and overlays hint fields only', () => {
    const baseline = makeRagBaseline();
    const [draft] = generateCandidateDrafts(baseline, ragRule());
    expect(draft).not.toBeUndefined();
    if (draft === undefined) return;
    expect(draft.profile.model).toEqual(baseline.model);
    expect(draft.profile.runtime.gpuOffload).toBe('max'); // untouched hint
    expect(draft.profile.behavior).toEqual(baseline.behavior);
    expect(draft.profile.metadata.createdAt).toBe(baseline.metadata.createdAt);
  });

  it('returns between 3 and 6 drafts for the rag rule', () => {
    const drafts = generateCandidateDrafts(makeRagBaseline(), ragRule());
    expect(drafts.length).toBeGreaterThanOrEqual(3);
    expect(drafts.length).toBeLessThanOrEqual(6);
  });

  it('returns an empty list for a missing or mismatched architecture', () => {
    // 'vision' is outside the rag rule's ['dense','moe'] applicability.
    const vision = makeRagBaseline({ model: { modelKey: 'vision/model', family: 'synthetic', architecture: 'vision' } });
    expect(generateCandidateDrafts(vision, ragRule())).toEqual([]);
    const unknownArch = makeRagBaseline(); // no architecture field
    delete (unknownArch.model as { architecture?: string }).architecture;
    expect(generateCandidateDrafts(unknownArch, ragRule())).toEqual([]);
    // The opposite: 'moe' is inside the rag list and must still produce drafts.
    const moe = makeRagBaseline({ model: { modelKey: 'moe/model', family: 'synthetic', architecture: 'moe' } });
    expect(generateCandidateDrafts(moe, ragRule()).length).toBeGreaterThanOrEqual(3);
  });

  it('ranges cover min, mid and max hint values', () => {
    const drafts = generateCandidateDrafts(makeRagBaseline(), ragRule());
    const contexts = new Set(drafts.map((d) => d.profile.runtime.contextLength));
    const batches = new Set(drafts.map((d) => d.profile.runtime.evalBatchSize));
    const temperatures = new Set(drafts.map((d) => d.profile.generation?.temperature));
    expect(contexts.has(32768)).toBe(true);
    expect(contexts.has(131072)).toBe(true);
    expect(batches.has(8)).toBe(true);
    expect(batches.has(32)).toBe(true);
    expect(temperatures.has(0)).toBe(true);
    expect(temperatures.has(0.3)).toBe(true);
  });

  it('assigns unique, rule-version-stable draft ids', () => {
    const baseline = makeRagBaseline();
    const drafts = generateCandidateDrafts(baseline, ragRule());
    const ids = new Set(drafts.map((d) => d.id));
    expect(ids.size).toBe(drafts.length);
    expect([...ids].every((id) => id.startsWith(`${baseline.id}-`))).toBe(true);
  });

  it('produces a head-only clone for a hint-less rule', () => {
    const baseline = makeRagBaseline();
    const rule = { ...ragRule(), parameterHints: {} };
    const drafts = generateCandidateDrafts(baseline, rule);
    expect(drafts).toEqual([{ id: 'rag-prime-head', profile: { ...baseline } }]);
  });

  it('produces a single variant for a bool-only rule', () => {
    const baseline = makeRagBaseline();
    const boolOnly: Rule = { ...ragRule(), parameterHints: { flashAttention: true } };
    const drafts = generateCandidateDrafts(baseline, boolOnly);
    expect(drafts.length).toBe(1);
    expect(drafts[0]?.id).toBe('rag-prime-min');
    expect(drafts[0]?.profile.runtime.flashAttention).toBe(true);
  });
});

describe('generateLadderDrafts', () => {
  it('returns the five offload-step drafts for a baseline', () => {
    const drafts = generateLadderDrafts(makeRagBaseline());
    expect(drafts).toHaveLength(5);
    expect(drafts.map((d) => d.profile.runtime.gpuOffload)).toEqual([1, 0.75, 0.5, 0.25, 0]);
    expect(drafts.map((d) => d.id)).toEqual([
      'rag-prime-offload-100',
      'rag-prime-offload-75',
      'rag-prime-offload-50',
      'rag-prime-offload-25',
      'rag-prime-offload-0',
    ]);
    expect(new Set(drafts.map((d) => d.id)).size).toBe(5);
  });

  it('preserves the model and task in every ladder draft', () => {
    const baseline = makeRagBaseline();
    for (const draft of generateLadderDrafts(baseline)) {
      expect(draft.profile.model).toEqual(baseline.model);
      expect(draft.profile.task).toEqual(baseline.task);
    }
  });
});

describe('toCapabilityPath', () => {
  it('prefixes bare names with runtime.', () => {
    expect(toCapabilityPath('contextLength')).toBe('runtime.contextLength');
    expect(toCapabilityPath('flashAttention')).toBe('runtime.flashAttention');
  });

  it('passes dotted paths through unchanged', () => {
    expect(toCapabilityPath('runtime.kCacheQuantization')).toBe('runtime.kCacheQuantization');
  });
});

describe('filterByHardConstraints', () => {
  function filter(
    rule: Rule = ragRule(),
    capability: CapabilityMatrix = makeCapability(),
    baseline = makeRagBaseline(),
  ): HardConstraintFilter {
    return filterByHardConstraints(generateCandidateDrafts(baseline, rule), rule, capability);
  }

  it('keeps every rag draft on a full exact capability matrix', () => {
    const result = filter();
    expect(result.rejected).toEqual([]);
    expect(result.lowConfidence).toEqual([]);
    expect(result.kept.length).toBeGreaterThanOrEqual(3);
  });

  it('drops drafts below minContextLength', () => {
    const rule = { ...ragRule(), constraints: { ...ragRule().constraints, minContextLength: 1_000_000 } };
    const result = filter(rule, makeCapability());
    expect(result.kept).toEqual([]);
    expect(result.rejected).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: 'context-too-small' })]),
    );
  });

  it('drops drafts when concurrency exceeds maxConcurrency', () => {
    const rule = { ...ragRule(), constraints: { ...ragRule().constraints, maxConcurrency: 1 } };
    const result = filter(rule, makeCapability(), makeRagBaseline({ task: { type: 'rag', kind: 'rag', concurrency: 2 } }));
    expect(result.kept).toEqual([]);
    expect(result.rejected).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: 'concurrency-too-high' })]),
    );
  });

  it('drops drafts whose required capability is unavailable', () => {
    const capability = makeCapability({
      capabilities: [
        { field: 'runtime.contextLength', support: 'exact' },
        { field: 'runtime.flashAttention', support: 'unavailable' },
      ],
    });
    const result = filter(ragRule(), capability);
    expect(result.kept).toEqual([]);
    expect(result.rejected).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: 'capability-unavailable' })]),
    );
  });

  it('keeps drafts with unknown capabilities but flags low confidence', () => {
    const capability = makeCapability({
      capabilities: [
        { field: 'runtime.contextLength', support: 'exact' },
        { field: 'runtime.flashAttention', support: 'unknown' },
      ],
    });
    const result = filter(ragRule(), capability);
    expect(result.kept.length).toBeGreaterThanOrEqual(3);
    // lowConfidence carries the kept draft ids the estimator could not prove.
    const keptIds = result.kept.map((d) => d.id).sort();
    expect([...result.lowConfidence].sort()).toEqual(keptIds);
  });

  it('rejects when a required capability is missing from the matrix entirely', () => {
    const capability = makeCapability({ capabilities: [{ field: 'runtime.contextLength', support: 'exact' }] });
    const result = filter(ragRule(), capability);
    expect(result.kept).toEqual([]);
  });
});