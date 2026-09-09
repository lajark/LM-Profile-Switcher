// Virtual aliases contract (M4-002): schema acceptance and rejection,
// generation tri-state parsing, unknown-field policy, and the deny-by-default
// matcher semantics (exact virtualModel, per-alias and global switches).
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SESSION_TTL_MS,
  describeVirtualAliases,
  matchVirtualAlias,
  StrictVirtualAliasesDocumentSchema,
  validateVirtualAliases,
  VirtualAliasSchema,
  VirtualAliasesDocumentSchema,
} from '@lmps/domain';
import { minimalVirtualAliasesDocument } from './fixtures.js';

const baseAlias = {
  id: 'code-editor',
  virtualModel: 'lmps://coder',
  profileId: 'coding-9b',
};

describe('VirtualAliasSchema', () => {
  it('accepts a minimal valid alias (id/virtualModel/profileId)', () => {
    expect(VirtualAliasSchema.safeParse(baseAlias).success).toBe(true);
  });

  it('accepts generation tri-state fields: value / null (explicit clear) / absent', () => {
    expect(
      VirtualAliasSchema.safeParse({
        ...baseAlias,
        generation: { temperature: 0.4, topP: null, repeatPenalty: 1.1 },
      }).success,
    ).toBe(true);
    // absent sampling fields pass through unchanged — no key present at all.
  });

  it('accepts an optional modelKey, activate, lockSession and rationale', () => {
    expect(
      VirtualAliasSchema.safeParse({
        ...baseAlias,
        modelKey: 'qwen2.5-7b',
        activate: true,
        lockSession: false,
        rationale: { 'zh-CN': '编码', en: 'Coding.' },
      }).success,
    ).toBe(true);
  });

  it('rejects a blank virtualModel, profileId or id', () => {
    expect(VirtualAliasSchema.safeParse({ ...baseAlias, id: '' }).success).toBe(false);
    expect(VirtualAliasSchema.safeParse({ ...baseAlias, virtualModel: '' }).success).toBe(false);
    expect(VirtualAliasSchema.safeParse({ ...baseAlias, profileId: '' }).success).toBe(false);
  });

  it('rejects out-of-range generation numbers', () => {
    expect(
      VirtualAliasSchema.safeParse({ ...baseAlias, generation: { temperature: -1 } }).success,
    ).toBe(false);
    expect(
      VirtualAliasSchema.safeParse({ ...baseAlias, generation: { topP: 1.5 } }).success,
    ).toBe(false);
    expect(
      VirtualAliasSchema.safeParse({ ...baseAlias, generation: { topK: -2 } }).success,
    ).toBe(false);
    expect(
      VirtualAliasSchema.safeParse({ ...baseAlias, generation: { repeatPenalty: 0 } }).success,
    ).toBe(false);
    expect(
      VirtualAliasSchema.safeParse({ ...baseAlias, generation: { maxTokens: 0 } }).success,
    ).toBe(false);
  });

  it('rejects non-injectable generation fields (reasoning / structuredOutputSchema / presetReference)', () => {
    // AliasGenerationSchema is strict: the planned scope explicitly excludes
    // these from proxy-side injection.
    expect(
      VirtualAliasSchema.safeParse({ ...baseAlias, generation: { reasoning: 'high' } }).success,
    ).toBe(false);
    expect(
      VirtualAliasSchema.safeParse({ ...baseAlias, generation: { structuredOutputSchema: {} } }).success,
    ).toBe(false);
    expect(
      VirtualAliasSchema.safeParse({ ...baseAlias, generation: { presetReference: 'x' } }).success,
    ).toBe(false);
  });

  it('preserves unknown fields by default', () => {
    const extended = { ...baseAlias, futureField: { x: 1 } };
    expect(VirtualAliasSchema.parse(extended).futureField).toEqual({ x: 1 });
  });
});

describe('VirtualAliasesDocumentSchema', () => {
  it('accepts the minimal fixture', () => {
    const result = VirtualAliasesDocumentSchema.safeParse(minimalVirtualAliasesDocument);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.aliases).toHaveLength(1);
      expect(result.data.enabled).toBe(true);
    }
  });

  it('defaults sessionLock to locked and sessionTtlMs to the default', () => {
    const result = VirtualAliasesDocumentSchema.safeParse(minimalVirtualAliasesDocument);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.sessionLock).toBeUndefined();
    expect(result.data.sessionTtlMs).toBeUndefined();
    // describeVirtualAliases is where the defaults surface for callers.
    expect(describeVirtualAliases(result.data)).toMatchObject({
      sessionLock: true,
      sessionTtlMs: DEFAULT_SESSION_TTL_MS,
    });
  });

  it('accepts an explicit sessionLock:false and sessionTtlMs', () => {
    const result = VirtualAliasesDocumentSchema.safeParse({
      ...minimalVirtualAliasesDocument,
      sessionLock: false,
      sessionTtlMs: 5 * 60 * 1000,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(describeVirtualAliases(result.data)).toMatchObject({
      sessionLock: false,
      sessionTtlMs: 5 * 60 * 1000,
    });
  });

  it('rejects sessionTtlMs below one second', () => {
    expect(
      VirtualAliasesDocumentSchema.safeParse({ ...minimalVirtualAliasesDocument, sessionTtlMs: 500 }).success,
    ).toBe(false);
  });

  it('requires enabled and a non-empty version', () => {
    expect(
      VirtualAliasesDocumentSchema.safeParse({ ...minimalVirtualAliasesDocument, enabled: undefined }).success,
    ).toBe(false);
    expect(
      VirtualAliasesDocumentSchema.safeParse({ ...minimalVirtualAliasesDocument, version: '' }).success,
    ).toBe(false);
  });

  it('rejects a non-current schemaVersion', () => {
    expect(
      VirtualAliasesDocumentSchema.safeParse({ ...minimalVirtualAliasesDocument, schemaVersion: 1 }).success,
    ).toBe(false);
    expect(
      VirtualAliasesDocumentSchema.safeParse({ ...minimalVirtualAliasesDocument, schemaVersion: 3 }).success,
    ).toBe(false);
  });

  it('accepts an empty aliases array (deny everything)', () => {
    expect(
      VirtualAliasesDocumentSchema.safeParse({ ...minimalVirtualAliasesDocument, aliases: [] }).success,
    ).toBe(true);
  });

  it('preserves unknown top-level fields and rejects them in strict mode', () => {
    const extended = { ...minimalVirtualAliasesDocument, source: 'seed' };
    expect(VirtualAliasesDocumentSchema.parse(extended).source).toBe('seed');
    expect(StrictVirtualAliasesDocumentSchema.safeParse(extended).success).toBe(false);
  });
});

describe('matchVirtualAlias (deny by default)', () => {
  const doc = {
    schemaVersion: 2,
    version: '2026.09.test',
    enabled: true,
    aliases: [
      { id: 'code-editor', virtualModel: 'lmps://coder', profileId: 'coding-9b' },
      { id: 'notes-assist', virtualModel: 'lmps://notes', profileId: 'notes-7b' },
      { id: 'disabled-alias', virtualModel: 'lmps://archive', profileId: 'archive-9b', enabled: false },
    ],
  };

  it('matches an enabled alias by exact virtualModel', () => {
    expect(matchVirtualAlias(doc, { model: 'lmps://coder' })).toEqual({
      profileId: 'coding-9b',
      alias: doc.aliases[0],
    });
  });

  it('denies an unknown model', () => {
    expect(matchVirtualAlias(doc, { model: 'lmps://nope' })).toBeNull();
  });

  it('denies a disabled alias even though its virtualModel matches', () => {
    expect(matchVirtualAlias(doc, { model: 'lmps://archive' })).toBeNull();
  });

  it('fails closed when the global switch is off', () => {
    expect(matchVirtualAlias({ ...doc, enabled: false }, { model: 'lmps://coder' })).toBeNull();
  });

  it('is exact-string: no prefix, no case folding', () => {
    expect(matchVirtualAlias(doc, { model: 'lmps://coder' })).not.toBeNull();
    expect(matchVirtualAlias(doc, { model: 'lmps://coder ' })).toBeNull();
  });
});

describe('validateVirtualAliases', () => {
  it('accepts a valid document', () => {
    expect(validateVirtualAliases(minimalVirtualAliasesDocument).ok).toBe(true);
  });

  it('reports schema issues for malformed input', () => {
    const result = validateVirtualAliases({ ...minimalVirtualAliasesDocument, version: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });

  it('reports duplicate enabled virtualModel values', () => {
    const duplicate = {
      ...minimalVirtualAliasesDocument,
      aliases: [
        { id: 'a', virtualModel: 'lmps://coder', profileId: 'p1' },
        { id: 'b', virtualModel: 'lmps://coder', profileId: 'p2' },
      ],
    };
    const result = validateVirtualAliases(duplicate);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.includes('duplicate virtualModel'))).toBe(true);
    }
  });

  it('ignores disabled aliases in the duplicate check', () => {
    const duplicate = {
      ...minimalVirtualAliasesDocument,
      aliases: [
        { id: 'a', virtualModel: 'lmps://coder', profileId: 'p1' },
        { id: 'b', virtualModel: 'lmps://coder', profileId: 'p2', enabled: false },
      ],
    };
    const result = validateVirtualAliases(duplicate);
    expect(result.ok).toBe(true);
  });
});