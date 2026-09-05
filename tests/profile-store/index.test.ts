// ProfileIndex contract tests (M1-002): consumers of the index interface get a
// sorted, copy-defensive listing and optional mutation. The shipped default is
// the in-memory implementation; SQLite is deferred (user decision, M1-002).
import { createMemoryIndex } from '@lmps/profile-store';
import { describe, expect, it } from 'vitest';

import { ALPHA, BETA, GAMMA, validProfile } from './fixtures';

describe('createMemoryIndex', () => {
  it('lists seeded profiles sorted by id', () => {
    const index = createMemoryIndex([GAMMA, ALPHA, BETA]);
    expect(index.list().map((profile) => profile.id)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('list applies the filter before returning', () => {
    const index = createMemoryIndex([ALPHA, BETA, GAMMA]);
    const onlyGpt = index.list((profile) => profile.model.modelKey.startsWith('synthetic/other'));
    expect(onlyGpt.map((profile) => profile.id)).toEqual(['gamma']);
  });

  it('returns defensive copies: external mutation never leaks into the index', () => {
    const index = createMemoryIndex([ALPHA]);
    const read = index.get('alpha');
    expect(read).not.toBeUndefined();
    read!.runtime.contextLength = 1;
    expect(index.get('alpha')!.runtime.contextLength).toBe(8192);
  });

  it('get returns undefined for an unknown id', () => {
    const index = createMemoryIndex([]);
    expect(index.get('nope')).toBeUndefined();
  });

  it('upsert adds and re-sorts; replacing an id keeps a single entry', () => {
    const index = createMemoryIndex([BETA, ALPHA]);
    index.upsert(validProfile('delta'));
    expect(index.list().map((profile) => profile.id)).toEqual(['alpha', 'beta', 'delta']);
    index.upsert(validProfile('alpha', { runtime: { contextLength: 1 } }));
    const entries = index.list().filter((profile) => profile.id === 'alpha');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.runtime.contextLength).toBe(1);
  });

  it('remove deletes an id and no-ops on unknown ids', () => {
    const index = createMemoryIndex([ALPHA, BETA]);
    index.remove('alpha');
    expect(index.list().map((profile) => profile.id)).toEqual(['beta']);
    expect(() => index.remove('ghost')).not.toThrow();
  });

  it('invalidate clears the index', () => {
    const index = createMemoryIndex([ALPHA]);
    index.invalidate();
    expect(index.list()).toEqual([]);
    expect(index.get('alpha')).toBeUndefined();
  });

  it('an empty index lists nothing', () => {
    const index = createMemoryIndex();
    expect(index.list()).toEqual([]);
  });
});