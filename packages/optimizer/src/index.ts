/**
 * @lmps/optimizer — rule catalogs and candidate generation.
 *
 * M2-001 shipped the data foundation (loader/validator + seed catalog); M2-002
 * adds the candidate pipeline: deterministic draft generation, hard-constraint
 * filtering, VRAM safety margin, static scoring/diff/rationale and end-to-end
 * `generateRecommendation` assembly. Pure package — no Node built-ins — so the
 * WebView and tests can share it unchanged; load estimation stays an external
 * port so `generateRecommendation` remains synchronous and deterministic.
 */
export { loadRuleCatalog, validateRuleCatalog } from './catalog.js';
export type { RuleCatalog, RuleCatalogValidation } from './catalog.js';
export { SEED_RULE_CATALOG } from './presets.js';
export { generateCandidateDrafts, filterByHardConstraints, toCapabilityPath } from './candidate.js';
export type { CandidateDraft, CandidateRejection, HardConstraintFilter } from './candidate.js';
export { computeSafetyMargin } from './safe-margin.js';
export type { SafetyMargin } from './safe-margin.js';
export { scoreCandidate, diffAgainst, buildRationale } from './scoring.js';
export { generateRecommendation } from './recommendation.js';
export { RATIONALE_NOTE, CONFIDENCE_LABEL, HEADROOM_NOTE } from './notes.js';