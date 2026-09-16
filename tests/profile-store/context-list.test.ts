import { describe, expect, it } from 'vitest';

import { createMemStore } from './helpers';
import { ALPHA, PROFILE_DIR, validProfile } from './fixtures';

describe('profile context listing', () => {
  it('keeps valid profiles and surfaces unclassifiable legacy records', () => {
    const { store, fs } = createMemStore();
    store.create(validProfile('alpha'));
    fs.writeFileUtf8(
      `${PROFILE_DIR}/legacy.json`,
      JSON.stringify({ schemaVersion: 1, id: 'legacy', displayName: { en: 'Legacy', 'zh-CN': '旧' } }),
    );

    expect(store.listEntries()).toEqual([
      { kind: 'profile', profile: ALPHA },
      { kind: 'needs-organization', id: 'legacy', reason: 'unclassifiable-model-or-scenario' },
    ]);
    expect(store.list().map((profile) => profile.id)).toEqual(['alpha']);
  });

  it('does not guess from filenames and keeps malformed non-legacy records separate', () => {
    const { store, fs } = createMemStore();
    fs.writeFileUtf8(
      `${PROFILE_DIR}/future.json`,
      JSON.stringify({ schemaVersion: 999, model: { modelKey: 'future-model' }, task: { type: 'chat' } }),
    );

    expect(store.listEntries()).toEqual([
      { kind: 'corrupted', id: 'future', reason: 'unsupported-or-invalid' },
    ]);
  });
});
