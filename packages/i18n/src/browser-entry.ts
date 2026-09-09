/**
 * Browser-safe entry for the Tauri/React webview (M3-001).
 * Re-exports only the environment-agnostic core. The Node-only resource loader
 * (resources.js / paths.js, which touch `node:fs`/`node:path`/`node:url`) is
 * deliberately absent so bundlers targeting the browser stay node-free.
 *
 * The webview imports the locale JSON itself and passes an equivalent
 * {@link I18nResources} structure to {@link createI18n}.
 */

export type { Locale } from './detect.js';
export {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  detectLocale,
  normalizeLocale,
} from './detect.js';

export type { I18nResources } from './resources.js';

export type {
  CreateI18nOptions,
  I18nService,
  LocaleChangedListener,
  TranslationFunction,
} from './service.js';
export { createI18n } from './service.js';

export type { LanguageStore } from './storage.js';
export { createMemoryLanguageStore } from './storage.js';

export type { CommonResources, ResourceKey } from './resources.generated.js';
export { DEFAULT_NAMESPACE, resourceKeys } from './resources.generated.js';