/**
 * Rule catalog loading and cross-rule validation (PRD FR-07, M2-001).
 *
 * Pure module: no Node built-ins, no file system. `loadRuleCatalog` parses a
 * JSON rule pack against the domain `RulesDocument` contract (null on
 * malformed/blank input — mirroring the hardware `parseCimJson` pattern);
 * `validateRuleCatalog` checks the cross-rule consistency a single-document
 * schema cannot express: unique task kinds, ordered parameter ranges, and
 * non-empty rationale. Candidate generation consuming the catalog lands in
 * M2-002 (AGENTS.md: Optimizer must not execute loads).
 */
import { RulesDocumentSchema, type RulesDocument } from '@lmps/domain';

export type RuleCatalog = RulesDocument;

export interface RuleCatalogValidation {
  ok: boolean;
  errors: string[];
}

/** Range-typed parameter hints validated for min ≤ max. */
const RANGE_HINT_KEYS = [
  'contextLength',
  'gpuOffload',
  'evalBatchSize',
  'temperature',
  'topP',
  'maxTokens',
] as const;

export function loadRuleCatalog(jsonText: string): RuleCatalog | null {
  const trimmed = jsonText.trim();
  if (trimmed === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const result = RulesDocumentSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

export function validateRuleCatalog(catalog: RuleCatalog): RuleCatalogValidation {
  const errors: string[] = [];
  const seenKinds = new Set<string>();

  for (const rule of catalog.rules) {
    if (seenKinds.has(rule.taskKind)) {
      errors.push(`duplicate rule for taskKind "${rule.taskKind}"`);
    }
    seenKinds.add(rule.taskKind);

    const zh = rule.rationale['zh-CN'].trim();
    const en = rule.rationale.en.trim();
    if (zh === '' || en === '') {
      errors.push(`rule "${rule.taskKind}" has a blank rationale side`);
    }

    for (const key of RANGE_HINT_KEYS) {
      const range = rule.parameterHints?.[key];
      if (range !== undefined && range.max < range.min) {
        errors.push(`rule "${rule.taskKind}" hint "${key}" has max < min`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}