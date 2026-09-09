// Hook rules contract (M4-001): schema acceptance and rejection, unknown-field
// policy, and the deny-by-default matcher semantics (app exact match, taskKind
// priority over task-less defaults, per-rule and global switches).
import { describe, expect, it } from 'vitest';
import {
  HookRuleSchema,
  HookRulesDocumentSchema,
  matchHookRule,
  StrictHookRuleSchema,
  StrictHookRulesDocumentSchema,
  validateHookRules,
} from '@lmps/domain';
import { minimalHookRulesDocument } from './fixtures.js';

const baseRule = {
  id: 'editor-code',
  app: 'editor',
  taskKind: 'coding',
  profileId: 'coding-9b',
};

describe('HookRuleSchema', () => {
  it('accepts a minimal valid rule (id/app/profileId)', () => {
    expect(HookRuleSchema.safeParse({ id: 'r1', app: 'nvim', profileId: 'p1' }).success).toBe(true);
  });

  it('accepts a task-refined rule with a rationale', () => {
    expect(HookRuleSchema.safeParse({ ...baseRule, rationale: { 'zh-CN': '编码', en: 'Coding.' } }).success).toBe(true);
  });

  it('rejects a blank id, app or profileId', () => {
    expect(HookRuleSchema.safeParse({ id: '', app: 'nvim', profileId: 'p1' }).success).toBe(false);
    expect(HookRuleSchema.safeParse({ id: 'r1', app: '', profileId: 'p1' }).success).toBe(false);
    expect(HookRuleSchema.safeParse({ id: 'r1', app: 'nvim', profileId: '' }).success).toBe(false);
  });

  it('rejects an unknown taskKind', () => {
    expect(HookRuleSchema.safeParse({ ...baseRule, taskKind: 'transcribe' }).success).toBe(false);
  });

  it('rejects a blank rationale side', () => {
    expect(HookRuleSchema.safeParse({ ...baseRule, rationale: { 'zh-CN': '', en: 'ok' } }).success).toBe(false);
  });

  it('preserves unknown fields by default and rejects them in strict mode', () => {
    const extended = { ...baseRule, futureField: { x: 1 } };
    expect(HookRuleSchema.parse(extended).futureField).toEqual({ x: 1 });
    expect(StrictHookRuleSchema.safeParse(extended).success).toBe(false);
  });
});

describe('HookRulesDocumentSchema', () => {
  it('accepts the minimal fixture', () => {
    const result = HookRulesDocumentSchema.safeParse(minimalHookRulesDocument);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rules).toHaveLength(1);
      expect(result.data.enabled).toBe(true);
    }
  });

  it('requires enabled and a non-empty version', () => {
    expect(HookRulesDocumentSchema.safeParse({ ...minimalHookRulesDocument, enabled: undefined }).success).toBe(false);
    expect(HookRulesDocumentSchema.safeParse({ ...minimalHookRulesDocument, version: '' }).success).toBe(false);
  });

  it('rejects a non-current schemaVersion', () => {
    expect(HookRulesDocumentSchema.safeParse({ ...minimalHookRulesDocument, schemaVersion: 1 }).success).toBe(false);
    expect(HookRulesDocumentSchema.safeParse({ ...minimalHookRulesDocument, schemaVersion: 3 }).success).toBe(false);
  });

  it('accepts an empty rules array (deny everything)', () => {
    expect(
      HookRulesDocumentSchema.safeParse({ ...minimalHookRulesDocument, rules: [] }).success,
    ).toBe(true);
  });

  it('preserves unknown top-level fields and rejects them in strict mode', () => {
    const extended = { ...minimalHookRulesDocument, source: 'seed' };
    expect(HookRulesDocumentSchema.parse(extended).source).toBe('seed');
    expect(StrictHookRulesDocumentSchema.safeParse(extended).success).toBe(false);
  });
});

describe('matchHookRule (deny by default)', () => {
  const doc = {
    schemaVersion: 2,
    version: '2026.09.test',
    enabled: true,
    rules: [
      { id: 'editor-code', app: 'editor', taskKind: 'coding', profileId: 'coding-9b' },
      { id: 'editor-default', app: 'editor', profileId: 'editor-8b' },
      { id: 'nvim-notes', app: 'nvim', taskKind: 'quick-chat', profileId: 'notes-7b' },
      { id: 'disabled-rule', app: 'editor', taskKind: 'rag', profileId: 'rag-9b', enabled: false },
    ],
  };

  it('matches the app-wide task-less default when no taskKind is requested', () => {
    expect(matchHookRule(doc, { app: 'editor' })).toEqual({ profileId: 'editor-8b', ruleId: 'editor-default' });
  });

  it('prefers a task-refined rule over the task-less default', () => {
    expect(matchHookRule(doc, { app: 'editor', taskKind: 'coding' })).toEqual({
      profileId: 'coding-9b',
      ruleId: 'editor-code',
    });
  });

  it('falls back to the task-less default for an unmatched task', () => {
    expect(matchHookRule(doc, { app: 'editor', taskKind: 'structured-extraction' })).toEqual({
      profileId: 'editor-8b',
      ruleId: 'editor-default',
    });
  });

  it('resolves a task requested for an app without a task-less default', () => {
    expect(matchHookRule(doc, { app: 'nvim', taskKind: 'quick-chat' })).toEqual({
      profileId: 'notes-7b',
      ruleId: 'nvim-notes',
    });
  });

  it('denies an unknown app', () => {
    expect(matchHookRule(doc, { app: 'vscode' })).toBeNull();
    expect(matchHookRule(doc, { app: 'vscode', taskKind: 'coding' })).toBeNull();
  });

  it('skips per-rule disabled rules', () => {
    // rag is disabled for editor; no task-less default would apply only if the
    // task-less rule were removed — here the fallback default still resolves.
    const withoutDefault = { ...doc, rules: doc.rules.filter((rule) => rule.id !== 'editor-default') };
    expect(matchHookRule(withoutDefault, { app: 'editor', taskKind: 'rag' })).toBeNull();
  });

  it('fails closed when the global switch is off', () => {
    expect(matchHookRule({ ...doc, enabled: false }, { app: 'editor' })).toBeNull();
    expect(matchHookRule({ ...doc, enabled: false }, { app: 'editor', taskKind: 'coding' })).toBeNull();
  });
});

describe('validateHookRules', () => {
  it('accepts a valid document', () => {
    const result = validateHookRules(minimalHookRulesDocument);
    expect(result.ok).toBe(true);
  });

  it('reports schema issues for malformed input', () => {
    const result = validateHookRules({ ...minimalHookRulesDocument, version: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });

  it('reports duplicate app+task mappings', () => {
    const duplicate = {
      ...minimalHookRulesDocument,
      rules: [
        { id: 'a', app: 'editor', taskKind: 'coding', profileId: 'p1' },
        { id: 'b', app: 'editor', taskKind: 'coding', profileId: 'p2' },
      ],
    };
    const result = validateHookRules(duplicate);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.includes('duplicate mapping'))).toBe(true);
    }
  });

  it('reports ambiguous task-less defaults for one app', () => {
    const ambiguous = {
      ...minimalHookRulesDocument,
      rules: [
        { id: 'a', app: 'editor', profileId: 'p1' },
        { id: 'b', app: 'editor', profileId: 'p2' },
      ],
    };
    const result = validateHookRules(ambiguous);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.includes('ambiguous default'))).toBe(true);
    }
  });
});