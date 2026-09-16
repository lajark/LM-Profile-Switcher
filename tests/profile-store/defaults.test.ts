import { describe, expect, it } from 'vitest';
import { createProfileDefaultStore, isProfileStoreError } from '@lmps/profile-store';

import { BASE_DIR, FakeFs, FAKE_NOW } from './fixtures';

const DEFAULTS_PATH = `${BASE_DIR}/profile-defaults.json`;

describe('profile default store', () => {
  it('persists one default per model/scenario and replaces only that key', () => {
    const fs = new FakeFs();
    const store = createProfileDefaultStore({ fs, path: DEFAULTS_PATH, now: () => FAKE_NOW });
    store.set('model/a', 'quick-chat', 'profile-a');
    store.set('model/b', 'quick-chat', 'profile-b');
    store.set('model/a', 'quick-chat', 'profile-a2');

    expect(store.get('model/a', 'quick-chat')).toBe('profile-a2');
    expect(store.get('model/b', 'quick-chat')).toBe('profile-b');
    expect(store.list()).toEqual([
      { modelKey: 'model/a', taskType: 'quick-chat', profileId: 'profile-a2', updatedAt: FAKE_NOW },
      { modelKey: 'model/b', taskType: 'quick-chat', profileId: 'profile-b', updatedAt: FAKE_NOW },
    ]);

    const reopened = createProfileDefaultStore({ fs, path: DEFAULTS_PATH, now: () => FAKE_NOW });
    expect(reopened.get('model/a', 'quick-chat')).toBe('profile-a2');
  });

  it('rejects a missing or mismatched profile when the caller supplies a guard', () => {
    const fs = new FakeFs();
    const store = createProfileDefaultStore({
      fs,
      path: DEFAULTS_PATH,
      now: () => FAKE_NOW,
      profileExists: (profileId, modelKey, taskType) =>
        profileId === 'profile-a' && modelKey === 'model/a' && taskType === 'quick-chat',
    });

    expect(() => store.set('model/a', 'quick-chat', 'missing')).toThrowError(
      expect.objectContaining({ code: 'STORE_INVALID_ID' }),
    );
    expect(() => store.set('model/b', 'quick-chat', 'profile-a')).toThrowError(
      expect.objectContaining({ code: 'STORE_INVALID_ID' }),
    );
    expect(store.set('model/a', 'quick-chat', 'profile-a').profileId).toBe('profile-a');
  });

  it('fails closed on malformed or future-version documents', () => {
    const fs = new FakeFs();
    fs.writeFileUtf8(DEFAULTS_PATH, JSON.stringify({ schemaVersion: 99, entries: [] }));
    const store = createProfileDefaultStore({ fs, path: DEFAULTS_PATH, now: () => FAKE_NOW });
    try {
      store.list();
      throw new Error('expected corruption');
    } catch (error) {
      expect(isProfileStoreError(error)).toBe(true);
      expect((error as { code?: string }).code).toBe('STORE_CORRUPTED');
    }
  });
  it('rejects empty default keys and profile ids', () => {
    const fs = new FakeFs();
    const store = createProfileDefaultStore({ fs, path: DEFAULTS_PATH, now: () => FAKE_NOW });
    expect(() => store.set('', 'quick-chat', 'profile-a')).toThrowError(
      expect.objectContaining({ code: 'STORE_INVALID_ID' }),
    );
    expect(() => store.set('model/a', 'quick-chat', '')).toThrowError(
      expect.objectContaining({ code: 'STORE_INVALID_ID' }),
    );
  });
});