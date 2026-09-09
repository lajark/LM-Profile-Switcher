/**
 * Shared i18next-based service: detection, per-key English fallback, immediate switching,
 * change notification, and injectable persistence. Environment detection stays out of the core.
 */

import { createInstance, type InitOptions } from 'i18next';
import {
  DEFAULT_LOCALE,
  detectLocale,
  normalizeLocale,
  SUPPORTED_LOCALES,
  type Locale,
} from './detect.js';
// `I18N_NAMESPACE` equals `DEFAULT_NAMESPACE` in the generated registry. It is
// imported from there (not from resources.js) so the browser entry below stays
// free of the Node-only resource-loading module graph.
import { DEFAULT_NAMESPACE as I18N_NAMESPACE } from './resources.generated.js';
import type { I18nResources } from './resources.js';
import type { LanguageStore } from './storage.js';
import type { ResourceKey } from './resources.generated.js';

/** Type-safe translate function: the key must be a real resource key. */
export type TranslationFunction = (key: ResourceKey, options?: Record<string, unknown>) => string;

export type LocaleChangedListener = (locale: Locale) => void;

export interface I18nService {
  readonly t: TranslationFunction;
  readonly locale: Locale;
  getLocale(): Locale;
  setLocale(locale: Locale): void;
  /** Registers a listener; returns an unsubscribe function. */
  onLocaleChanged(listener: LocaleChangedListener): () => void;
  dispose(): void;
}

export interface CreateI18nOptions {
  resources: I18nResources;
  /** Highest priority; any string is accepted and normalized, unsupported values fall back to English. */
  initialLocale?: string | null;
  /** System locale or accept-language list used when no persisted value exists. */
  systemLocale?: string | readonly string[] | null;
  /** Persistence boundary; when omitted no language is persisted. */
  store?: LanguageStore | null;
  /** Reports store failures; the switch itself always succeeds. */
  persistenceErrorHandler?: (error: unknown) => void;
}

export function createI18n(options: CreateI18nOptions): I18nService {
  const { resources, initialLocale, systemLocale, store = null, persistenceErrorHandler } = options;

  let locale = resolveInitialLocale();
  const instance = createInstance({
    resources,
    lng: locale,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: [...SUPPORTED_LOCALES],
    ns: [I18N_NAMESPACE],
    defaultNS: I18N_NAMESPACE,
    keySeparator: false,
    initAsync: false,
    interpolation: { escapeValue: false },
  } satisfies InitOptions);
  // Without a callback, createInstance does not initialize; initAsync:false keeps this synchronous.
  instance.init();

  function resolveInitialLocale(): Locale {
    if (initialLocale != null) {
      return normalizeLocale(initialLocale) ?? DEFAULT_LOCALE;
    }
    if (store != null) {
      const stored = normalizeLocale(store.get() ?? null);
      if (stored !== null) {
        return stored;
      }
    }
    return detectLocale(systemLocale);
  }

  const listeners = new Set<LocaleChangedListener>();
  const t = ((key: ResourceKey, params?: Record<string, unknown>) =>
    instance.t(key, params)) as unknown as TranslationFunction;

  function setLocale(next: Locale): void {
    const normalized = normalizeLocale(next);
    if (normalized === null || normalized === locale) {
      return;
    }
    locale = normalized;
    void instance.changeLanguage(normalized);
    if (store !== null) {
      try {
        void store.set(normalized);
      } catch (error) {
        persistenceErrorHandler?.(error);
      }
    }
    for (const listener of [...listeners]) {
      listener(normalized);
    }
  }

  function onLocaleChanged(listener: LocaleChangedListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function dispose(): void {
    listeners.clear();
  }

  return {
    t,
    get locale() {
      return locale;
    },
    getLocale: () => locale,
    setLocale,
    onLocaleChanged,
    dispose,
  };
}