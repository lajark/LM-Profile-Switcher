/**
 * `lmps lang [locale]`: shows the effective language or switches to a
 * normalized supported locale. Switching persists immediately; a failed
 * persistence boundary surfaces as an internal error (exit 10).
 */
import { normalizeLocale } from '@lmps/i18n';

import { CliError } from '../errors.js';
import { parseCommandArgs } from '../options.js';
import type { CliDeps, CommandOutput } from '../seams.js';

const SPEC = { maxPositional: 1 } as const;

export function runLangCommand(deps: CliDeps, args: readonly string[]): CommandOutput {
  const sub = parseCommandArgs(SPEC, args);
  const requested = sub.positionals[0];

  if (requested === undefined) {
    const locale = deps.getLocale();
    return { text: deps.t('lang.show', { locale }), data: { locale } };
  }

  const normalized = normalizeLocale(requested);
  if (normalized === null) {
    throw new CliError('USAGE', 'unsupported language', {
      params: { key: 'error.invalidLocale', values: { language: requested } },
    });
  }
  deps.applyLocale(normalized);
  return { text: deps.t('lang.set', { locale: normalized }), data: { locale: normalized } };
}