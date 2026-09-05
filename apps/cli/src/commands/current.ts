/**
 * `lmps current`: reports the active profile/model through the injected state
 * port. The port stays null until M1-005 activates the state machine; until
 * then the command reports capability unsupported (exit 6) honestly.
 */
import { parseCommandArgs } from '../options.js';
import { capabilityUnsupported } from '../errors.js';
import type { CliDeps, CommandOutput } from '../seams.js';

const SPEC = { maxPositional: 0 } as const;

export async function runCurrentCommand(deps: CliDeps, args: readonly string[]): Promise<CommandOutput> {
  parseCommandArgs(SPEC, args);
  const state = deps.state;
  if (state === null) {
    throw capabilityUnsupported('current');
  }
  const active = await state.getActive();
  const text =
    active.profileId === null || active.modelKey === null
      ? deps.t('current.none')
      : deps.t('current.line', { profileId: active.profileId, modelKey: active.modelKey });
  return { text, data: { active } };
}