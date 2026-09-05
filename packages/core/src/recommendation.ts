/**
 * Recommendation orchestration (PRD FR-07, M2-002). This is the async side of
 * the candidate pipeline: it matches the profile's task kind against a rule
 * catalog (the seed by default), probes capability + hardware and estimate
 * ports, and assembles a `Recommendation` — fetches the external I/O, while the
 * optimizer stays synchronous and deterministic.
 *
 * Fail-closed behavior mirrors the activation runner: when a kind has no rule,
 * or a candidate's estimate throws, nothing is fabricated — the candidate is
 * dropped and a stable warning code is recorded. No profile is loaded or saved
 * here; saving the winner is the CLI command's job under explicit `--yes`.
 */
import { StrictRecommendationSchema, type CompositeProfile, type LoadEstimate, type Recommendation, type Rule } from '@lmps/domain';
import { filterByHardConstraints, generateCandidateDrafts, generateRecommendation, SEED_RULE_CATALOG, type RuleCatalog } from '@lmps/optimizer';

import { ActivationError } from './errors.js';
import type { CapabilityPort, EstimatePort, HardwarePort, RunnerContext } from './ports.js';

export interface RecommendationPorts {
  estimate: EstimatePort;
  capability: CapabilityPort;
  hardware: HardwarePort;
}

export interface RecommendationService {
  /**
   * Recommend candidate configurations for one baseline profile. Resolves with
   * the assembled recommendation (never throws for individual estimate
   * failures); throws `ACTIVATION_CANCELED` when the signal aborts.
   */
  recommend(profile: CompositeProfile, options?: { signal?: AbortSignal }): Promise<Recommendation>;
}

function emptyRecommendation(
  profile: CompositeProfile,
  ruleVersion: string,
  generatedAt: string,
  warnings: string[],
): Recommendation {
  const recommendation: Recommendation = {
    schemaVersion: 2,
    baselineProfileId: profile.id,
    taskKind: profile.task.kind ?? 'custom',
    ruleVersion,
    candidates: [],
    selectedIndex: null,
    generatedAt,
    warnings,
  };
  const check = StrictRecommendationSchema.safeParse(recommendation);
  if (!check.success) throw new Error(`Recommendation failed strict validation: ${check.error.message}`);
  return check.data;
}

/**
 * Build a recommendation service. `catalog` defaults to the seed rule catalog;
 * a caller may inject another authored `RuleCatalog` for testing or future
 * user rule packs.
 */
export function createRecommendationService(
  ctx: RunnerContext,
  ports: RecommendationPorts,
  catalog: RuleCatalog = SEED_RULE_CATALOG,
): RecommendationService {
  return {
    async recommend(profile, options) {
      if (options?.signal?.aborted) throw new ActivationError('ACTIVATION_CANCELED', 'recommendation canceled');

      const kind = profile.task.kind;
      const rule: Rule | undefined = catalog.rules.find((entry) => entry.taskKind === kind);
      if (rule === undefined) {
        const warnings = kind === 'custom' ? ['custom-kind'] : ['no-rule'];
        return emptyRecommendation(profile, catalog.version, ctx.now(), warnings);
      }

      const drafts = generateCandidateDrafts(profile, rule);
      if (drafts.length === 0) {
        return emptyRecommendation(profile, catalog.version, ctx.now(), ['architecture-mismatch']);
      }

      const capability = await ports.capability.probe();
      const filter = filterByHardConstraints(drafts, rule, capability);

      const estimates = new Map<string, LoadEstimate>();
      const estimateWarnings: string[] = [];
      for (const draft of filter.kept) {
        try {
          const estimate = await ports.estimate.estimate(draft.profile);
          estimates.set(draft.id, estimate);
        } catch {
          estimateWarnings.push(`estimate-failed:${draft.id}`);
        }
      }

      const hardware = await ports.hardware.profile();
      const recommendation = generateRecommendation(profile, rule, estimates, capability, hardware, ctx.now(), catalog.version);
      return { ...recommendation, warnings: [...estimateWarnings, ...recommendation.warnings] };
    },
  };
}