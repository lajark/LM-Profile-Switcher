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
import { isBenchmarkError } from '@lmps/core';
import type { BenchmarkResult } from '@lmps/domain';

import { capabilityUnsupported, CliError } from '../errors.js';
import { EXIT } from '../exit-codes.js';
import { parseCommandArgs } from '../options.js';
import type { CliDeps, CommandOutput } from '../seams.js';

const SPEC = {
  flags: { yes: 'boolean', samples: 'string', 'max-tokens': 'string', 'allow-battery': 'boolean' },
  maxPositional: 1,
} as const;

const DEFAULT_SAMPLES = 3;
const SAMPLES_MIN = 1;
const SAMPLES_MAX = 10;
const DEFAULT_MAX_TOKENS = 64;
const MAX_TOKENS_MIN = 1;
const MAX_TOKENS_MAX = 512;

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

  const validated = runYes(deps, parsed.flags.yes === true, result, id);
  const text = `${humanSummary(deps, result)}${validated === null ? '' : `\n${deps.t('benchmark.saved')}`}`;
  return {
    text,
    data: { result, validated: validated !== null },
    exitCode: result.status === 'canceled' ? EXIT.USER_CANCELLED : EXIT.SUCCESS,
  };
}

/** Battery/lock/preflight benchmark errors map to user-level exit 4 (USAGE). */
function mapGuardFailure(error: unknown): unknown {
  if (!isBenchmarkError(error)) return error;
  switch (error.code) {
    case 'BENCHMARK_BATTERY_GUARD':
      return new CliError('USAGE', 'benchmark refused on battery', { params: { key: 'benchmark.batteryGuard' } });
    case 'BENCHMARK_LOCK_BUSY':
      return new CliError('USAGE', 'lock is busy', { params: { key: 'error.lockBusy' } });
    case 'BENCHMARK_PREFLIGHT':
      return new CliError('USAGE', 'benchmark preflight failed', { params: { key: 'benchmark.preflight' } });
    default:
      // Timeout/OOM/crash become result-level codes inside the service; a stray
      // throw here is a wiring bug and must surface as INTERNAL.
      return error;
  }
}

/**
 * `--yes` stamps the profile validation with the just-measured evidence. A
 * result that is not `completed` never marks the profile as benchmarked.
 * Returns the benchmark id when stamped so the caller can report it. The stamp
 * targets `profileId` — the transaction id in `result` identifies the run, not
 * the profile document.
 */
function runYes(deps: CliDeps, yes: boolean, result: BenchmarkResult, profileId: string): string | null {
  if (!yes || result.status !== 'completed') return null;
  deps.store.update(profileId, {
    validation: {
      source: 'benchmarked',
      benchmarkId: result.id,
      testedAt: deps.now(),
      hardwareFingerprint: result.hardwareFingerprint,
      lmStudioVersion: result.lmStudioVersion,
      runtimeVersion: result.runtimeVersion,
      adapterCapabilityVersion: result.adapterCapabilityVersion,
    },
  });
  return result.id;
}

function humanSummary(deps: CliDeps, result: BenchmarkResult): string {
  const lines: string[] = [];
  lines.push(deps.t('benchmark.title'));
  lines.push(deps.t('benchmark.status', { status: statusText(deps, result) }));
  lines.push(`  ${metricLine(deps, 'benchmark.loadMs', formatMs(result.metrics.loadMs))}`);
  lines.push(`  ${metricLine(deps, 'benchmark.ttft', formatMs(result.metrics.ttftMs))}`);
  lines.push(`  ${metricLine(deps, 'benchmark.prefill', formatRate(result.metrics.prefillTokensPerSecond))}`);
  lines.push(`  ${metricLine(deps, 'benchmark.decode', formatRate(result.metrics.decodeTokensPerSecond))}`);
  lines.push(`  ${metricLine(deps, 'benchmark.memoryPeak', formatBytes(result.metrics.memoryPeakBytes))}`);
  lines.push(`  ${deps.t('benchmark.samples', { count: String(result.metrics.samples) })}`);
  if (result.hardwareFingerprint !== null) {
    lines.push(`  ${deps.t('benchmark.fingerprint', { fingerprint: result.hardwareFingerprint })}`);
  }
  lines.push(`  ${deps.t('benchmark.promptSuite', { version: result.promptSuiteVersion ?? '' })}`);
  return lines.join('\n');
}

function statusText(deps: CliDeps, result: BenchmarkResult): string {
  if (result.status === 'canceled') return deps.t('benchmark.canceled');
  if (result.status === 'failed') {
    return result.errorCode === null || result.errorCode === ''
      ? deps.t('benchmark.failed')
      : deps.t('benchmark.failedWithCode', { code: result.errorCode });
  }
  return deps.t('benchmark.completed');
}

type MetricKey = 'benchmark.loadMs' | 'benchmark.ttft' | 'benchmark.prefill' | 'benchmark.decode' | 'benchmark.memoryPeak';

function metricLine(deps: CliDeps, key: MetricKey, value: string): string {
  return `${deps.t(key)}: ${value}`;
}

function formatMs(value: number | null | undefined): string {
  return value === null || value === undefined ? 'n/a' : `${value.toFixed(0)} ms`;
}

function formatRate(value: number | null | undefined): string {
  return value === null || value === undefined ? 'n/a' : `${value.toFixed(1)} tok/s`;
}

function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'n/a';
  return `${(value / (1024 ** 3)).toFixed(2)} GiB`;
}

function parseInRange(
  raw: string | boolean | undefined,
  fallback: number,
  min: number,
  max: number,
  flag: string,
): number {
  if (raw === undefined || typeof raw !== 'string') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new CliError('USAGE', `${flag} must be an integer in [${min}, ${max}]`, {
      detail: `invalid ${flag} value: ${raw}`,
      params: { key: 'benchmark.invalidRange', values: { flag, min: String(min), max: String(max) } },
    });
  }
  return value;
}