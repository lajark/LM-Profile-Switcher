// Locale-file conventions shared by the i18n gate scripts (CLI-only, no TS build needed).
// Mirrors the public constants in packages/i18n/src/detect.ts and resources.generated.ts;
// keep the two places in sync when a language is added.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const SUPPORTED_LOCALES = ['zh-CN', 'en'];
export const DEFAULT_LOCALE = 'en';
export const RESOURCE_FILE = 'common';
export const LOCALES_DIRECTORY = 'locales';

export function localeFile(root, locale) {
  return join(resolve(root), LOCALES_DIRECTORY, locale, `${RESOURCE_FILE}.json`);
}

/** Parses one locale file and rejects structural mistakes (missing file, bad JSON, non-string values). */
export function readLocaleResource(root, locale) {
  const file = localeFile(root, locale);
  if (!existsSync(file)) {
    throw new Error(`missing locale file: ${locale}/${RESOURCE_FILE}.json`);
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (cause) {
    throw new Error(`locale file is not valid JSON: ${locale}/${RESOURCE_FILE}.json`, { cause });
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`locale file must be a flat object: ${locale}/${RESOURCE_FILE}.json`);
  }
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'string') {
      throw new Error(`locale value must be a string: ${locale}/${RESOURCE_FILE}.json => "${key}"`);
    }
  }
  return raw;
}

export function loadAllLocaleResources(root) {
  const byLocale = {};
  for (const locale of SUPPORTED_LOCALES) {
    byLocale[locale] = readLocaleResource(root, locale);
  }
  return byLocale;
}

/**
 * Stable digest of the raw resource file bytes.
 * The generated resource-key file embeds this digest so drift can be detected by the gate.
 */
export function computeLocalesDigest(root) {
  const hash = createHash('sha256');
  for (const locale of SUPPORTED_LOCALES) {
    hash.update(readFileSync(localeFile(root, locale)));
  }
  return hash.digest('hex');
}