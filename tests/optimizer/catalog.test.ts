// Rule catalog loader and validator (M2-001): JSON rule packs round-trip
// through the loader, the cross-rule validator catches what a single-document
// schema cannot, and the seed catalog stays deterministic and complete.
import { describe, expect, it } from 'vitest';
import { TASK_KINDS } from '@lmps/domain';
import { SEED_RULE_CATALOG, loadRuleCatalog, validateRuleCatalog } from '@lmps/optimizer';
import { minimalRulesDocument } from '../domain/fixtures.js';

describe('loadRuleCatalog', () => {
  it('parses a valid JSON rule pack into a typed catalog', () => {
    const catalog = loadRuleCatalog(JSON.stringify(minimalRulesDocument));
    expect(catalog).not.toBeNull();
    expect(catalog?.rules.map((r) => r.taskKind)).toEqual(['quick-chat']);
  });

  it('returns null for malformed or non-JSON input', () => {
    expect(loadRuleCatalog('{ not json')).toBeNull();
    expect(loadRuleCatalog('')).toBeNull();
    expect(loadRuleCatalog('   ')).toBeNull();
  });

  it('returns null when the document fails the domain contract', () => {
    expect(loadRuleCatalog(JSON.stringify({ schemaVersion: 3, version: 'v', rules: [] }))).toBeNull();
    expect(loadRuleCatalog(JSON.stringify({ version: 'v', rules: [{}] }))).toBeNull();
  });
});

describe('validateRuleCatalog', () => {
  it('passes the seed catalog', () => {
    const result = validateRuleCatalog(SEED_RULE_CATALOG);
    expect(result).toEqual({ ok: true, errors: [] });
  });

  it('passes the minimal fixture', () => {
    expect(validateRuleCatalog(minimalRulesDocument)).toEqual({ ok: true, errors: [] });
  });

  it('flags duplicate task kinds', () => {
    const duplicate = {
      ...SEED_RULE_CATALOG,
      rules: [...SEED_RULE_CATALOG.rules, SEED_RULE_CATALOG.rules[0]!],
    };
    const result = validateRuleCatalog(duplicate);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('duplicate rule for taskKind');
  });

  it('flags a reversed parameter range', () => {
    const reversed = {
      ...minimalRulesDocument,
      rules: [
        {
          ...minimalRulesDocument.rules[0]!,
          parameterHints: { contextLength: { min: 8192, max: 4096 } },
        },
      ],
    };
    const result = validateRuleCatalog(reversed);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('hint "contextLength" has max < min');
  });

  it('flags a blank rationale side', () => {
    const blank = {
      ...minimalRulesDocument,
      rules: [
        { ...minimalRulesDocument.rules[0]!, rationale: { 'zh-CN': '   ', en: 'ok' } },
      ],
    };
    const result = validateRuleCatalog(blank);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('blank rationale');
  });
});

describe('seed catalog determinism', () => {
  it('covers every PRD FR-07 task kind exactly once', () => {
    const kinds = SEED_RULE_CATALOG.rules.map((r) => r.taskKind);
    expect(kinds).toHaveLength(TASK_KINDS.length);
    expect(new Set(kinds)).toEqual(new Set(TASK_KINDS));
  });

  it('carries a bilingual, non-empty rationale per rule', () => {
    for (const rule of SEED_RULE_CATALOG.rules) {
      expect(rule.rationale['zh-CN'].trim().length).toBeGreaterThan(0);
      expect(rule.rationale.en.trim().length).toBeGreaterThan(0);
    }
  });

  it('fleshes out rag and investment-due-diligence fully', () => {
    for (const kind of ['rag', 'investment-due-diligence'] as const) {
      const rule = SEED_RULE_CATALOG.rules.find((r) => r.taskKind === kind);
      expect(rule?.constraints, `${kind} must carry constraints`).toBeDefined();
      expect(rule?.parameterHints, `${kind} must carry parameter hints`).toBeDefined();
      expect(rule?.scoringWeights, `${kind} must carry scoring weights`).toBeDefined();
      expect(rule?.rationale.en.length).toBeGreaterThan(40);
    }
  });

  it('keeps the seed versioned and pins the current schemaVersion', () => {
    expect(SEED_RULE_CATALOG.schemaVersion).toBe(2);
    expect(SEED_RULE_CATALOG.version).toMatch(/^\d{4}\.\d{2}\.\d+$/);
  });
});