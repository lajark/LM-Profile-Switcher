/**
 * Candidate draft generation and hard-constraint filtering (PRD FR-07, M2-002).
 *
 * Pure module: deterministic sampling — no `Math.random`, no I/O. Hints from the
 * rule's `parameterHints` are sampled at fixed quantiles (min / mid / max) plus
 * deterministic mid/floor mixes to a bounded 3-6 variant set; each variant is
 * overlaid on a clone of the baseline profile. Architecture mismatches yield no
 * drafts. Hard constraints (`minContextLength`, `maxConcurrency`,
 * `requiredCapabilities`) are applied next; `requiredCapabilities` bare names
 * are bridged to capability-entry dot paths (`contextLength` →
 * `runtime.contextLength`) because `Rule.requiredCapabilities` carries bare
 * names while `CapabilityEntry.field` uses dot paths. `support === 'unavailable'`
 * (or a missing entry) rejects the draft; `support === 'unknown'` keeps it but
 * forces a low confidence rating.
 */
import type { CapabilityMatrix, CompositeProfile, Rule } from '@lmps/domain';

import { GPU_OFFLOAD_LADDER, offloadVariant } from './offload-ladder.js';

export interface CandidateDraft {
  id: string;
  profile: CompositeProfile;
}

export interface CandidateRejection {
  id: string;
  reason: string;
}

export interface HardConstraintFilter {
  kept: CandidateDraft[];
  rejected: CandidateRejection[];
  /** Ids of kept drafts retained despite an `unknown` capability (value unproven). */
  lowConfidence: string[];
}

/** Capability field namespace for runtime parameters (dot path prefix). */
const RUNTIME_PREFIX = 'runtime.';

/** Hint keys that map to `runtime.*` fields. */
const RUNTIME_HINT_KEYS = ['contextLength', 'gpuOffload', 'evalBatchSize'] as const;

/** Hint keys that map to `generation.*` fields. */
const GENERATION_HINT_KEYS = ['temperature', 'topP', 'maxTokens'] as const;

type RangeHintKey = 'contextLength' | 'gpuOffload' | 'evalBatchSize' | 'temperature' | 'topP' | 'maxTokens';

interface RangeHint {
  key: RangeHintKey;
  min: number;
  max: number;
}

interface BoolHint {
  key: 'flashAttention';
  value: boolean;
}

const FLOAT_HINTS: readonly RangeHintKey[] = ['gpuOffload', 'temperature', 'topP'];

/** Deterministic mid point: rounded ints for token/batch hints, 4-dp floats else. */
function midOf(hint: RangeHint): number {
  const mid = (hint.min + hint.max) / 2;
  if (FLOAT_HINTS.includes(hint.key)) return Math.round(mid * 10000) / 10000;
  return Math.round(mid);
}

function valueAt(hint: RangeHint, quantile: 0 | 1 | 2): number {
  if (quantile === 0) return hint.min;
  if (quantile === 2) return hint.max;
  return midOf(hint);
}

function readHints(rule: Rule): { ranges: RangeHint[]; bool: BoolHint | null } {
  const hints = rule.parameterHints;
  if (hints === undefined) return { ranges: [], bool: null };
  const ranges: RangeHint[] = [];
  for (const key of [...RUNTIME_HINT_KEYS, ...GENERATION_HINT_KEYS]) {
    const range = hints[key as RangeHintKey];
    if (range !== undefined) ranges.push({ key: key as RangeHintKey, min: range.min, max: range.max });
  }
  const bool = hints.flashAttention === undefined ? null : { key: 'flashAttention' as const, value: hints.flashAttention };
  return { ranges, bool };
}

/**
 * Deterministic quantile anchors: all-min, all-mid, all-max plus three mixed
 * splits, deduplicated to a bounded [3, 6] variant set (smaller when the rule
 * carries few hints or ranges collapse to a point).
 */
function quantileVectors(rangeCount: number): number[][] {
  const vectors: number[][] = [];
  const push = (v: number[]): void => {
    const key = JSON.stringify(v);
    if (vectors.every((existing) => JSON.stringify(existing) !== key)) vectors.push(v);
  };
  const allOf = (q: number): number[] => Array.from({ length: rangeCount }, () => q);
  const split = (first: number, second: number): number[] =>
    Array.from({ length: rangeCount }, (_, i) => (i < Math.ceil(rangeCount / 2) ? first : second));

  push(allOf(0));
  push(allOf(1));
  push(allOf(2));
  if (rangeCount >= 2) {
    push(split(1, 0));
    push(split(1, 2));
    push(split(2, 0));
  }
  return vectors;
}

function applyHints(base: CompositeProfile, ranges: RangeHint[], bool: BoolHint | null, quantiles: number[]): CompositeProfile {
  const next = structuredClone(base);
  ranges.forEach((hint, index) => {
    const value = valueAt(hint, (quantiles[index] ?? 0) as 0 | 1 | 2);
    if (RUNTIME_HINT_KEYS.includes(hint.key as (typeof RUNTIME_HINT_KEYS)[number])) {
      (next.runtime as Record<string, unknown>)[hint.key] = value;
    } else {
      (next.generation as Record<string, unknown>)[hint.key] = value;
    }
  });
  if (bool !== null) next.runtime.flashAttention = bool.value;
  return next;
}

/**
 * Generate deterministic candidate drafts for one rule, overlaid on the
 * baseline profile. Returns an empty array when the rule's architecture list
 * rejects the baseline model (architecture unknown counts as a mismatch).
 */
export function generateCandidateDrafts(baseline: CompositeProfile, rule: Rule): CandidateDraft[] {
  const arch = rule.applicableArchitectures;
  if (arch !== undefined) {
    const modelArch = baseline.model.architecture;
    if (modelArch === undefined || !arch.includes(modelArch)) return [];
  }

  const { ranges, bool } = readHints(rule);
  if (ranges.length === 0 && bool === null) {
    return [{ id: `${baseline.id}-head`, profile: structuredClone(baseline) }];
  }

  const vectors = quantileVectors(ranges.length);
  return vectors.map((quantiles, index) => {
    const draft = applyHints(baseline, ranges, bool, quantiles);
    const suffixes = ['min', 'mid', 'max', 'mid-low', 'mid-high', 'low-high'];
    return { id: `${baseline.id}-${suffixes[index] ?? index}`, profile: draft };
  });
}

/** Straighten a capability name into a dot path a matrix entry can match. */
export function toCapabilityPath(name: string): string {
  return name.includes('.') ? name : `${RUNTIME_PREFIX}${name}`;
}

/**
 * M5-002: the offload-ladder variant drafts (1.0 / 0.75 / 0.5 / 0.25 / off) of a
 * baseline. Used as `extraDrafts` when a kept draft's own estimate is
 * resource-blocked, so a non-max-offload Hybrid/Host candidate can be proposed.
 */
export function generateLadderDrafts(baseline: CompositeProfile): CandidateDraft[] {
  return GPU_OFFLOAD_LADDER.map((offload, index) => ({
    id: `${baseline.id}-offload-${[100, 75, 50, 25, 0][index] ?? index}`,
    profile: offloadVariant(baseline, offload),
  }));
}

/**
 * Apply the rule's hard constraints to the drafts. Capability support rules:
 * `exact`/`degraded` pass, `unavailable` rejects, `unknown` passes but is
 * registered in `lowConfidence` (the estimator could not prove it).
 */
export function filterByHardConstraints(
  drafts: CandidateDraft[],
  rule: Rule,
  capability: CapabilityMatrix,
): HardConstraintFilter {
  const supportByField = new Map<string, string>();
  for (const entry of capability.capabilities) supportByField.set(entry.field, entry.support);

  const kept: CandidateDraft[] = [];
  const rejected: CandidateRejection[] = [];
  const lowConfidence: string[] = [];

  for (const draft of drafts) {
    const reject = (reason: string): void => {
      rejected.push({ id: draft.id, reason });
    };

    const constraints = rule.constraints;
    if (constraints !== undefined) {
      const minContext = constraints.minContextLength;
      if (minContext !== undefined) {
        const value = draft.profile.runtime.contextLength;
        if (value === null || value === undefined || value < minContext) {
          reject('context-too-small');
          continue;
        }
      }

      const maxConcurrency = constraints.maxConcurrency;
      if (maxConcurrency !== undefined) {
        const concurrency = draft.profile.task.concurrency ?? 1;
        if (concurrency > maxConcurrency) {
          reject('concurrency-too-high');
          continue;
        }
      }

      let blocked = false;
      for (const name of constraints.requiredCapabilities ?? []) {
        const support = supportByField.get(toCapabilityPath(name));
        if (support === 'unavailable' || support === undefined) {
          reject('capability-unavailable');
          blocked = true;
          break;
        }
        if (support === 'unknown') lowConfidence.push(draft.id);
      }
      if (blocked) continue;
    }

    kept.push(draft);
  }

  return { kept, rejected, lowConfidence };
}