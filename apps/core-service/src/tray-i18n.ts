/**
 * Tray menu localization (M3-003). The sidecar renders the tray menu as a data
 * spec and Rust only renders opaque items (ADR-0001), so labels are resolved
 * HERE through @lmps/i18n from the same locale JSON the CLI and the webview
 * consume — the tray follows the persisted language with zero extra plumbing.
 * The JSON imports are inlined by esbuild; `resolveJsonModule` (tsconfig)
 * admits them to tsc, and translators are cached per locale because menu
 * fetches happen on every tray interaction.
 *
 * PURE module (no Node builtins) so it fits the SEA bundle and vitest alike.
 */
import { createI18n, type I18nResources, type Locale, type TranslationFunction } from '@lmps/i18n';

import zhCN from '../../../locales/zh-CN/common.json' with { type: 'json' };
import en from '../../../locales/en/common.json' with { type: 'json' };

const resources: I18nResources = {
  'zh-CN': { common: zhCN as unknown as Record<string, string> },
  en: { common: en as unknown as Record<string, string> },
};

const translators = new Map<Locale, TranslationFunction>();

/** Translate function bound to `locale`; instances are cached per locale. */
export function translateFor(locale: Locale): TranslationFunction {
  const cached = translators.get(locale);
  if (cached !== undefined) return cached;
  const service = createI18n({ resources, initialLocale: locale });
  const t = service.t;
  translators.set(locale, t);
  return t;
}