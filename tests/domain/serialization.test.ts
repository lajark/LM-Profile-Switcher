// JSON/YAML round-tripping with the documented unknown-field policy:
// preserved by default (forward-compatible round trips), explicitly rejected in
// strict mode (import validation); malformed input and unsupported versions
// surface structured errors, never silent reshaping.
import { describe, expect, it } from 'vitest';
import {
  CompositeProfileSchema,
  DomainError,
  LoadEstimateSchema,
  parseJsonDocument,
  parseYamlDocument,
  stringifyJsonDocument,
  stringifyYamlDocument,
} from '@lmps/domain';
import {
  minimalLoadEstimate,
  v1SampleComposite,
} from './fixtures.js';

/** A deep document carrying tricky values: unicode, quotes, newlines, null. */
const trickyComposite = {
  ...v1SampleComposite,
  displayName: { 'zh-CN': '代码\n对话"引号"★', en: 'Code "Chat"\n★' },
  runtime: { ...v1SampleComposite.runtime, kCacheQuantization: null, gpuOffload: 'max' },
  metadata: { ...v1SampleComposite.metadata, tags: ['code', 'moe'] },
};

describe('JSON round trip', () => {
  it('round-trips the v1 composite unchanged', () => {
    const text = stringifyJsonDocument(v1SampleComposite);
    const parsed = parseJsonDocument(text, CompositeProfileSchema);
    expect(parsed).toEqual(v1SampleComposite);
  });

  it('round-trips tricky values (unicode, quotes, newline, null, enum)', () => {
    const text = stringifyJsonDocument(trickyComposite);
    const parsed = parseJsonDocument(text, CompositeProfileSchema);
    expect(parsed).toEqual(trickyComposite);
    expect(JSON.parse(text)['displayName']).toEqual(trickyComposite.displayName);
  });

  it('round-trips the smaller contracts (defaults applied on parse)', () => {
    const text = stringifyJsonDocument(minimalLoadEstimate);
    // `warnings` is declared with a default, so it is materialized on parse.
    expect(parseJsonDocument(text, LoadEstimateSchema)).toEqual({ ...minimalLoadEstimate, warnings: [] });
  });
});

describe('YAML round trip', () => {
  it('round-trips the v1 composite unchanged', () => {
    const text = stringifyYamlDocument(v1SampleComposite);
    const parsed = parseYamlDocument(text, CompositeProfileSchema);
    expect(parsed).toEqual(v1SampleComposite);
  });

  it('round-trips tricky values from YAML', () => {
    const text = stringifyYamlDocument(trickyComposite);
    const parsed = parseYamlDocument(text, CompositeProfileSchema);
    expect(parsed).toEqual(trickyComposite);
  });

  it('is byte-stable for a given object on repeated stringify', () => {
    expect(stringifyYamlDocument(v1SampleComposite)).toBe(stringifyYamlDocument(v1SampleComposite));
  });
});

describe('unknown-field policy', () => {
  it('preserves unknown fields through JSON and YAML by default', () => {
    const extended = { ...v1SampleComposite, futureField: { nested: [1, 2] }, another: 'kept' };
    expect(parseJsonDocument(stringifyJsonDocument(extended), CompositeProfileSchema)).toEqual(extended);
    expect(parseYamlDocument(stringifyYamlDocument(extended), CompositeProfileSchema)).toEqual(extended);
  });

  it('rejects unknown fields in strict mode with a structured code', () => {
    const extended = { ...v1SampleComposite, futureField: true };
    for (const parse of [
      () => parseJsonDocument(stringifyJsonDocument(extended), CompositeProfileSchema, { strict: true }),
      () => parseYamlDocument(stringifyYamlDocument(extended), CompositeProfileSchema, { strict: true }),
    ]) {
      expect(parse).toThrowError(DomainError);
      try {
        parse();
        throw new Error('expected throw');
      } catch (error) {
        expect(error).toBeInstanceOf(DomainError);
        expect((error as DomainError).code).toBe('DOMAIN_UNKNOWN_FIELD');
      }
    }
  });
});

describe('malformed input and versions', () => {
  it('reports invalid JSON and YAML as DOMAIN_PARSE_FAILED', () => {
    expect(() => parseJsonDocument('{ not json', CompositeProfileSchema)).toThrowError(/invalid JSON document/);
    expect(() => parseYamlDocument('{ unclosed', CompositeProfileSchema)).toThrowError(/invalid YAML document/);
    for (const parse of [
      () => parseJsonDocument('{ not json', CompositeProfileSchema),
      () => parseYamlDocument('{ unclosed', CompositeProfileSchema),
    ]) {
      try {
        parse();
        throw new Error('expected throw');
      } catch (error) {
        expect((error as DomainError).code).toBe('DOMAIN_PARSE_FAILED');
      }
    }
  });

  it('rejects unsupported schemaVersion instead of reshaping', () => {
    const future = { ...v1SampleComposite, schemaVersion: 2 };
    for (const parse of [
      () => parseJsonDocument(stringifyJsonDocument(future), CompositeProfileSchema),
      () => parseYamlDocument(stringifyYamlDocument(future), CompositeProfileSchema),
    ]) {
      try {
        parse();
        throw new Error('expected throw');
      } catch (error) {
        expect((error as DomainError).code).toBe('DOMAIN_VERSION_UNSUPPORTED');
      }
    }
  });

  it('classifies a missing required field as a validation error, not parse error', () => {
    const broken = { ...v1SampleComposite, metadata: { createdAt: '2026-08-21T10:00:00Z' } };
    try {
      parseJsonDocument(stringifyJsonDocument(broken), CompositeProfileSchema);
      throw new Error('expected throw');
    } catch (error) {
      expect((error as DomainError).code).toBe('DOMAIN_VALIDATION_FAILED');
    }
  });
});