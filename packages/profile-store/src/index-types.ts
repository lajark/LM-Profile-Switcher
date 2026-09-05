/**
 * Optional index surface for the profile store (M1-002). The interface keeps
 * consumers decoupled from any concrete index; the shipped default is an
 * in-memory snapshot (`createMemoryIndex`). SQLite-backed indexing is deferred
 * by decision — the memory index is still useful for CLI filtering (M1-004)
 * and for GUI state mirrors.
 */
import type { CompositeProfile } from '@lmps/domain';

export type ProfileFilter = (profile: CompositeProfile) => boolean;

export interface ProfileIndex {
  /** Copy of the indexed profiles, filtered, sorted by id. */
  list(filter?: ProfileFilter): CompositeProfile[];
  get(id: string): CompositeProfile | undefined;
  upsert(profile: CompositeProfile): void;
  remove(id: string): void;
  /** Drop the whole index (e.g. after a large batch import). */
  invalidate(): void;
}

function cloneProfile(profile: CompositeProfile): CompositeProfile {
  // Domain documents are JSON-safe plain objects; JSON round-trip is the
  // cheapest deep copy that also guarantees the caller cannot mutate the index.
  return JSON.parse(JSON.stringify(profile)) as CompositeProfile;
}

function byId(a: CompositeProfile, b: CompositeProfile): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function createMemoryIndex(profiles: CompositeProfile[] = []): ProfileIndex {
  let items = profiles.map(cloneProfile).sort(byId);

  return {
    list(filter) {
      const matches = filter === undefined ? items : items.filter(filter);
      return matches.map(cloneProfile);
    },
    get(id) {
      const found = items.find((profile) => profile.id === id);
      return found === undefined ? undefined : cloneProfile(found);
    },
    upsert(profile) {
      items = items.filter((entry) => entry.id !== profile.id);
      items.push(cloneProfile(profile));
      items.sort(byId);
    },
    remove(id) {
      items = items.filter((entry) => entry.id !== id);
    },
    invalidate() {
      items = [];
    },
  };
}