/**
 * @lmps/i18n — shared internationalization foundation for the CLI, the core service,
 * and the Tauri-hosted React/Web GUI.
 *
 * The core is environment-agnostic: locale detection and persistence are injected.
 * Node hosts load resources with {@link loadResourceFiles}; the WebView bundler imports the
 * same JSON and passes an equivalent {@link I18nResources} structure to {@link createI18n}.
 */

export type { Locale } from './detect.js';
export { DEFAULT_LOCALE, SUPPORTED_LOCALES, detectLocale, normalizeLocale } from './detect.js';

export type { I18nResources } from './resources.js';
export {
  I18N_NAMESPACE,
  LocaleResourceError,
  loadResourceFiles,
  parseLocaleResource,
} from './resources.js';

export type { CreateI18nOptions, I18nService, LocaleChangedListener, TranslationFunction } from './service.js';
export { createI18n } from './service.js';

export type { LanguageStore } from './storage.js';
export { createMemoryLanguageStore } from './storage.js';

export type { CommonResources, ResourceKey } from './resources.generated.js';
export { DEFAULT_NAMESPACE, resourceKeys } from './resources.generated.js';