/**
 * M5-002 adaptive offload ladder (PRD FR-07): a bounded GPU-offload ladder
 * (`1.0`, `0.75`, `0.5`, `0.25`, `0`) plus the hard search bounds. The single-
 * estimate classifier in `resource-fit.ts` stays unchanged; this module supplies
 * the offload variants a recruiter should estimate when the max-offload candidate
 * overruns VRAM but the host can still carry the whole footprint. Pure module —
 * no Node built-ins, no I/O. `0` means fully host-resident ("off").
 */
import type { CompositeProfile, HardwareProfile, LoadEstimate } from '@lmps/domain';

import { classifyResourceFit } from './resource-fit.js';

export const GPU_OFFLOAD_LADDER: readonly number[] = [1, 0.75, 0.5, 0.25, 0];

/** Hard cap on `lms load --estimate-only` calls for one recommendation. */
export const MAX_ESTIMATE_CALLS = 12;

/** Lower bound on ranked candidates before the recommendation is non-empty. */
export const MIN_CANDIDATES = 3;

/** Upper bound on ranked candidates surfaced to the user. */
export const MAX_CANDIDATES = 6;

/** Clone a profile with a numeric GPU-offload fraction applied. */
export function offloadVariant(profile: CompositeProfile, offload: number): CompositeProfile {
  const next = structuredClone(profile);
  next.runtime.gpuOffload = Math.round(offload * 10000) / 10000;
  return next;
}

/** The full ladder as distinct profile variants of one baseline. */
export function ladderVariants(profile: CompositeProfile): CompositeProfile[] {
  return GPU_OFFLOAD_LADDER.map((offload) => offloadVariant(profile, offload));
}

/**
 * Snap a numeric offload to the nearest ladder step (deterministic tie-break:
 * prefer the higher offload). Used to dedupe and to label which ladder step an
 * estimate came from.
 */
export function clampOffloadToLadder(offload: number): number {
  let best = GPU_OFFLOAD_LADDER[0] ?? 1;
  for (const step of GPU_OFFLOAD_LADDER) {
    if (Math.abs(step - offload) < Math.abs(best - offload)) {
      best = step;
    }
  }
  return best;
}

/** Stable candidate id for one ladder step of a draft (e.g. `rag-prime::offload-50`). */
export function ladderVariantId(draftId: string, offload: number): string {
  return `${draftId}::offload-${Math.round(clampOffloadToLadder(offload) * 100)}`;
}

/** A ladder variant that still needs its estimate fetched by the caller. */
export interface OffloadCandidate {
  id: string;
  profile: CompositeProfile;
  offload: number;
}

/**
 * Deterministic, bounded budget plan (M5-002): decide which *lower*-offload ladder
 * variants of a recruiter's kept drafts still need an estimate. A draft whose own
 * estimate is already recommender (`recommendable`) needs no fallback; a draft
 * that is resource-blocked (e.g. over-VRAM) is expanded down the ladder so a
 * Hybrid/Host-memory candidate can surface when the host can carry the footprint.
 * The returned set is always <= `budget` (default `MAX_ESTIMATE_CALLS`) and
 * deduplicated by stable id. Purely computes the plan — the async callers actually
 * run the estimates.
 */
export function planLadderFallback(
  kept: readonly { id: string; profile: CompositeProfile }[],
  estimates: ReadonlyMap<string, LoadEstimate>,
  hardware: HardwareProfile,
  budget: number = MAX_ESTIMATE_CALLS,
): OffloadCandidate[] {
  const planned = new Map<string, OffloadCandidate>();

  const add = (candidate: OffloadCandidate): void => {
    if (!planned.has(candidate.id)) planned.set(candidate.id, candidate);
  };

  for (const draft of kept) {
    if (planned.size >= budget) break;
    const estimate = estimates.get(draft.id);
    if (estimate === undefined || estimate.provider !== 'exact') continue;
    // Already fully GPU-resident: no lower-offload fallback can beat it.
    if (classifyResourceFit(estimate, hardware).resourceFit === 'gpu-resident') continue;

    const baseOffload = typeof draft.profile.runtime.gpuOffload === 'number' ? draft.profile.runtime.gpuOffload : 1;
    for (const step of GPU_OFFLOAD_LADDER) {
      if (step >= baseOffload) continue; // only strictly lower steps
      if (planned.size >= budget) break;
      add({ id: ladderVariantId(draft.id, step), profile: offloadVariant(draft.profile, step), offload: step });
    }
  }

  return [...planned.values()];
}