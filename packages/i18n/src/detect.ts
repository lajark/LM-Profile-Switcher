/**
 * Locale constants, normalization, and detection.
 * Pure string logic shared by Node hosts and the Tauri WebView; no environment access here.
 */

export const SUPPORTED_LOCALES = ['zh-CN', 'en'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Fallback language used whenever the requested or detected locale is not supported. */
export const DEFAULT_LOCALE: Locale = 'en';

/** Region tags that are intentionally outside the launch scope (traditional Chinese variants). */
const ZH_UNSUPPORTED_SECONDARY_TAGS = new Set(['hant', 'tw', 'hk', 'mo']);

/**
 * Normalizes a free-form locale string into a supported {@link Locale}, or `null` when unsupported.
 * Accepts `zh-CN`, `zh_CN`, `ZH`, `zh-Hans`, `en`, `en-US`, ... and trims whitespace.
 */
export function normalizeLocale(input: string | null | undefined): Locale | null {
  if (input == null) {
    return null;
  }
  const normalized = input.trim().toLowerCase().replace(/_/g, '-');
  if (normalized === 'zh-cn') {
    return 'zh-CN';
  }
  if (normalized === 'en') {
    return 'en';
  }
  const [primary, secondary] = normalized.split('-');
  if (primary === 'zh') {
    if (secondary !== undefined && ZH_UNSUPPORTED_SECONDARY_TAGS.has(secondary)) {
      return null;
    }
    return 'zh-CN';
  }
  if (primary === 'en') {
    return 'en';
  }
  return null;
}

/**
 * Picks the first supported candidate from a system locale (or accept-language list).
 * Follows the system on first run; unsupported environments fall back to {@link DEFAULT_LOCALE}.
 */
export function detectLocale(systemLocale: string | readonly string[] | null | undefined): Locale {
  if (systemLocale == null || systemLocale === '') {
    return DEFAULT_LOCALE;
  }
  const candidates = typeof systemLocale === 'string' ? [systemLocale] : systemLocale;
  for (const candidate of candidates) {
    const normalized = normalizeLocale(candidate);
    if (normalized !== null) {
      return normalized;
    }
  }
  return DEFAULT_LOCALE;
}