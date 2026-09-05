/**
 * `lmps apply <id> [--yes]`: runs the activation transaction (M1-005) for a
 * stored profile through the injected ActivationSeam. Switching away from the
 * current active configuration requires an explicit `--yes` (project rule: no
 * silent model switches); a target that is already active is idempotent and
 * needs no confirmation. The exit code mirrors the transaction outcome — 0
 * active, 2 cancelled, 3 failed-but-recovered, 5 failed — while the machine
 * envelope stays a success record of the run itself.
 */
import { createActivationRunner } from '@lmps/core';

import { capabilityUnsupported, CliError } from '../errors.js';
import { exitCodeForActivation } from '../exit-codes.js';
import { parseCommandArgs } from '../options.js';
import type { CliDeps, CommandOutput } from '../seams.js';

const SPEC = { flags: { yes: 'boolean' }, maxPositional: 1 } as const;

export interface ApplyContext {
  /** --timeout value; null keeps the runner default. */
  timeoutMs: number | null;
  /** SIGINT-driven cancellation, lifted from the process signal. */
  signal?: AbortSignal;
}

export async function runApplyCommand(
  deps: CliDeps,
  args: readonly string[],
  context: ApplyContext,
): Promise<CommandOutput> {
  const parsed = parseCommandArgs(SPEC, args);
  const activation = deps.activation;
  if (activation === null) throw capabilityUnsupported('apply');

  const id = parsed.positionals[0];
  if (id === undefined) {
    throw new CliError('USAGE', 'apply requires a profile id', { detail: 'missing profile id' });
  }

  const profile = deps.store.get(id); // STORE_NOT_FOUND → exit 4

  // No silent switch: a target different from the active one (or no active one)
  // demands --yes. Same-target runs proceed to the runner's idempotency check.
  const active = await activation.runtime.getActiveState();
  if (parsed.flags.yes !== true && active.profileId !== profile.id) {
    throw new CliError('USAGE', 'switching requires --yes', { params: { key: 'apply.requiresYes' } });
  }

  const runner = activation.runner ?? createActivationRunner(activation.context, activation);
  const result = await runner.run(profile, {
    signal: context.signal,
    stageTimeoutMs: context.timeoutMs ?? undefined,
  });

  const { outcome, transaction } = result;
  const exitCode = exitCodeForActivation(outcome.status);
  let text: string;
  switch (outcome.status) {
    case 'active':
      text = outcome.alreadyActive
        ? deps.t('apply.idempotent', { name: transaction.targetProfileId })
        : deps.t('apply.activated', { name: transaction.targetProfileId });
      break;
    case 'canceled':
      text = deps.t('apply.canceled');
      break;
    case 'failed-but-recovered':
      text = deps.t('apply.recovered', { name: transaction.previousProfileId ?? '' });
      break;
    case 'failed':
      text = deps.t('apply.failed');
      break;
  }
  return { text, data: { transaction }, exitCode };
}