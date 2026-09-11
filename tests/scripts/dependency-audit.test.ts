// M5-004 dependency-spec classification helpers: offline, no I/O.
import { describe, expect, it } from 'vitest';
import { classifyDependencySpec, isPinnedSpec, isRangeSpec, isWorkspaceSpec } from '../../scripts/lib/dependency-spec.mjs';

describe('dependency-spec classification (M5-004)', () => {
  it('classifies pinned exact registry versions', () => {
    expect(isPinnedSpec('10.0.1')).toBe(true);
    expect(isPinnedSpec('1.2.3-rc.1')).toBe(true);
    expect(isPinnedSpec('1.2.3+build')).toBe(true);
    expect(classifyDependencySpec('10.0.1')).toBe('pinned-registry');
  });

  it('classifies workspace links', () => {
    expect(isWorkspaceSpec('workspace:*')).toBe(true);
    expect(isWorkspaceSpec('workspace:^1.0.0')).toBe(true);
    expect(classifyDependencySpec('workspace:*')).toBe('workspace');
  });

  it('classifies range and wildcard registry specs', () => {
    expect(isRangeSpec('^19.0.0')).toBe(true);
    expect(classifyDependencySpec('^19.0.0')).toBe('range-registry');
    expect(classifyDependencySpec('~1.2.3')).toBe('range-registry');
    expect(isPinnedSpec('^19.0.0')).toBe(false);
    expect(classifyDependencySpec('*')).toBe('wildcard-registry');
    expect(classifyDependencySpec('latest')).toBe('wildcard-registry');
  });

  it('classifies local/file/link specs without treating them as registry', () => {
    expect(classifyDependencySpec('link:../pkg')).toBe('local');
    expect(classifyDependencySpec('file:./x.tgz')).toBe('local');
  });
});