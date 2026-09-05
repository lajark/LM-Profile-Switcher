/**
 * `lmps --help` / `lmps help`: full bilingual usage text (cli.usage key). This
 * is the only command rendered before locale normalization succeeds, so it
 * always has a valid locale from the resolver.
 */
import type { CliDeps, CommandOutput } from '../seams.js';

export function runHelpCommand(deps: CliDeps): CommandOutput {
  return { text: deps.t('cli.usage') };
}