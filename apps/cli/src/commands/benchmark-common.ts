/**
 * Shared helpers for the single-profile `benchmark` command and the multi-profile
 * `benchmark-all` batch orchestration (M5-003). Kept here so both commands apply
 * identical bounds, exit-code mapping, per-profile `--yes` validation stamping
 * (including M6-002 synchronized resource evidence) and human metrics
 * rendering. Pure module: store/now/seam enter as params or via deps.
 */
import { isBenchmarkError } from '@lmps/core';
import type { BenchmarkResult } from '@lmps/domain';

import { CliError } from '../errors.js';
import type { CliDeps } from '../seams.js';

export const DEFAULT_SAMPLES = 3;
export const SAMPLES_MIN = 1;
export const SAMPLES_MAX = 10;
export const DEFAULT_MAX_TOKENS = 64;
export const MAX_TOKENS_MIN = 1;
export const MAX_TOKENS_MAX = 512;

/** Bounds-validate a flag value, exactly as the single-profile command does. */
export function parseInRange(
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

/** Battery/lock/preflight benchmark errors map to user-level exit 4 (USAGE). */
export function mapGuardFailure(error: unknown): unknown {
  if (!isBenchmarkError(error)) return error;
  switch (error.code) {
    case 'BENCHMARK_BATTERY_GUARD':
      return new CliError('USAGE', 'benchmark refused on battery', { params: { key: 'benchmark.batteryGuard' } });
    case 'BENCHMARK_LOCK_BUSY':
      return new CliError('USAGE', 'lock is busy', { params: { key: 'error.lockBusy' } });
    case 'BENCHMARK_PREFLIGHT':
      return new CliError('USAGE', 'benchmark preflight failed', { params: { key: 'benchmark.preflight' } });
    default:
      return error;
  }
}

/**
 * `--yes` stamps a profile validation with the just-measured evidence; a result
 * that is not `completed` never marks the profile as benchmarked. Shared by the
 * single and batch commands so both persist the same v2 resource evidence.
 */
export function stampBenchmarked(
  deps: CliDeps,
  result: BenchmarkResult,
  profileId: string,
): string | null {
  if (result.status !== 'completed') return null;
  deps.store.update(profileId, {
    validation: {
      source: 'benchmarked',
      benchmarkId: result.id,
      testedAt: deps.now(),
      hardwareFingerprint: result.hardwareFingerprint,
      lmStudioVersion: result.lmStudioVersion,
      runtimeVersion: result.runtimeVersion,
      adapterCapabilityVersion: result.adapterCapabilityVersion,
      memoryPeakBytes: result.metrics.memoryPeakBytes ?? null,
      ...(result.metrics.resourceUsage === undefined ? {} : { resourceUsage: result.metrics.resourceUsage }),
    },
  });
  return result.id;
}

/** One profile's benchmark outcome within a batch. */
export interface BatchBenchmarkEntry {
  profileId: string;
  result: BenchmarkResult;
  /** Benchmark id when `--yes` stamped, else null. */
  validationStamp: string | null;
}

export function humanSummary(deps: CliDeps, result: BenchmarkResult): string {
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

type MetricKey =
  | 'benchmark.loadMs'
  | 'benchmark.ttft'
  | 'benchmark.prefill'
  | 'benchmark.decode'
  | 'benchmark.memoryPeak';

function metricLine(deps: CliDeps, key: MetricKey, value: string): string {
  return `${deps.t(key)}: ${value}`;
}

export function formatMs(value: number | null | undefined): string {
  return value === null || value === undefined ? 'n/a' : `${value.toFixed(0)} ms`;
}

export function formatRate(value: number | null | undefined): string {
  return value === null || value === undefined ? 'n/a' : `${value.toFixed(1)} tok/s`;
}

export function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'n/a';
  return `${(value / 1024 ** 3).toFixed(2)} GiB`;
}
