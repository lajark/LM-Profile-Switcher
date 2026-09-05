/**
 * `lmps snapshot`: captures a point-in-time profile snapshot through the
 * injected snapshot port. The port stays null until M1-005; until then the
 * command reports capability unsupported (exit 6) honestly.
 */
import { parseCommandArgs } from '../options.js';
import { capabilityUnsupported } from '../errors.js';
import type { CliDeps, CommandOutput } from '../seams.js';

const SPEC = { maxPositional: 0 } as const;

export async function runSnapshotCommand(deps: CliDeps, args: readonly string[]): Promise<CommandOutput> {
  parseCommandArgs(SPEC, args);
  const snapshot = deps.snapshot;
  if (snapshot === null) {
    throw capabilityUnsupported('snapshot');
  }
  const data = await snapshot.capture();
  const text = deps.t('snapshot.line', { profileId: data.profileId, at: data.at });
  return { text, data: { snapshot: data } };
}