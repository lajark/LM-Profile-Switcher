// Contract-level validation for the task rule pack (M2-001): happy paths,
// required-field and boundary failures for RuleSchema and RulesDocumentSchema,
// plus the unknown-field policy (preserve by default, reject via Strict*).
import { describe, expect, it } from 'vitest';
import { RuleSchema, RulesDocumentSchema, StrictRuleSchema, StrictRulesDocumentSchema } from '@lmps/domain';
import { minimalRulesDocument } from './fixtures.js';

const fullRule = {
  taskKind: 'rag',
  applicableArchitectures: ['dense', 'moe'],
  rationale: { 'zh-CN': '检索增强生成', en: 'Retrieval-augmented generation.' },
  constraints: {
    minVramBytes: 8589934592,
    minContextLength: 32768,
    requiredCapabilities: ['contextLength', 'flashAttention'],
    maxConcurrency: 1,
  },
  parameterHints: {
    contextLength: { min: 32768, max: 131072 },
    gpuOffload: { min: 0.5, max: 1 },
    evalBatchSize: { min: 8, max: 32 },
    flashAttention: true,
    temperature: { min: 0, max: 0.3 },
    topP: { min: 0.9, max: 1 },
    maxTokens: { min: 2048, max: 8192 },
  },
  scoringWeights: { vramEfficiency: 0.25, latency: 0.15, throughput: 0.35, quality: 0.25 },
};

describe('RuleSchema', () => {
  it('accepts a minimal valid rule (rationale only)', () => {
    expect(
      RuleSchema.safeParse({ taskKind: 'custom', rationale: { 'zh-CN': '自定义', en: 'Custom.' } }).success,
    ).toBe(true);
  });

  it('accepts every optional block', () => {
    expect(RuleSchema.safeParse(fullRule).success).toBe(true);
  });

  it('rejects a missing or unknown taskKind', () => {
    expect(RuleSchema.safeParse({ rationale: { 'zh-CN': 'x', en: 'y' } }).success).toBe(false);
    expect(RuleSchema.safeParse({ taskKind: 'transcribe', rationale: { 'zh-CN': 'x', en: 'y' } }).success).toBe(false);
  });

  it('rejects a blank or missing rationale side', () => {
    expect(RuleSchema.safeParse({ taskKind: 'custom', rationale: { 'zh-CN': '', en: 'y' } }).success).toBe(false);
    expect(RuleSchema.safeParse({ taskKind: 'custom', rationale: { en: 'y' } }).success).toBe(false);
  });

  it('rejects unknown architectures and illegal constraint values', () => {
    expect(RuleSchema.safeParse({ ...fullRule, applicableArchitectures: ['quantum'] }).success).toBe(false);
    expect(RuleSchema.safeParse({ ...fullRule, constraints: { minVramBytes: -1 } }).success).toBe(false);
    expect(RuleSchema.safeParse({ ...fullRule, constraints: { minContextLength: 0 } }).success).toBe(false);
    expect(RuleSchema.safeParse({ ...fullRule, constraints: { maxConcurrency: 0 } }).success).toBe(false);
  });

  it('rejects negative scoring weights', () => {
    expect(RuleSchema.safeParse({ ...fullRule, scoringWeights: { latency: -0.1 } }).success).toBe(false);
  });

  it('preserves unknown fields by default and rejects them in strict mode', () => {
    const extended = { ...fullRule, futureField: { x: 1 } };
    expect(RuleSchema.parse(extended).futureField).toEqual({ x: 1 });
    expect(StrictRuleSchema.safeParse(extended).success).toBe(false);
  });
});

describe('RulesDocumentSchema', () => {
  it('accepts the minimal fixture', () => {
    const result = RulesDocumentSchema.safeParse(minimalRulesDocument);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rules).toHaveLength(1);
    }
  });

  it('requires at least one rule and a non-empty version', () => {
    expect(
      RulesDocumentSchema.safeParse({ schemaVersion: 2, version: 'v', rules: [] }).success,
    ).toBe(false);
    expect(
      RulesDocumentSchema.safeParse({ schemaVersion: 2, version: '', rules: [fullRule] }).success,
    ).toBe(false);
  });

  it('rejects a non-current schemaVersion', () => {
    expect(RulesDocumentSchema.safeParse({ ...minimalRulesDocument, schemaVersion: 1 }).success).toBe(false);
    expect(RulesDocumentSchema.safeParse({ ...minimalRulesDocument, schemaVersion: 3 }).success).toBe(false);
  });

  it('preserves unknown top-level fields and rejects them in strict mode', () => {
    const extended = { ...minimalRulesDocument, source: 'seed' };
    expect(RulesDocumentSchema.parse(extended).source).toBe('seed');
    expect(StrictRulesDocumentSchema.safeParse(extended).success).toBe(false);
  });
});