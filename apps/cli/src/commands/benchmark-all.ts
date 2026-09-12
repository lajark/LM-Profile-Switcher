/**
 * `lmps benchmark-all <id...> [--yes] [--samples N] [--max-tokens N]
 * [--allow-battery]`: the bounded, cancelable batch Benchmark orchestration
 * (M5-003). Sequentially runs the single-profile Benchmark Lite for each
 * stored profile through the injected `BenchmarkSeam`, sharing one AbortSignal
 * across the whole batch so a Ctrl+C cancels the run in flight AND stops any
 * remaining profiles (the rest are reported as skipped). Each completed result
 * may `--yes` stamp its profile validation (incl. M5-003 `memoryPeakBytes`
 * calibration backfill), so a follow-up `optimize` can calibrate every
 * measured candidate.
 *
 * Exit-code contract mirrors the single-profile command: measurement failures
 * (timeout/OOM/crash) still produce a logged `failed` result and exit 0; any
 * canceled result / aborted batch exits 2; frozen battery/lock guards are
 * user-level exit 4; a null seam exits 6; an unknown profile id exits 4.
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
  type BatchBenchmarkEntry,
} from './benchmark-common.js';
import type { BenchmarkContext } from './benchmark.js';

const SPEC = {
  flags: { yes: 'boolean', samples: 'string', 'max-tokens': 'string', 'allow-battery': 'boolean' },
} as const;

/** One skipped profile (an aborted batch never runs the remaining ones). */
interface SkippedEntry {
  profileId: string;
  reason: 'canceled';
}

export interface BenchmarkAllOutcome {
  results: BatchBenchmarkEntry[];
  skipped: SkippedEntry[];
  /** True when the shared signal aborted the batch at some point. */
  canceled: boolean;
}

export async function runBenchmarkAllCommand(
  deps: CliDeps,
  args: readonly string[],
  context: BenchmarkContext,
): Promise<CommandOutput> {
  const parsed = parseCommandArgs(SPEC, args);
  const seam = deps.benchmark;
  if (seam === null || seam === undefined) throw capabilityUnsupported('benchmark');

  const ids = parsed.positionals;
  if (ids.length === 0) {
    throw new CliError('USAGE', 'benchmark-all requires at least one profile id', {
      detail: 'missing profile id',
    });
  }

  const samples = parseInRange(parsed.flags.samples, DEFAULT_SAMPLES, SAMPLES_MIN, SAMPLES_MAX, '--samples');
  const maxTokens = parseInRange(parsed.flags['max-tokens'], DEFAULT_MAX_TOKENS, MAX_TOKENS_MIN, MAX_TOKENS_MAX, '--max-tokens');
  const allowBattery = parsed.flags['allow-battery'] === true;
  const yes = parsed.flags.yes === true;
  const signal = context.signal;

  const results: BatchBenchmarkEntry[] = [];
  const skipped: SkippedEntry[] = [];
  let aborted = false;

  for (const id of ids) {
    // A prior cancel, or the shared signal aborting between profiles, skips the
    // rest of the batch (sequential bounded orchestration respects the user).
    if (aborted || isAborted(signal)) {
      skipped.push({ profileId: id, reason: 'canceled' });
      continue;
    }
    const profile = deps.store.get(id); // STORE_NOT_FOUND → exit 4 (throws out)

    let result: BenchmarkResult;
    try {
      result = await seam.service.run(profile, {
        samples,
        maxTokens,
        allowBattery,
        signal,
        sampleTimeoutMs: context.timeoutMs ?? undefined,
      });
    } catch (error) {
      // Guards (battery/lock/preflight) are user-level exit 4; a cancellation
      // throwing out of the service stops the batch too.
      throw mapGuardFailure(error);
    }

    if (result.status === 'canceled') aborted = true;
    results.push({
      profileId: id,
      result,
      validationStamp: yes ? stampBenchmarked(deps, result, id) : null,
    });
  }

  const lastCanceled = results.length > 0 && results[results.length - 1]?.result.status === 'canceled';
  const canceled = aborted || lastCanceled || isAborted(signal);
  const text = buildHumanText(deps, results, skipped);
  return {
    text,
    data: { results, skipped, canceled },
    exitCode: canceled ? EXIT.USER_CANCELLED : EXIT.SUCCESS,
  };
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

/** Renders each run's summary plus any last-canceled/skipped notes. */
function buildHumanText(deps: CliDeps, results: BatchBenchmarkEntry[], skipped: SkippedEntry[]): string {
  const lines: string[] = [];
  let index = 0;
  for (const entry of results) {
    index += 1;
    const header = deps.t('benchmarkAll.header', { index: String(index), id: entry.profileId });
    lines.push(header);
    lines.push(humanSummary(deps, entry.result));
    if (entry.validationStamp !== null) lines.push(deps.t('benchmark.saved'));
    if (entry.result.status === 'canceled') break; // batch stops after a cancel
  }
  for (const item of skipped) {
    lines.push(deps.t('benchmarkAll.skipped', { id: item.profileId }));
  }
  return lines.join('\n');
}