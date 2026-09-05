import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  detectLocale,
  normalizeLocale,
} from '@lmps/i18n';

describe('locale normalization', () => {
  it('normalizes supported zh-CN spellings', () => {
    expect(normalizeLocale('zh-CN')).toBe('zh-CN');
    expect(normalizeLocale('zh_CN')).toBe('zh-CN');
    expect(normalizeLocale('ZH-CN')).toBe('zh-CN');
    expect(normalizeLocale('zh-cn')).toBe('zh-CN');
    expect(normalizeLocale('zh')).toBe('zh-CN');
    expect(normalizeLocale('zh-Hans')).toBe('zh-CN');
  });

  it('normalizes supported English spellings', () => {
    expect(normalizeLocale('en')).toBe('en');
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale('en-GB')).toBe('en');
    expect(normalizeLocale('EN')).toBe('en');
  });

  it('trims surrounding whitespace before matching', () => {
    expect(normalizeLocale('  en  ')).toBe('en');
    expect(normalizeLocale('\tzh-cn\n')).toBe('zh-CN');
  });

  it('rejects unsupported and empty input', () => {
    expect(normalizeLocale('fr')).toBeNull();
    expect(normalizeLocale('de')).toBeNull();
    // 首发仅 zh-CN/en；繁体与地区变体不视为受支持语言
    expect(normalizeLocale('zh-TW')).toBeNull();
    expect(normalizeLocale('zh-Hant')).toBeNull();
    expect(normalizeLocale('')).toBeNull();
    expect(normalizeLocale(null)).toBeNull();
    expect(normalizeLocale(undefined)).toBeNull();
  });
});

describe('locale detection', () => {
  it('follows the system locale when supported', () => {
    expect(detectLocale('zh-CN')).toBe('zh-CN');
    expect(detectLocale('en')).toBe('en');
    expect(detectLocale(['fr', 'zh-cn'])).toBe('zh-CN');
  });

  it('falls back to English for unsupported system locales', () => {
    expect(detectLocale('fr')).toBe(DEFAULT_LOCALE);
    expect(detectLocale('zh-TW')).toBe(DEFAULT_LOCALE);
    expect(detectLocale(['ja', 'de'])).toBe(DEFAULT_LOCALE);
  });

  it('uses English as the default when nothing is known', () => {
    expect(detectLocale()).toBe(DEFAULT_LOCALE);
    expect(detectLocale(null)).toBe(DEFAULT_LOCALE);
    expect(detectLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(detectLocale('')).toBe(DEFAULT_LOCALE);
  });
});

describe('supported locale contract', () => {
  it('exposes exactly the launch languages with the English default', () => {
    expect(SUPPORTED_LOCALES).toEqual(['zh-CN', 'en']);
    expect(DEFAULT_LOCALE).toBe('en');
  });
});