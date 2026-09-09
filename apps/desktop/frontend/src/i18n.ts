/**
 * Boots the shared `@lmps/i18n` service (user-approved bridge: the frontend
 * consumes the package directly and persists through the sidecar settings IPC).
 * The initial locale is read over RPC *before the first paint* so no wrong
 * language flashes; a slow/unreachable sidecar falls back to the system locale.
 */
import {
  createI18n,
  normalizeLocale,
  type I18nResources,
  type I18nService,
  type LanguageStore,
} from '@lmps/i18n/browser';
import zhCNCommon from '../../../../locales/zh-CN/common.json';
import enCommon from '../../../../locales/en/common.json';
import { sidecarLocaleGet, sidecarLocaleSet } from './api';

const RESOURCES: I18nResources = {
  'zh-CN': { common: zhCNCommon },
  en: { common: enCommon },
};

const INITIAL_LOCALE_TIMEOUT_MS = 3000;

/** Persists the language to `<rootDir>/config.json` through the sidecar. */
function tauriLanguageStore(): LanguageStore {
  return {
    // The initial value is loaded asynchronously at boot and passed as
    // `initialLocale`; `get` is never consulted before that happens.
    get: () => null,
    set: (locale) =>
      sidecarLocaleSet(locale).catch((error: unknown) => {
        console.error('[lmps-i18n-persist]', error);
      }),
  };
}

/** Resolves `null` on timeout or failure instead of hanging the boot. */
function withFallback<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

export async function createAppI18n(): Promise<I18nService> {
  const stored = await withFallback(sidecarLocaleGet(), INITIAL_LOCALE_TIMEOUT_MS);
  return createI18n({
    resources: RESOURCES,
    initialLocale: normalizeLocale(stored),
    systemLocale: navigator.languages,
    store: tauriLanguageStore(),
  });
}