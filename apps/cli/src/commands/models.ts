/**
 * `lmps models`: lists models reachable through the injected discovery seam.
 * Until M1-003 wires a real data source the seam is null and the command
 * honestly reports capability unsupported (exit 6); a wired seam renders the
 * stable summary list.
 */
import { parseCommandArgs } from '../options.js';
import { capabilityUnsupported } from '../errors.js';
import type { CliDeps, CommandOutput } from '../seams.js';

const SPEC = { maxPositional: 0 } as const;

export async function runModelsCommand(deps: CliDeps, args: readonly string[]): Promise<CommandOutput> {
  parseCommandArgs(SPEC, args);
  const discovery = deps.discovery;
  if (discovery === null) {
    throw capabilityUnsupported('models');
  }
  const summaries = (await discovery.listModels()).map((model) => ({
    key: model.key,
    family: model.family,
    quantization: model.quantization,
    parametersB: model.parametersB,
  }));

  const text =
    summaries.length === 0
      ? deps.t('models.none')
      : summaries
          .map((summary) => deps.t('models.line', { key: summary.key, family: summary.family, quantization: summary.quantization }))
          .join('\n');
  return { text, data: { models: summaries } };
}