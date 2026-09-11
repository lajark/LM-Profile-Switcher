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
export { generateCandidateDrafts, filterByHardConstraints, generateLadderDrafts, toCapabilityPath } from './candidate.js';
export type { CandidateDraft, CandidateRejection, HardConstraintFilter } from './candidate.js';
export { computeSafetyMargin } from './safe-margin.js';
export type { SafetyMargin } from './safe-margin.js';
export {
  classifyResourceFit,
  gpuReserveBytes,
  ramReserveBytes,
  DEFAULT_GPU_RESERVE_MIN_BYTES,
  DEFAULT_GPU_RESERVE_FRACTION,
  DEFAULT_RAM_RESERVE_MIN_BYTES,
  DEFAULT_RAM_RESERVE_FRACTION,
} from './resource-fit.js';
export type { ResourceFitVerdict } from './resource-fit.js';
export { scoreCandidate, diffAgainst, buildRationale } from './scoring.js';
export {
  GPU_OFFLOAD_LADDER,
  MAX_ESTIMATE_CALLS,
  MIN_CANDIDATES,
  MAX_CANDIDATES,
  offloadVariant,
  ladderVariants,
  clampOffloadToLadder,
  ladderVariantId,
  planLadderFallback,
} from './offload-ladder.js';
export type { OffloadCandidate } from './offload-ladder.js';
export { generateRecommendation } from './recommendation.js';
export { calibrateEstimate, MEASUREMENT_TOLERANCE } from './calibration.js';
export type { CalibrationVerdict, CalibrationNote } from './calibration.js';
export { RATIONALE_NOTE, CONFIDENCE_LABEL, HEADROOM_NOTE, HYBRID_MEMORY_NOTE } from './notes.js';