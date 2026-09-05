/**
 * @lmps/optimizer — rule catalogs and (from M2-002) candidate generation.
 *
 * M2-001 ships the data foundation only: a pure loader/validator over the
 * domain `RulesDocument` contract and the bilingual seed catalog. Pure module —
 * no Node built-ins — so the WebView and tests can share it unchanged.
 */
export { loadRuleCatalog, validateRuleCatalog } from './catalog.js';
export type { RuleCatalog, RuleCatalogValidation } from './catalog.js';
export { SEED_RULE_CATALOG } from './presets.js';