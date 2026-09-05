// Shared synthetic fakes for the M1-005 core suite. Every runner dependency is
// injected: the runtime/lock/estimate/log ports plus a programmable clock/wait
// context, so no test touches real timers, the file system or LM Studio.
import type { CompositeProfile, LoadEstimate, ActivationTransaction } from '@lmps/domain';
import {
  ActivationError,
  type ActivationLock,
  type ActivationRuntime,
  type ActiveState,
  type EstimatePort,
  type RunnerContext,
  type TransactionLogSink,
} from '@lmps/core';

export const NOW = '2026-08-22T01:02:03.000Z';

/** A document that passes StrictCompositeProfileSchema (runner validates it). */
export function makeProfile(id: string, overrides: Partial<CompositeProfile> = {}): CompositeProfile {
  return {
    schemaVersion: 1,
    id,
    displayName: { 'zh-CN': `Test ${id}`, en: `Test ${id}` },
    description: { en: `synthetic profile ${id}` },
    model: { modelKey: 'synthetic/test-model', family: 'test' },
    task: { type: 'quick-chat' },
    runtime: { contextLength: 8192, gpuOffload: 'max' },
    generation: { temperature: 0.7 },
    behavior: { mode: 'exclusive', rollback: 'best-effort' },
    metadata: { createdAt: NOW, updatedAt: NOW },
    ...overrides,
  };
}

export const ALPHA = makeProfile('alpha');
export const BETA = makeProfile('beta', { runtime: { contextLength: 4096 } });

export function makeEstimate(modelKey = 'synthetic/test-model', overrides: Partial<LoadEstimate> = {}): LoadEstimate {
  return {
    schemaVersion: 1,
    provider: 'rough',
    modelKey,
    vramTotalBytes: 4_000_000_000,
    systemRamBytes: 1_000_000_000,
    estimatedAt: NOW,
    warnings: [],
    ...overrides,
  };
}

export interface Faults {
  getActive?: Error;
  readback?: Error;
  unload?: Error;
  load?: Error;
  health?: Error;
  restore?: Error;
  diagnostics?: Error;
}

export interface FakeRuntimeOptions {
  active: ActiveState | null;
  /** Effective-config readback; used for idempotency comparison. */
  readback: Record<string, unknown>;
  faults?: Faults;
  diagnostics?: Record<string, unknown>;
  /** load() never resolves (drives timeout/cancel race tests). */
  hangLoad?: boolean;
}

export interface FakeRuntime extends ActivationRuntime {
  calls: string[];
}

export function makeRuntime(options: Partial<FakeRuntimeOptions> = {}): FakeRuntime {
  const opts: FakeRuntimeOptions = {
    active: null,
    readback: {},
    ...options,
  };
  const calls: string[] = [];
  return {
    calls,
    async getActiveState(): Promise<ActiveState> {
      calls.push('getActiveState');
      if (opts.faults?.getActive !== undefined) throw opts.faults.getActive;
      return opts.active ?? { profileId: null, modelKey: null, since: null };
    },
    async unload(): Promise<void> {
      calls.push('unload');
      if (opts.faults?.unload !== undefined) throw opts.faults.unload;
    },
    async restore(): Promise<void> {
      calls.push('restore');
      if (opts.faults?.restore !== undefined) throw opts.faults.restore;
    },
    async load(profile: CompositeProfile): Promise<Record<string, unknown>> {
      calls.push(`load:${profile.id}`);
      if (opts.faults?.load !== undefined) throw opts.faults.load;
      if (opts.hangLoad === true) return new Promise<Record<string, unknown>>(() => undefined);
      return opts.readback;
    },
    async healthCheck(): Promise<void> {
      calls.push('healthCheck');
      if (opts.faults?.health !== undefined) throw opts.faults.health;
    },
    async collectDiagnostics(): Promise<Record<string, unknown>> {
      calls.push('collectDiagnostics');
      if (opts.faults?.diagnostics !== undefined) throw opts.faults.diagnostics;
      return opts.diagnostics ?? { status: 'ok' };
    },
    async readEffectiveConfig(): Promise<Record<string, unknown>> {
      calls.push('readEffectiveConfig');
      if (opts.faults?.readback !== undefined) throw opts.faults.readback;
      return opts.readback;
    },
  };
}

/** Lock whose acquire outcome is scriptable (lock-busy and lock-fault tests). */
export function makeLock(acquireResult: boolean | Error = true): ActivationLock {
  return {
    acquire: async (): Promise<boolean> => {
      if (acquireResult instanceof Error) throw acquireResult;
      return acquireResult;
    },
    release: async (): Promise<void> => undefined,
  };
}

export interface EstimatePortOptions {
  estimate?: LoadEstimate;
  fault?: Error;
  /** estimate() never resolves (timeout race). */
  hang?: boolean;
}

export function makeEstimatePort(options: EstimatePortOptions = {}): EstimatePort {
  return {
    async estimate(): Promise<LoadEstimate> {
      if (options.fault !== undefined) throw options.fault;
      if (options.hang === true) return new Promise<LoadEstimate>(() => undefined);
      return options.estimate ?? makeEstimate();
    },
  };
}

export interface MemoryLog {
  written: ActivationTransaction[];
  sink: TransactionLogSink;
}

export function makeLog(): MemoryLog {
  const written: ActivationTransaction[] = [];
  return {
    written,
    sink: { write: async (tx) => void written.push(tx) },
  };
}

export interface WaitControl {
  /**
   * 'never' keeps any active wait pending until its signal aborts (the default;
   * actions win every race). 'resolve' resolves waits immediately, which forces
   * the timeout branch of `runWithGuards` for the racing action.
   */
  mode: 'never' | 'resolve';
}

export function makeContext(control?: WaitControl): RunnerContext {
  const waitControl: WaitControl = control ?? { mode: 'never' };
  let id = 0;
  return {
    now: () => NOW,
    defaultStageTimeoutMs: 0,
    createTxId: () => `tx-${(id += 1)}`,
    wait: (ms: number, signal?: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        if (waitControl.mode === 'resolve') {
          resolve();
          return;
        }
        if (signal !== undefined) {
          if (signal.aborted) {
            reject(new ActivationError('ACTIVATION_CANCELED', 'cancelled', { stage: undefined }));
            return;
          }
          signal.addEventListener(
            'abort',
            () => reject(new ActivationError('ACTIVATION_CANCELED', 'cancelled', { stage: undefined })),
            { once: true },
          );
        }
        // 'never': stay pending; the staged action resolves the race instead.
      }),
  };
}