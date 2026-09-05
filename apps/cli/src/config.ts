/**
 * File-backed language persistence for the CLI: `<rootDir>/config.json` holds
 * `{ "locale": "zh-CN" }`. Writes reuse the profile-store durability helpers
 * (temp + fsync + atomic rename), so a crash never leaves a half-written config.
 * The root dir may hold passthrough secrets → treat its contents as LOCAL-ONLY.
 */
import { normalizeLocale, type Locale } from '@lmps/i18n';
import { writeFileAtomic, type Fsys } from '@lmps/profile-store';

export function languageConfigPath(rootDir: string): string {
  return `${rootDir}/config.json`;
}

export interface FileLanguageStore {
  /** Missing file → null; a corrupt file throws (doctor reports it as a check). */
  get(): Locale | null;
  set(locale: Locale): void;
}

export function createFileLanguageStore(rootDir: string, fs: Fsys): FileLanguageStore {
  const path = languageConfigPath(rootDir);
  return {
    get() {
      if (!fs.exists(path)) return null;
      const parsed = JSON.parse(fs.readFileUtf8(path)) as { locale?: unknown };
      if (parsed.locale === undefined || typeof parsed.locale !== 'string') return null;
      return normalizeLocale(parsed.locale);
    },
    set(locale) {
      writeFileAtomic(fs, path, `${JSON.stringify({ locale }, null, 2)}\n`, 1);
    },
  };
}