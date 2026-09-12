/**
 * BenchmarkService (M2-003 Benchmark Lite): orchestrates one bounded benchmark
 * run for a single profile configuration. Pure module — every host coupling
 * (LM Studio, hardware probe, clock, lock, audit sink) enters through the
 * injected ports. Flow: lock → hardware baseline → battery guard → load →
 * memory sample → N× measure → memory sample → restore → construct result →
 * log. Guard failures (battery, lock busy) throw a BenchmarkError that the CLI
 * maps to exit 4; measurement/battery/crash classification lands in the result
 * itself (`status:'failed'` + `errorCode`) so the audit record is still kept.
 */
import {
  aggregateSamples,
  buildBenchmarkResult,
  configSnapshotOf,
  SEED_BENCHMARK_SUITE,
  type BenchmarkSuite,
  type SampleMetrics,
} from '@lmps/benchmark';
import type { BenchmarkResult, CompositeProfile, HardwareProfile } from '@lmps/domain';

import { BenchmarkError, isBenchmarkError, type BenchmarkErrorCode } from './errors.js';
import type {
  ActivationLock,
  BenchmarkLogSink,
  BenchmarkMeasureOptions,
  BenchmarkRuntime,
  BenchmarkSample,
  HardwarePort,
  RunnerContext,
} from './ports.js';

export const DEFAULT_BENCHMARK_SAMPLES = 3;
export const MAX_BENCHMARK_SAMPLES = 10;
export const DEFAULT_BENCHMARK_MAX_TOKENS = 64;
export const MAX_BENCHMARK_MAX_TOKENS = 512;

export interface BenchmarkPorts {
  runtime: BenchmarkRuntime;
  hardware: HardwarePort;
  lock: ActivationLock;
  log: BenchmarkLogSink;
}

export interface BenchmarkRunOptions {
  /** Number of measured samples; clamped to [1, MAX_BENCHMARK_SAMPLES]. */
  samples?: number;
  /** Cap on generated tokens per sample; clamped to [1, MAX_BENCHMARK_MAX_TOKENS]. */
  maxTokens?: number;
  /** Allow running on battery; default refuses (guard, PRD FR-07). */
  allowBattery?: boolean;
  signal?: AbortSignal;
  /** Per-sample time budget in ms; 0 disables; default ctx.defaultStageTimeoutMs. */
  sampleTimeoutMs?: number;
  promptSuite?: BenchmarkSuite;
}

export interface BenchmarkService {
  run(profile: CompositeProfile, options?: BenchmarkRunOptions): Promise<BenchmarkResult>;
}

export function createBenchmarkService(ctx: RunnerContext, ports: BenchmarkPorts): BenchmarkService {
  return { run: (profile, options = {}) => run(ctx, ports, profile, options) };
}

/** True when the caller canceled; a helper so control flow can't narrow it. */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

async function run(
  ctx: RunnerContext,
  ports: BenchmarkPorts,
  profile: CompositeProfile,
  options: BenchmarkRunOptions,
): Promise<BenchmarkResult> {
  const suite = options.promptSuite ?? SEED_BENCHMARK_SUITE;
  if (suite.prompts.length === 0) {
    throw new BenchmarkError('BENCHMARK_PREFLIGHT', 'benchmark suite has no prompts', {
      detail: `suite ${suite.id} defines no prompts`,
    });
  }
  const samples = clampInt(options.samples ?? DEFAULT_BENCHMARK_SAMPLES, 1, MAX_BENCHMARK_SAMPLES);
  const maxTokens = clampInt(options.maxTokens ?? DEFAULT_BENCHMARK_MAX_TOKENS, 1, MAX_BENCHMARK_MAX_TOKENS);
  const sampleTimeoutMs = options.sampleTimeoutMs ?? ctx.defaultStageTimeoutMs;
  const signal = options.signal;
  const allowBattery = options.allowBattery === true;

  const acquired = await ports.lock.acquire();
  if (!acquired) {
    throw new BenchmarkError('BENCHMARK_LOCK_BUSY', 'another activation or benchmark holds the lock', {
      detail: 'activation.lock is held',
    });
  }

  const startedAt = ctx.now();
  const id = ctx.createTxId();
  // Null peaks are honest "no VRAM report" points (non-NVIDIA hosts); the
  // aggregation filters them out and keeps the max of the measured ones.
  const peaks: Array<number | null> = [];
  const measured: SampleMetrics[] = [];
  let status: BenchmarkResult['status'] = 'completed';
  let errorCode: string | null = null;
  let loadMs: number | null = null;
  let baseline: HardwareProfile | null = null;

  try {
    try {
      baseline = await ports.hardware.profile();
    } catch {
      // No fingerprint, no trustworthy result: report a failed run instead of
      // inventing provenance.
      status = 'failed';
      errorCode = 'BENCHMARK_CRASH';
      peaks.push(sampleMemoryPeak(baseline));
      return await finish(ctx, ports, profile, suite, id, startedAt, status, errorCode, loadMs, peaks, measured, baseline);
    }
    peaks.push(sampleMemoryPeak(baseline));

    if (baseline.power?.onBattery === true && !allowBattery) {
      throw new BenchmarkError('BENCHMARK_BATTERY_GUARD', 'benchmark refused on battery', {
        detail: 'power is on battery; pass --allow-battery to override',
      });
    }

    if (isAborted(signal)) {
      status = 'canceled';
      errorCode = 'BENCHMARK_CANCELED';
    } else {
      const loadOutcome = await loadConfiguration(ports, profile, signal);
      if (typeof loadOutcome === 'string') {
        // A load failure is a benchmark-level failure: environment failures
        // (unreachable/auth) are rethrown out of loadConfiguration and only a
        // measurement-class load failure lands here as a failed result.
        if (loadOutcome === 'BENCHMARK_CANCELED') status = 'canceled';
        else status = 'failed';
        errorCode = loadOutcome;
        peaks.push(sampleMemoryPeak(baseline));
      } else {
        loadMs = loadOutcome.loadMs;
        peaks.push(sampleMemoryPeak(baseline));
        for (let i = 0; i < samples; i += 1) {
          if (isAborted(signal)) {
            status = 'canceled';
            errorCode = 'BENCHMARK_CANCELED';
            break;
          }
          const index = i % suite.prompts.length;
          const prompt = suite.prompts[index];
          if (prompt === undefined) break; // defensive: suite length checked above
          const sample = await measureSample(ctx, ports, profile, {
            prompt: prompt.promptText,
            maxTokens: Math.min(prompt.maxTokens, maxTokens),
            signal,
          }, sampleTimeoutMs, signal);
          if (typeof sample === 'string') {
            status = 'failed';
            errorCode = sample;
            break;
          }
          measured.push({
            ttftMs: sample.ttftMs,
            generatedTokens: sample.generatedTokens,
            totalMs: sample.totalMs,
            promptTokens: prompt.approxPromptTokens,
          });
        }
        peaks.push(sampleMemoryPeak(baseline));
      }
    }
  } finally {
    // Unload the benchmark configuration and free the lock no matter how the
    // run ended; a failed restore leaves a lease the next acquire reclaims.
    try {
      await ports.runtime.restore();
    } catch {
      // Best-effort: a crashed host cannot always unload.
    }
    try {
      await ports.lock.release();
    } catch {
      // A failed release leaves residue for the next acquire.
    }
  }

  return await finish(ctx, ports, profile, suite, id, startedAt, status, errorCode, loadMs, peaks, measured, baseline);
}

async function finish(
  ctx: RunnerContext,
  ports: BenchmarkPorts,
  profile: CompositeProfile,
  suite: BenchmarkSuite,
  id: string,
  startedAt: string,
  status: BenchmarkResult['status'],
  errorCode: string | null,
  loadMs: number | null,
  peaks: Array<number | null>,
  measured: SampleMetrics[],
  baseline: HardwareProfile | null,
): Promise<BenchmarkResult> {
  const result = buildBenchmarkResult({
    id,
    modelKey: profile.model.modelKey,
    quantization: profile.model.quantization ?? null,
    taskType: profile.task.type,
    status,
    metrics: aggregateSamples(measured, {
      loadMs,
      memoryPeaks: peaks.filter((peak): peak is number => peak !== null),
    }),
    // Measured-feedback loop: record which configuration the run exercised so
    // the optimizer can attribute the numbers back to matching candidates.
    config: configSnapshotOf(profile),
    hardwareFingerprint: baseline?.hardwareFingerprint ?? null,
    lmStudioVersion: baseline?.versions?.lmStudio ?? null,
    runtimeVersion: baseline?.versions?.runtime ?? null,
    adapterCapabilityVersion: null,
    startedAt,
    finishedAt: ctx.now(),
    errorCode,
    modelFileHash: profile.model.fileHash ?? null,
    promptSuiteId: suite.id,
    promptSuiteVersion: suite.version,
  });
  await ports.log.write(result);
  return result;
}

/**
 * Loads the benchmark configuration. Measurement-class load failures surface as
 * a failure code string (failed/canceled result); environment failures — host
 * unreachable or token refused — are rethrown so the caller (CLI) maps them to
 * a user-level preflight (LM_UNREACHABLE, exit 4) instead of faking a result.
 */
async function loadConfiguration(
  ports: BenchmarkPorts,
  profile: CompositeProfile,
  signal: AbortSignal | undefined,
): Promise<{ loadMs: number } | BenchmarkErrorCode> {
  if (isAborted(signal)) return 'BENCHMARK_CANCELED';
  try {
    const loaded = await ports.runtime.load(profile);
    return { loadMs: loaded.loadMs };
  } catch (error) {
    if (isAborted(signal)) return 'BENCHMARK_CANCELED';
    if (isReachabilityError(error)) throw error;
    return classifyMeasureFailure(error);
  }
}

/** Environment-class failures (host unreachable/auth) pass through the service. */
function isReachabilityError(error: unknown): boolean {
  const record = error as { kind?: unknown; code?: unknown } | null;
  const token =
    typeof record?.kind === 'string' ? record.kind : typeof record?.code === 'string' ? record.code : null;
  if (token === null) return false;
  const t = token.toLowerCase();
  return t.includes('unreachable') || t.includes('auth');
}

/**
 * Runs one sample under the per-sample time budget. The wait race mirrors the
 * activation runner: a timeout surface as a BENCHMARK_TIMEOUT code, an abort as
 * canceled. Returns the sample on success or a failure code string.
 */
async function measureSample(
  ctx: RunnerContext,
  ports: BenchmarkPorts,
  profile: CompositeProfile,
  options: BenchmarkMeasureOptions,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<BenchmarkSample | BenchmarkErrorCode> {
  try {
    if (timeoutMs <= 0) return await ports.runtime.measure(profile, options);
    const action = ports.runtime.measure(profile, options);
    const guard = ctx.wait(timeoutMs, signal).then(
      () => {
        throw new BenchmarkError('BENCHMARK_TIMEOUT', 'benchmark sample timed out', {
          detail: 'per-sample measure exceeded the time budget',
        });
      },
      (error: unknown) => {
        throw error;
      },
    );
    const sampled = await Promise.race([action, guard]);
    if (isAborted(signal)) return 'BENCHMARK_CANCELED';
    return sampled;
  } catch (error) {
    if (isAborted(signal)) return 'BENCHMARK_CANCELED';
    return classifyMeasureFailure(error);
  }
}

/** Maps any thrown measure failure to a stable benchmark error code. */
function classifyMeasureFailure(error: unknown): BenchmarkErrorCode {
  if (isBenchmarkError(error)) return error.code;
  const record = error as { kind?: unknown; code?: unknown } | null;
  const token =
    typeof record?.kind === 'string' ? record.kind : typeof record?.code === 'string' ? record.code : null;
  if (token !== null) {
    const t = token.toLowerCase();
    if (t.includes('timeout') || t.includes('timed out')) return 'BENCHMARK_TIMEOUT';
    if (t.includes('oom') || t.includes('out of memory')) return 'BENCHMARK_OOM';
  }
  return 'BENCHMARK_CRASH';
}

/**
 * Peak VRAM used across the sample points: sum of (total − available) per GPU
 * (NVIDIA hosts only). Non-NVIDIA hosts report gpus=null and contribute null,
 * so the memory figure is honestly absent rather than guessed.
 */
function sampleMemoryPeak(profile: HardwareProfile | null): number | null {
  if (profile === null) return null;
  const gpus = profile.gpus;
  if (gpus === null || gpus === undefined) return null;
  let peak = 0;
  let measured = false;
  for (const gpu of gpus) {
    if (typeof gpu.vramTotalBytes === 'number' && typeof gpu.vramAvailableBytes === 'number') {
      peak = Math.max(peak, gpu.vramTotalBytes - gpu.vramAvailableBytes);
      measured = true;
    }
  }
  return measured ? peak : null;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}