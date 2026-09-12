// M2-003 BenchmarkService orchestration: inject scriptable benchmark ports and
// a scriptable clock, then assert the assembled result record — happy path
// aggregation, battery/lock/preflight guards, cancel semantics, measurement
// failure classification, the reachability rethrow and the strict-schema gate.
import { describe, expect, it } from 'vitest';
import {
  BenchmarkError,
  createBenchmarkService,
  type BenchmarkPorts,
  type BenchmarkRuntime,
  type BenchmarkSample,
  type HardwarePort,
  type RunnerContext,
} from '@lmps/core';
import type { BenchmarkResult, HardwareProfile } from '@lmps/domain';
import { StrictBenchmarkResultSchema } from '@lmps/domain';

import { makeContext, makeProfile, NOW } from './fixtures';

const GIB = 1024 ** 3;

interface RuntimeOptions {
  loadMs?: number;
  samples?: BenchmarkSample[];
  faults?: { load?: Error; measure?: Error; restore?: Error };
  /** Called on each measure; can abort the signal to simulate user cancel. */
  onMeasure?: (index: number, signal: AbortSignal | undefined) => void;
}

function makeRuntime(options: RuntimeOptions = {}): BenchmarkRuntime {
  const samples = options.samples ?? [
    { ttftMs: 100, generatedTokens: 20, totalMs: 500, finishReason: 'stop' },
    { ttftMs: 120, generatedTokens: 22, totalMs: 540, finishReason: 'stop' },
  ];
  const faults = options.faults ?? {};
  let index = 0;
  return {
    async getActiveState() {
      return { profileId: null, modelKey: null, since: null };
    },
    async load() {
      if (faults.load !== undefined) throw faults.load;
      return { loadConfig: { contextLength: 8192 }, loadMs: options.loadMs ?? 1000 };
    },
    async measure(_profile, measureOptions) {
      if (faults.measure !== undefined) throw faults.measure;
      options.onMeasure?.(index, measureOptions.signal);
      const sample = samples[index % samples.length] ?? { ttftMs: null, generatedTokens: 0, totalMs: 0, finishReason: null };
      index += 1;
      return sample;
    },
    async restore() {
      if (faults.restore !== undefined) throw faults.restore;
    },
  };
}

function makeHardware(battery = false): HardwarePort {
  const profile: HardwareProfile = {
    schemaVersion: 2,
    os: 'Windows 11',
    gpus: [{ name: 'RTX 5060 Ti', vramTotalBytes: 16 * GIB, vramAvailableBytes: 13 * GIB }],
    power: { onBattery: battery },
    versions: { lmStudio: 'v0.3.27', runtime: '0.3.27' },
    hardwareFingerprint: 'fp-123',
    probedAt: NOW,
  };
  return { profile: async () => profile };
}

function makePorts(
  runtime: BenchmarkRuntime,
  hardware: HardwarePort,
  lockAcquire: boolean,
): { ports: BenchmarkPorts; written: BenchmarkResult[]; released: () => boolean } {
  const written: BenchmarkResult[] = [];
  let released = false;
  const ports: BenchmarkPorts = {
    runtime,
    hardware,
    lock: {
      acquire: async () => lockAcquire,
      release: async () => {
        released = true;
      },
    },
    log: { write: async (result) => void written.push(result) },
  };
  return { ports, written, released: () => released };
}

describe('createBenchmarkService', () => {
  it('produces a completed, fingerprint-bound result and logs it', async () => {
    const runtime = makeRuntime();
    const { ports, written, released } = makePorts(runtime, makeHardware(), true);
    const service = createBenchmarkService(makeContext(), ports);

    const result = await service.run(makeProfile('rag-prime'), { samples: 2, maxTokens: 32 });
    expect(result.status).toBe('completed');
    expect(result.errorCode).toBeNull();
    expect(result.id).toBe('tx-1');
    expect(result.modelKey).toBe('synthetic/test-model');
    expect(result.metrics.samples).toBe(2);
    expect(result.metrics.ttftMs).toBe(110); // median of [100,120]
    expect(result.metrics.loadMs).toBe(1000);
    expect(result.metrics.memoryPeakBytes).toBe(3 * GIB);
    expect(result.hardwareFingerprint).toBe('fp-123');
    expect(result.lmStudioVersion).toBe('v0.3.27');
    expect(result.runtimeVersion).toBe('0.3.27');
    expect(result.promptSuiteId).toBe('default');
    expect(result.promptSuiteVersion).toBe('2026.09.1');
    // Measured-feedback loop: the record carries the measured configuration.
    expect(result.config).toEqual({
      profileId: 'rag-prime',
      gpuOffload: 'max',
      contextLength: 8192,
      evalBatchSize: null,
      flashAttention: null,
      temperature: 0.7,
      topP: null,
    });
    expect(released()).toBe(true);
    expect(written).toEqual([result]);
    expect(StrictBenchmarkResultSchema.safeParse(result).success).toBe(true);
  });

  it('refreshes hardware after load and after every inference sample', async () => {
    const GIB_LOCAL = 1024 ** 3;
    const snapshot = (gpuAvailable: number, ramAvailable: number): HardwareProfile => ({
      schemaVersion: 2,
      os: 'Windows 11',
      gpus: [{ name: 'RTX', vramTotalBytes: 16 * GIB_LOCAL, vramAvailableBytes: gpuAvailable }],
      memory: { totalBytes: 32 * GIB_LOCAL, availableBytes: ramAvailable },
      power: { onBattery: false },
      versions: { lmStudio: 'v0.3.27', runtime: '0.3.27' },
      hardwareFingerprint: 'fp-refresh',
      probedAt: NOW,
    });
    // baseline, after load, after sample 1, after sample 2
    const snapshots = [
      snapshot(14 * GIB_LOCAL, 24 * GIB_LOCAL),
      snapshot(13 * GIB_LOCAL, 23 * GIB_LOCAL),
      snapshot(12 * GIB_LOCAL, 22 * GIB_LOCAL),
      snapshot(11 * GIB_LOCAL, 21 * GIB_LOCAL),
    ];
    let calls = 0;
    const hardware: HardwarePort = {
      profile: async () => {
        const value = snapshots[calls];
        calls += 1;
        if (value === undefined) throw new Error('unexpected hardware sample');
        return value;
      },
    };
    const { ports } = makePorts(makeRuntime(), hardware, true);
    const result = await createBenchmarkService(makeContext(), ports).run(makeProfile('refresh'), { samples: 2 });
    expect(calls).toBe(4);
    expect(result.metrics.resourceUsage).toEqual({
      schemaVersion: 1,
      method: 'host-snapshot-delta',
      sampleCount: 2,
      completeness: 'complete',
      peakDelta: { vramBytes: 3 * GIB_LOCAL, systemRamBytes: 3 * GIB_LOCAL, totalBytes: 6 * GIB_LOCAL },
    });
  });

  it('records a conservative failed result when a post-load sample fails', async () => {
    const base = await makeHardware().profile();
    let calls = 0;
    const hardware: HardwarePort = {
      profile: async () => {
        calls += 1;
        if (calls === 2) throw new Error('probe unavailable');
        return base;
      },
    };
    const { ports, written } = makePorts(makeRuntime(), hardware, true);
    const result = await createBenchmarkService(makeContext(), ports).run(makeProfile('sample-failure'), { samples: 1 });
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('BENCHMARK_CRASH');
    expect(result.metrics.resourceUsage).toMatchObject({ completeness: 'unavailable', sampleCount: 0 });
    expect(calls).toBe(2);
    expect(written).toEqual([result]);
  });

  it('refuses on battery without --allow-battery and still releases the lock', async () => {
    const runtime = makeRuntime();
    const { ports, written, released } = makePorts(runtime, makeHardware(true), true);
    const service = createBenchmarkService(makeContext(), ports);

    await expect(service.run(makeProfile('rag-prime'))).rejects.toMatchObject({
      code: 'BENCHMARK_BATTERY_GUARD',
    });
    expect(released()).toBe(true);
    expect(written).toEqual([]);
  });

  it('accepts battery power with --allow-battery', async () => {
    const runtime = makeRuntime();
    const { ports, written } = makePorts(runtime, makeHardware(true), true);
    const service = createBenchmarkService(makeContext(), ports);

    const result = await service.run(makeProfile('rag-prime'), { samples: 1, allowBattery: true });
    expect(result.status).toBe('completed');
    expect(written.length).toBe(1);
  });

  it('throws LOCK_BUSY when the activation lock is held', async () => {
    const runtime = makeRuntime();
    const { ports, written } = makePorts(runtime, makeHardware(), false);
    const service = createBenchmarkService(makeContext(), ports);

    await expect(service.run(makeProfile('rag-prime'))).rejects.toMatchObject({ code: 'BENCHMARK_LOCK_BUSY' });
    expect(written).toEqual([]);
  });

  it('records canceled when the signal is already aborted before loading', async () => {
    const controller = new AbortController();
    controller.abort();
    const runtime = makeRuntime();
    const { ports, written, released } = makePorts(runtime, makeHardware(), true);
    const service = createBenchmarkService(makeContext(), ports);

    const result = await service.run(makeProfile('rag-prime'), { signal: controller.signal, samples: 2 });
    expect(result.status).toBe('canceled');
    expect(result.errorCode).toBe('BENCHMARK_CANCELED');
    expect(released()).toBe(true);
    expect(written).toEqual([result]);
  });

  it('canceled when the signal aborts between samples', async () => {
    const controller = new AbortController();
    const runtime = makeRuntime({
      onMeasure: (measureIndex, signal) => {
        if (measureIndex === 1) controller.abort();
        void signal;
      },
    });
    const { ports, written } = makePorts(runtime, makeHardware(), true);
    const service = createBenchmarkService(makeContext(), ports);

    const result = await service.run(makeProfile('rag-prime'), { samples: 3, signal: controller.signal });
    expect(result.status).toBe('canceled');
    expect(result.errorCode).toBe('BENCHMARK_CANCELED');
    expect(written).toEqual([result]);
  });

  it('classifies a measure OOM into a failed result and still logs it', async () => {
    const runtime = makeRuntime({ faults: { measure: Object.assign(new Error('VRAM exhausted'), { kind: 'oom' }) } });
    const { ports, written, released } = makePorts(runtime, makeHardware(), true);
    const service = createBenchmarkService(makeContext(), ports);

    const result = await service.run(makeProfile('rag-prime'), { samples: 2 });
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('BENCHMARK_OOM');
    expect(result.metrics.samples).toBe(0);
    expect(released()).toBe(true);
    expect(written).toEqual([result]);
  });

  it('classifies a measurement-class load timeout into a failed result', async () => {
    const runtime = makeRuntime({
      faults: { load: Object.assign(new Error('server did not respond in time'), { kind: 'timeout' }) },
    });
    const { ports, written } = makePorts(runtime, makeHardware(), true);
    const service = createBenchmarkService(makeContext(), ports);

    const result = await service.run(makeProfile('rag-prime'), { samples: 2 });
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('BENCHMARK_TIMEOUT');
    expect(written).toEqual([result]);
  });

  it('rethrows environment-level load failures (unreachable) instead of faking a result', async () => {
    const unreachable = Object.assign(new Error('LM Studio unreachable'), { kind: 'unreachable' });
    const runtime = makeRuntime({ faults: { load: unreachable } });
    const { ports, written, released } = makePorts(runtime, makeHardware(), true);
    const service = createBenchmarkService(makeContext(), ports);

    await expect(service.run(makeProfile('rag-prime'))).rejects.toBe(unreachable);
    expect(released()).toBe(true);
    expect(written).toEqual([]);
  });

  it('classifies an auth failure as environment-level and rethrows', async () => {
    const auth = Object.assign(new Error('401 Unauthorized'), { code: 'auth' });
    const runtime = makeRuntime({ faults: { load: auth } });
    const { ports, written } = makePorts(runtime, makeHardware(), true);
    const service = createBenchmarkService(makeContext(), ports);

    await expect(service.run(makeProfile('rag-prime'))).rejects.toBe(auth);
    expect(written).toEqual([]);
  });

  it('maps a per-sample timeout into a failed result', async () => {
    const hangingRuntime: BenchmarkRuntime = {
      getActiveState: async () => ({ profileId: null, modelKey: null, since: null }),
      load: async () => ({ loadConfig: {}, loadMs: 100 }),
      measure: () => new Promise<BenchmarkSample>(() => undefined), // never resolves
      restore: async () => undefined,
    };
    const { ports, written, released } = makePorts(hangingRuntime, makeHardware(), true);
    const context: RunnerContext = { ...makeContext({ mode: 'resolve' }), defaultStageTimeoutMs: 50 };
    const service = createBenchmarkService(context, ports);

    const result = await service.run(makeProfile('rag-prime'), { samples: 1 });
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('BENCHMARK_TIMEOUT');
    expect(released()).toBe(true);
    expect(written).toEqual([result]);
  });

  it('restores the runtime even after a failed run', async () => {
    let restored = false;
    const runtime = makeRuntime({
      faults: { measure: Object.assign(new Error('crash'), { kind: 'crash' }) },
    });
    const patches: BenchmarkPorts = {
      runtime: {
        ...runtime,
        restore: async () => {
          restored = true;
        },
      },
      hardware: makeHardware(),
      lock: { acquire: async () => true, release: async () => undefined },
      log: { write: async () => undefined },
    };
    const service = createBenchmarkService(makeContext(), patches);
    const result = await service.run(makeProfile('rag-prime'));
    expect(result.status).toBe('failed');
    expect(restored).toBe(true);
  });

  it('rejects an empty suite as preflight before touching the lock', async () => {
    const runtime = makeRuntime();
    const { ports, written, released } = makePorts(runtime, makeHardware(), true);
    const service = createBenchmarkService(makeContext(), ports);

    await expect(
      service.run(makeProfile('rag-prime'), { promptSuite: { id: 'empty', version: 'x', prompts: [] } }),
    ).rejects.toBeInstanceOf(BenchmarkError);
    expect(written.length).toBe(0);
    expect(released()).toBe(false); // lock never acquired → nothing to release
  });
});
