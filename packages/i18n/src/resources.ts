/**
 * Resource loading and validation (Node side).
 * The WebView does not have file access; its bundler imports the same JSON resources and
 * passes the resulting structure to `createI18n` directly.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SUPPORTED_LOCALES } from './detect.js';
import { findWorkspaceRoot } from './paths.js';
import {
  DEFAULT_NAMESPACE,
  resourceKeys,
  type CommonResources,
} from './resources.generated.js';

export const I18N_NAMESPACE = DEFAULT_NAMESPACE;

/** Loose resource shape accepted by the shared i18n core (validated on load). */
export type I18nResources = Record<string, { common: Record<string, string> }>;

/** Structured error carrying a stable machine code for i18n resource problems. */
export class LocaleResourceError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LocaleResourceError';
    this.code = code;
  }
}

/** Parses one resource file and rejects structural mistakes (bad JSON, non-flat object, non-string values). */
export function parseLocaleResource(json: string, locale: string): CommonResources {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (cause) {
    throw new LocaleResourceError(
      'LOCALE_INVALID_JSON',
      `locale file is not valid JSON: ${locale}/${I18N_NAMESPACE}.json`,
      { cause },
    );
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new LocaleResourceError(
      'LOCALE_INVALID_SHAPE',
      `locale file must be a flat object: ${locale}/${I18N_NAMESPACE}.json`,
    );
  }
  if (Object.values(raw).some((value) => typeof value !== 'string')) {
    throw new LocaleResourceError(
      'LOCALE_INVALID_VALUE',
      `locale value must be a string: ${locale}/${I18N_NAMESPACE}.json`,
    );
  }
  return raw as unknown as CommonResources;
}

/**
 * Loads every supported locale from `<rootDir>/locales/<locale>/common.json`.
 * `rootDir` defaults to the workspace root discovered from this module (for the CLI and tests).
 */
export function loadResourceFiles(rootDir?: string): I18nResources {
  const root = rootDir ?? findWorkspaceRoot();
  const expectedKeys: Set<string> = new Set([...resourceKeys]);
  const resources: I18nResources = {};
  for (const locale of SUPPORTED_LOCALES) {
    const file = join(root, 'locales', locale, `${I18N_NAMESPACE}.json`);
    if (!existsSync(file)) {
      throw new LocaleResourceError(
        'LOCALE_MISSING_FILE',
        `missing locale file: ${locale}/${I18N_NAMESPACE}.json`,
      );
    }
    const parsed = parseLocaleResource(readFileSync(file, 'utf8'), locale);
    const actualKeys = new Set(Object.keys(parsed));
    const missing = [...expectedKeys].filter((key) => !actualKeys.has(key));
    const extra = Object.keys(parsed).filter((key) => !expectedKeys.has(key));
    if (missing.length > 0 || extra.length > 0) {
      throw new LocaleResourceError(
        'LOCALE_KEY_MISMATCH',
        `locale file key mismatch: ${locale}/${I18N_NAMESPACE}.json (missing: ${missing.join(
          ', ',
        )}; extra: ${extra.join(', ')})`,
      );
    }
    resources[locale] = { common: parsed as unknown as Record<string, string> };
  }
  return resources;
}