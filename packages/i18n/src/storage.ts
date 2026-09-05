import type { Locale } from './detect.js';

/**
 * Persistence boundary for the chosen language.
 * Injected by the host: the CLI reuses the config store (M1-002), the WebView bridges the
 * desktop settings backend. The shared core never touches the file system or browser storage.
 */
export interface LanguageStore {
  get(): Locale | null | undefined;
  set(locale: Locale): void | Promise<void>;
}

/** In-memory store, the default for tests and hosts without a config backend. */
export function createMemoryLanguageStore(initial: Locale | null = null): LanguageStore {
  let value: Locale | null = initial;
  return {
    get: () => value,
    set: (next) => {
      value = next;
    },
  };
}