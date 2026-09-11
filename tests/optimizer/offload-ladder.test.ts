// M5-002 offload-ladder contract: a bounded GPU offload ladder (1.0, 0.75, 0.5,
// 0.25, off) for adaptive Hybrid/Host-memory candidates, plus the hard bounds on
// estimate calls and the candidate set. Pure module contract.
import { describe, expect, it } from 'vitest';
import {
  clampOffloadToLadder,
  GPU_OFFLOAD_LADDER,
  ladderVariantId,
  ladderVariants,
  MAX_CANDIDATES,
  MAX_ESTIMATE_CALLS,
  MIN_CANDIDATES,
  offloadVariant,
  planLadderFallback,
} from '@lmps/optimizer';
import { GIB, makeExactEstimate, makeHardware, makeRagBaseline } from './fixtures';

describe('M5-002 offload ladder contract', () => {
  it('exposes the bounded ladder 1.0/0.75/0.5/0.25/off', () => {
    expect(GPU_OFFLOAD_LADDER).toEqual([1, 0.75, 0.5, 0.25, 0]);
    expect(GPU_OFFLOAD_LADDER).toHaveLength(5);
  });

  it('bounds the search: at most MAX_ESTIMATE_CALLS estimates and 3-6 candidates', () => {
    expect(MAX_ESTIMATE_CALLS).toBe(12);
    expect(MIN_CANDIDATES).toBe(3);
    expect(MAX_CANDIDATES).toBe(6);
    expect(MAX_ESTIMATE_CALLS).toBeGreaterThanOrEqual(MAX_CANDIDATES);
  });

  it('returns a new profile with the offload fraction set and everything else unchanged', () => {
    const base = makeRagBaseline();
    const variant = offloadVariant(base, 0.5);
    expect(variant).not.toBe(base);
    expect(variant.runtime.gpuOffload).toBe(0.5);
    expect(variant.model).toEqual(base.model);
    expect(variant.runtime.contextLength).toBe(base.runtime.contextLength);
    expect(base.runtime.gpuOffload).toBe('max'); // original untouched
  });

  it('maps the off entry (0) to a numeric host-only offload', () => {
    expect(offloadVariant(makeRagBaseline(), 0).runtime.gpuOffload).toBe(0);
  });

  it('generates the five ladder variants as distinct profiles', () => {
    const variants = ladderVariants(makeRagBaseline());
    expect(variants).toHaveLength(5);
    expect(variants.map((v) => v.runtime.gpuOffload)).toEqual([1, 0.75, 0.5, 0.25, 0]);
    expect(new Set(variants.map((v) => String(v.runtime.gpuOffload))).size).toBe(5);
  });

  it('snaps a numeric offload to the nearest ladder step in both directions', () => {
    expect(clampOffloadToLadder(1)).toBe(1);
    expect(clampOffloadToLadder(0.8)).toBe(0.75);
    expect(clampOffloadToLadder(0.875)).toBe(1);
    expect(clampOffloadToLadder(0.4)).toBe(0.5);
    expect(clampOffloadToLadder(0)).toBe(0);
  });
});

describe('planLadderFallback', () => {
  const kept35b = [{ id: 'rag-prime', profile: makeRagBaseline() }];
  const hardware = makeHardware(); // 12 GiB free VRAM, 28 GiB free RAM

  it('expands a non-GPU-resident (hybrid) over-VRAM draft down the ladder within budget', () => {
    const overVramHybrid = makeExactEstimate({ vramTotalBytes: 20 * GIB, totalMemoryBytes: 20 * GIB, systemRamBytes: null });
    const plan = planLadderFallback(kept35b, new Map([['rag-prime', overVramHybrid]]), hardware, MAX_ESTIMATE_CALLS);
    expect(plan.length).toBe(4); // 0.75 / 0.5 / 0.25 / 0 (below the default base 1.0)
    expect(plan.map((p) => p.offload)).toEqual([0.75, 0.5, 0.25, 0]);
    expect(plan.map((p) => p.id)).toEqual([
      'rag-prime::offload-75',
      'rag-prime::offload-50',
      'rag-prime::offload-25',
      'rag-prime::offload-0',
    ]);
    // Every planned variant has strict lower offload than the base.
    for (const p of plan) expect(typeof p.profile.runtime.gpuOffload).toBe('number');
  });

  it('plans nothing for an already GPU-resident draft', () => {
    const gpuResident = makeExactEstimate({ vramTotalBytes: 6 * GIB, systemRamBytes: 2 * GIB });
    const plan = planLadderFallback(kept35b, new Map([['rag-prime', gpuResident]]), hardware, MAX_ESTIMATE_CALLS);
    expect(plan).toEqual([]);
  });

  it('honours a caller budget and caps plans at MAX_ESTIMATE_CALLS', () => {
    const overVramHybrid = makeExactEstimate({ vramTotalBytes: 20 * GIB, totalMemoryBytes: 20 * GIB, systemRamBytes: null });
    const plan = planLadderFallback(kept35b, new Map([['rag-prime', overVramHybrid]]), hardware, 2);
    expect(plan.length).toBe(2);
    expect(plan.length).toBeLessThanOrEqual(MAX_ESTIMATE_CALLS);
  });

  it('skips drafts with no exact estimate', () => {
    const plan = planLadderFallback(kept35b, new Map(), hardware, MAX_ESTIMATE_CALLS);
    expect(plan).toEqual([]);
  });
});

describe('ladderVariantId', () => {
  it('produces a stable id naming the snapped percent step', () => {
    expect(ladderVariantId('rag-prime', 0.5)).toBe('rag-prime::offload-50');
    expect(ladderVariantId('rag-prime', 0)).toBe('rag-prime::offload-0');
  });
});