/**
 * Recommendation assembly (PRD FR-07, M2-002): the end-to-end pure pipeline that
 * turns one baseline profile + rule + pre-computed estimates into a
 * `Recommendation`. The caller (core `RecommendationService`) supplies the
 * `LoadEstimate` map per candidate id because estimates come from an external
 * port (`EstimatePort`) — this module stays synchronous and I/O-free.
 *
 * Unsafe candidates never appear in `candidates` and `selectedIndex` is null
 * when no candidate is safe; non-fatal drops become entries in `warnings`.
 * Output is validated against the strict contract before returning, so a
 * producer bug surfaces as a throw instead of a malformed machine document.
 */
import { StrictRecommendationSchema, type BenchmarkResult, type Candidate, type CapabilityMatrix, type CompositeProfile, type HardwareProfile, type LoadEstimate, type Recommendation, type Rule } from '@lmps/domain';

import { filterByHardConstraints, generateCandidateDrafts } from './candidate.js';
import type { CandidateDraft } from './candidate.js';
import { applyMeasuredFeedback } from './feedback.js';
import { MAX_CANDIDATES } from './offload-ladder.js';
import { computeSafetyMargin, type SafetyMargin } from './safe-margin.js';
import { buildRationale, diffAgainst, scoreCandidate } from './scoring.js';

interface DraftAssessment {
  draft: CandidateDraft;
  estimate: LoadEstimate;
  safety: SafetyMargin;
  forceLow: boolean;
}

/**
 * Build the recommendation for one baseline under one rule.
 *
 * @param estimates per-draft-id `LoadEstimate`s, keyed by candidate draft id
 * @param ruleVersion the `RulesDocument.version` the rule came from
 * @param hardware probed host hardware (VRAM availability)
 * @param generatedAt deterministic clock (from the service runner context)
 * @param measuredResults historical benchmark records for the measured-feedback
 *   loop (most recent wins); empty keeps the pure static ranking
 */
export function generateRecommendation(
  baseline: CompositeProfile,
  rule: Rule,
  estimates: ReadonlyMap<string, LoadEstimate>,
  capability: CapabilityMatrix,
  hardware: HardwareProfile,
  generatedAt: string,
  ruleVersion: string,
  extraDrafts: CandidateDraft[] = [],
  measuredResults: readonly BenchmarkResult[] = [],
): Recommendation {
  const warnings: string[] = [];

  const generated = generateCandidateDrafts(baseline, rule);
  const drafts = extraDrafts.length === 0 ? generated : dedupeDrafts([...generated, ...extraDrafts]);
  if (drafts.length === 0) {
    const arch = rule.applicableArchitectures;
    if (arch !== undefined) {
      warnings.push('architecture-mismatch');
    } else {
      warnings.push('no-candidates');
    }
    return {
      schemaVersion: 2,
      baselineProfileId: baseline.id,
      taskKind: rule.taskKind,
      ruleVersion,
      candidates: [],
      selectedIndex: null,
      generatedAt,
      warnings,
    };
  }

  const filter = filterByHardConstraints(drafts, rule, capability);
  for (const rejection of filter.rejected) warnings.push(`unsafe-drop:${rejection.reason}`);

  const lowConfidenceIds = new Set(filter.lowConfidence);
  if (lowConfidenceIds.size > 0) warnings.push('unknown-capability');

  const assessments: DraftAssessment[] = [];
  for (const draft of filter.kept) {
    const estimate = estimates.get(draft.id);
    if (estimate === undefined) {
      warnings.push(`estimate-missing:${draft.id}`);
      continue;
    }
    const safety = computeSafetyMargin(estimate, hardware, rule);
    if (!safety.safe) {
      warnings.push(`unsafe-drop:${safety.reason ?? 'unknown'}`);
      continue;
    }
    assessments.push({ draft, estimate, safety, forceLow: lowConfidenceIds.has(draft.id) });
  }

  const candidates = applyMeasuredFeedback(
    assessments.map(({ draft, estimate, safety, forceLow }): Candidate => {
      const score = scoreCandidate(draft.profile, rule, estimate, safety, forceLow);
      return {
        schemaVersion: 2,
        id: draft.id,
        profile: draft.profile,
        baselineProfileId: baseline.id,
        estimate,
        // Fresh literal so the passthrough contract's index signature accepts the
        // local SafetyMargin interface (a bare interface has no implicit index).
        safety: {
          safe: safety.safe,
          reason: safety.reason,
          vramUsedBytes: safety.vramUsedBytes,
          vramAvailableBytes: safety.vramAvailableBytes,
          headroomBytes: safety.headroomBytes,
          resourceFit: safety.resourceFit,
          recommendable: safety.recommendable,
          vramReserveBytes: safety.vramReserveBytes,
          ramUsedBytes: safety.ramUsedBytes,
          ramAvailableBytes: safety.ramAvailableBytes,
          ramReserveBytes: safety.ramReserveBytes,
          ramHeadroomBytes: safety.ramHeadroomBytes,
        },
        score,
        diff: diffAgainst(draft.profile, baseline),
        rationale: buildRationale(rule, safety, score),
      };
    }),
    measuredResults,
    hardware.hardwareFingerprint ?? null,
  ).slice(0, MAX_CANDIDATES);

  const recommendation: Recommendation = {
    schemaVersion: 2,
    baselineProfileId: baseline.id,
    taskKind: rule.taskKind,
    ruleVersion,
    candidates,
    selectedIndex: candidates.length === 0 ? null : 0,
    generatedAt,
    warnings,
  };

  const check = StrictRecommendationSchema.safeParse(recommendation);
  if (!check.success) {
    throw new Error(`Recommendation failed strict validation: ${check.error.message}`);
  }
  return check.data;
}

/** Dedupe draft list by stable id, keeping the first occurrence. */
function dedupeDrafts(drafts: CandidateDraft[]): CandidateDraft[] {
  const seen = new Set<string>();
  const unique: CandidateDraft[] = [];
  for (const draft of drafts) {
    if (seen.has(draft.id)) continue;
    seen.add(draft.id);
    unique.push(draft);
  }
  return unique;
}