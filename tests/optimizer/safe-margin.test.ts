// M2-002 VRAM safety margin: exact estimates within available VRAM pass; rough
// estimates, over-VRAM, unprobed GPUs and unmet rule floors fail closed.
import { describe, expect, it } from 'vitest';
import { computeSafetyMargin, SEED_RULE_CATALOG } from '@lmps/optimizer';
import type { Rule } from '@lmps/domain';

import { GIB, makeExactEstimate, makeHardware, makeRagBaseline } from './fixtures';

function ragRule(): Rule {
  const rule = SEED_RULE_CATALOG.rules.find((r) => r.taskKind === 'rag');
  if (rule === undefined) throw new Error('rag seed rule missing');
  return rule;
}

describe('computeSafetyMargin', () => {
  it('is safe with headroom when exact use fits available VRAM', () => {
    const margin = computeSafetyMargin(makeExactEstimate(), makeHardware(), ragRule());
    expect(margin).toEqual({
      safe: true,
      reason: null,
      vramUsedBytes: 6 * GIB,
      vramAvailableBytes: 12 * GIB,
      headroomBytes: 6 * GIB,
      resourceFit: 'gpu-resident',
      recommendable: true,
      vramReserveBytes: Math.round(0.8 * GIB),
      ramUsedBytes: 2 * GIB,
      ramAvailableBytes: 28 * GIB,
      ramReserveBytes: Math.round(3.2 * GIB),
      ramHeadroomBytes: 28 * GIB - Math.round(3.2 * GIB) - 2 * GIB,
    });
  });

  it('fails closed on a rough estimate even when numbers fit', () => {
    const rough = makeExactEstimate({ provider: 'rough' });
    const margin = computeSafetyMargin(rough, makeHardware(), ragRule());
    expect(margin.safe).toBe(false);
    expect(margin.reason).toBe('rough-estimate');
    expect(margin.resourceFit).toBe('resource-unknown');
  });

  it('fails closed when the exact estimate reports no VRAM figure', () => {
    const noVram = makeExactEstimate({ vramTotalBytes: null });
    const margin = computeSafetyMargin(noVram, makeHardware(), ragRule());
    expect(margin.safe).toBe(false);
    expect(margin.reason).toBe('rough-estimate');
    expect(margin.resourceFit).toBe('resource-unknown');
  });

  it('fails when the estimate exceeds available VRAM', () => {
    const over = makeExactEstimate({ vramTotalBytes: 14 * GIB });
    const margin = computeSafetyMargin(over, makeHardware(), ragRule());
    expect(margin.safe).toBe(false);
    expect(margin.reason).toBe('over-vram');
    expect(margin.headroomBytes).toBe(-2 * GIB);
  });

  it('keeps the legacy fail-closed verdict but classifies over-VRAM RAM-feasible as Hybrid', () => {
    // M5-001: "larger than VRAM" alone must never mean Resource-insufficient.
    const over = makeExactEstimate({ vramTotalBytes: 14 * GIB });
    const margin = computeSafetyMargin(over, makeHardware(), ragRule());
    expect(margin.safe).toBe(false); // legacy VRAM-only semantics unchanged
    expect(margin.reason).toBe('over-vram');
    expect(margin.resourceFit).toBe('hybrid-memory');
    expect(margin.recommendable).toBe(true);
  });

  it('fails closed when no GPU VRAM could be probed and no rule floor applies', () => {
    const noGpus = makeHardware({ gpus: [] });
    const margin = computeSafetyMargin(makeExactEstimate(), noGpus);
    expect(margin.safe).toBe(false);
    expect(margin.reason).toBe('no-gpu-vram');
  });

  it('fails closed when any GPU reports unavailable VRAM', () => {
    const partial = makeHardware({ gpus: [{ name: 'gpu-0', vramTotalBytes: 16 * GIB, vramAvailableBytes: null }] });
    const margin = computeSafetyMargin(makeExactEstimate(), partial);
    expect(margin.safe).toBe(false);
    expect(margin.reason).toBe('no-gpu-vram');
  });

  it('lets the rule floor dominate when unprobed VRAM cannot clear it', () => {
    // The rag floor (8 GiB) is checked before GPU reachability: unknown
    // availability cannot satisfy the floor, so the reason is the floor code.
    const noGpus = makeHardware({ gpus: [] });
    const margin = computeSafetyMargin(makeExactEstimate(), noGpus, ragRule());
    expect(margin.safe).toBe(false);
    expect(margin.reason).toBe('under-min-vram');
  });

  it('fails when the available VRAM misses the rule floor', () => {
    // Floor is 8 GiB; only 6 GiB available.
    const small = makeHardware({ gpus: [{ name: 'small', vramTotalBytes: 8 * GIB, vramAvailableBytes: 6 * GIB }] });
    const margin = computeSafetyMargin(makeExactEstimate({ vramTotalBytes: 4 * GIB }), small, ragRule());
    expect(margin.safe).toBe(false);
    expect(margin.reason).toBe('under-min-vram');
  });

  it('sums VRAM across multiple GPUs', () => {
    const dual = makeHardware({
      gpus: [
        { name: 'gpu-0', vramTotalBytes: 8 * GIB, vramAvailableBytes: 8 * GIB },
        { name: 'gpu-1', vramTotalBytes: 8 * GIB, vramAvailableBytes: 8 * GIB },
      ],
    });
    const margin = computeSafetyMargin(makeExactEstimate({ vramTotalBytes: 10 * GIB }), dual, ragRule());
    expect(margin.safe).toBe(true);
    expect(margin.vramAvailableBytes).toBe(16 * GIB);
    expect(margin.headroomBytes).toBe(6 * GIB);
  });

  it('ignores the rule floor when the rule has no minVramBytes', () => {
    const rule = { ...ragRule(), constraints: { ...ragRule().constraints } };
    delete rule.constraints.minVramBytes;
    const margin = computeSafetyMargin(makeExactEstimate({ vramTotalBytes: 4 * GIB }), makeHardware(), rule);
    expect(margin.safe).toBe(true);
  });

  it('does not consult the profile', () => {
    // The baseline profile is irrelevant to the margin; safe for any baseline.
    const margin = computeSafetyMargin(makeExactEstimate(), makeHardware(), ragRule());
    expect(margin.safe).toBe(true);
    expect(makeRagBaseline().id).toBe('rag-prime');
  });
});