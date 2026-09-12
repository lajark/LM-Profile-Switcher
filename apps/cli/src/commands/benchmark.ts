/**
 * `lmps benchmark <id> [--yes] [--samples N] [--max-tokens N] [--allow-battery]`:
 * runs the bounded Benchmark Lite (M2-003) for one stored profile through the
 * injected `BenchmarkSeam`. It never activates — the run loads the target,
 * streams bounded generations, unloads it, and writes the result record.
 *
 * Exit-code contract (user-approved 2026-09-05): a measurement failure
 * (timeout/OOM/crash) still PRODUCES and logs a `status:'failed'` result and
 * exits 0 — the outcome is data, not an error; battery/lock usage problems are
 * user-level exit 4; Ctrl+C cancel exits 2; a null seam exits 6.
 *
 * `--yes` stamps the profile `validation.source:'benchmarked'` (plus benchmark
 * id and the versions/fingerprint the run was captured under) so future
 * optimizer runs can treat the result as `measured:true` evidence. Failed or
 * canceled runs are never stamped.
 */
import type { BenchmarkResult } from '@lmps/domain';

import { capabilityUnsupported, CliError } from '../errors.js';
import { EXIT } from '../exit-codes.js';
import { parseCommandArgs } from '../options.js';
import type { CliDeps, CommandOutput } from '../seams.js';
import {
  DEFAULT_MAX_TOKENS,
  DEFAULT_SAMPLES,
  humanSummary,
  mapGuardFailure,
  MAX_TOKENS_MAX,
  MAX_TOKENS_MIN,
  parseInRange,
  SAMPLES_MAX,
  SAMPLES_MIN,
  stampBenchmarked,
} from './benchmark-common.js';

const SPEC = {
  flags: { yes: 'boolean', samples: 'string', 'max-tokens': 'string', 'allow-battery': 'boolean' },
  maxPositional: 1,
} as const;

export interface BenchmarkContext {
  signal?: AbortSignal;
  timeoutMs?: number | null;
}

export async function runBenchmarkCommand(
  deps: CliDeps,
  args: readonly string[],
  context: BenchmarkContext,
): Promise<CommandOutput> {
  const parsed = parseCommandArgs(SPEC, args);
  const seam = deps.benchmark;
  // A harness or earlier wiring state may carry `undefined`; treat it as absent.
  if (seam === null || seam === undefined) throw capabilityUnsupported('benchmark');

  const id = parsed.positionals[0];
  if (id === undefined) {
    throw new CliError('USAGE', 'benchmark requires a profile id', { detail: 'missing profile id' });
  }

  const profile = deps.store.get(id); // STORE_NOT_FOUND → exit 4

  const samples = parseInRange(parsed.flags.samples, DEFAULT_SAMPLES, SAMPLES_MIN, SAMPLES_MAX, '--samples');
  const maxTokens = parseInRange(parsed.flags['max-tokens'], DEFAULT_MAX_TOKENS, MAX_TOKENS_MIN, MAX_TOKENS_MAX, '--max-tokens');
  const allowBattery = parsed.flags['allow-battery'] === true;

  let result: BenchmarkResult;
  try {
    result = await seam.service.run(profile, {
      samples,
      maxTokens,
      allowBattery,
      signal: context.signal,
      sampleTimeoutMs: context.timeoutMs ?? undefined,
    });
  } catch (error) {
    // Guard failures (battery/lock) are user-level; reachability was already
    // mapped by the seam; anything else surfaces through exitCodeForError.
    throw mapGuardFailure(error);
  }

  const validated = parsed.flags.yes === true ? stampBenchmarked(deps, result, id) : null;
  const text = `${humanSummary(deps, result)}${validated === null ? '' : `\n${deps.t('benchmark.saved')}`}`;
  return {
    text,
    data: { result, validated: validated !== null },
    exitCode: result.status === 'canceled' ? EXIT.USER_CANCELLED : EXIT.SUCCESS,
  };
}