import { describe, expect, it } from 'vitest';
import type { ActivationTransaction } from '@lmps/domain';
import { createActivationRunner, isActivationError } from '@lmps/core';

import { ALPHA, BETA, NOW, WaitControl, makeContext, makeEstimatePort, makeLock, makeLog, makeProfile, makeRuntime } from './fixtures';

function harness(overrides: {
  runtime?: ReturnType<typeof makeRuntime>;
  lock?: ReturnType<typeof makeLock>;
  estimate?: ReturnType<typeof makeEstimatePort>;
  wait?: WaitControl;
} = {}) {
  const control = overrides.wait ?? { mode: 'never' as const };
  const runtime = overrides.runtime ?? makeRuntime();
  const lock = overrides.lock ?? makeLock();
  const estimate = overrides.estimate ?? makeEstimatePort();
  const log = makeLog();
  const runner = createActivationRunner(makeContext(control), { runtime, lock, estimate, log: log.sink });
  return { runner, runtime, lock, estimate, log, control };
}

/** Every produced transaction must satisfy the locked domain contract. */
function expectValidTransaction(tx: ActivationTransaction): ActivationTransaction {
  expect(tx.schemaVersion).toBe(2);
  expect(tx.targetProfileId).toBeTruthy();
  expect(tx.startedAt).toBe(NOW);
  expect(tx.stages[0]?.name).toBe('idle');
  return tx;
}

describe('activation runner happy path', () => {
  it('runs every stage in order and reports active', async () => {
    const h = harness();
    const result = await h.runner.run(ALPHA);

    expect(result.outcome).toEqual({ status: 'active', alreadyActive: false });
    expectValidTransaction(result.transaction);
    expect(result.transaction.status).toBe('active');
    expect(result.transaction.stages.map((s) => s.name)).toEqual([
      'idle',
      'validating',
      'estimating',
      'unloading-conflicts',
      'loading',
      'health-checking',
    ]);
    expect(result.transaction.errors).toEqual([]);
    // exclusive mode unloaded; the estimator saw the target profile.
    expect(h.runtime.calls).toContain('getActiveState');
    expect(h.runtime.calls).toContain('unload');
    expect(h.runtime.calls.filter((c) => c.startsWith('load:'))).toEqual(['load:alpha']);
    expect(h.runtime.calls).toContain('healthCheck');
    expect(h.log.written).toHaveLength(1);
  });

  it('skips unloading when the behavior mode is coexist', async () => {
    const h = harness();
    const coexist = makeProfile('alpha', { behavior: { mode: 'coexist' } });
    const result = await h.runner.run(coexist);

    expect(result.outcome.status).toBe('active');
    expect(h.runtime.calls).not.toContain('unload');
    expect(result.transaction.stages.map((s) => s.name)).toEqual([
      'idle',
      'validating',
      'estimating',
      'loading',
      'health-checking',
    ]);
  });

  it('flushes exactly one redacted transaction record to the log', async () => {
    const h = harness();
    await h.runner.run(ALPHA);
    expect(h.log.written).toHaveLength(1);
    expect(h.log.written[0]?.status).toBe('active');
  });
});

describe('activation runner idempotency', () => {
  it('short-circuits when the target is already active and the readback matches', async () => {
    const h = harness({
      runtime: makeRuntime({
        active: { profileId: 'alpha', modelKey: 'synthetic/test-model', since: NOW },
        readback: { runtime: { contextLength: 8192, gpuOffload: 'max' } },
      }),
    });
    const result = await h.runner.run(ALPHA);

    expect(result.outcome).toEqual({ status: 'active', alreadyActive: true });
    expect(h.runtime.calls).not.toContain('unload');
    expect(h.runtime.calls.filter((c) => c.startsWith('load:'))).toEqual([]);
    expect(result.transaction.stages.map((s) => s.name)).toEqual(['idle', 'validating']);
    expect(h.log.written).toHaveLength(1);
  });

  it('falls through to a real switch when the readback mismatch', async () => {
    const h = harness({
      runtime: makeRuntime({
        active: { profileId: 'alpha', modelKey: 'synthetic/test-model', since: NOW },
        readback: { runtime: { contextLength: 2048 } },
      }),
    });
    const result = await h.runner.run(ALPHA);
    expect(result.outcome.alreadyActive).toBe(false);
    expect(result.outcome.status).toBe('active');
  });

  it('falls through when the active state read fails (best-effort idempotency)', async () => {
    const h = harness({
      runtime: makeRuntime({
        active: { profileId: 'alpha', modelKey: 'x', since: NOW },
        faults: { readback: new Error('offline') },
      }),
    });
    const result = await h.runner.run(ALPHA);
    expect(result.outcome.status).toBe('active');
    expect(result.outcome.alreadyActive).toBe(false);
  });
});

describe('activation runner failure and rollback', () => {
  it('restores the previous profile when estimate fails (best-effort rollback → recovered)', async () => {
    const h = harness({
      runtime: makeRuntime({ active: { profileId: 'beta', modelKey: 'm', since: NOW } }),
      estimate: makeEstimatePort({ fault: new Error('vram estimate failed') }),
    });
    const result = await h.runner.run(BETA);

    expect(result.outcome.status).toBe('failed-but-recovered');
    expectValidTransaction(result.transaction);
    expect(h.runtime.calls).toContain('collectDiagnostics');
    expect(h.runtime.calls).toContain('unload'); // cleaning-failed-instance
    expect(h.runtime.calls).toContain('restore'); // restoring-previous-profile
    expect(result.transaction.status).toBe('failed-but-recovered');
    expect(result.transaction.previousProfileId).toBe('beta');
    const estimateStage = result.transaction.stages.find((s) => s.name === 'estimating');
    expect(estimateStage?.outcome).toBe('failed');
    expect(result.transaction.errors.map((e) => e.code)).toContain('ACTIVATION_STEP_FAILED');
  });

  it.each([
    ['unload', 'unloading-conflicts'],
    ['load', 'loading'],
    ['health', 'health-checking'],
  ])('recovers when the %s step fails', async (faultKey, stageName) => {
    const h = harness({
      runtime: makeRuntime({
        active: { profileId: 'beta', modelKey: 'm', since: NOW },
        faults: { [faultKey]: new Error(`${faultKey} exploded`) } as never,
      }),
    });
    const result = await h.runner.run(ALPHA);

    expect(result.outcome.status).toBe('failed-but-recovered');
    const failedStage = result.transaction.stages.find((s) => s.name === stageName);
    expect(failedStage?.outcome).toBe('failed');
    expect(h.runtime.calls).toContain('restore');
  });

  it('marks the transaction failed (5) when restoration itself fails', async () => {
    const h = harness({
      runtime: makeRuntime({
        active: { profileId: 'beta', modelKey: 'm', since: NOW },
        faults: { restore: new Error('cannot reload previous profile') },
      }),
      estimate: makeEstimatePort({ fault: new Error('estimate failed') }),
    });
    const result = await h.runner.run(ALPHA);

    expect(result.outcome.status).toBe('failed');
    expect(result.transaction.status).toBe('failed');
    expect(h.runtime.calls).toContain('restore');
  });

  it('does not attempt restoration when rollback is disabled (→ failed)', async () => {
    const h = harness({
      runtime: makeRuntime({ active: { profileId: 'beta', modelKey: 'm', since: NOW } }),
      estimate: makeEstimatePort({ fault: new Error('estimate failed') }),
    });
    const noRollback = makeProfile('alpha', { behavior: { mode: 'exclusive', rollback: 'disabled' } });
    const result = await h.runner.run(noRollback);

    expect(result.outcome.status).toBe('failed');
    expect(h.runtime.calls).not.toContain('restore');
    expect(result.transaction.errors.map((e) => e.code)).toContain('ACTIVATION_ROLLBACK_FAILED');
  });

  it('keeps best-effort cleanup failures from changing a recovered outcome', async () => {
    const h = harness({
      runtime: makeRuntime({
        active: { profileId: 'beta', modelKey: 'm', since: NOW },
        faults: { diagnostics: new Error('disk full') },
      }),
      estimate: makeEstimatePort({ fault: new Error('estimate failed') }),
    });
    const result = await h.runner.run(ALPHA);
    expect(result.outcome.status).toBe('failed-but-recovered');
  });
});

describe('activation runner cancellation (exit 2)', () => {
  it('reports canceled when cancelled before any stage runs, still cleaning up', async () => {
    const abort = new AbortController();
    abort.abort();
    const h = harness();
    const result = await h.runner.run(ALPHA, { signal: abort.signal });

    expect(result.outcome.status).toBe('canceled');
    expectValidTransaction(result.transaction);
    expect(result.transaction.status).toBe('canceled');
    // Best-effort clean-up still ran despite the cancellation.
    expect(h.runtime.calls).toContain('unload');
    expect(h.runtime.calls).toContain('restore');
  });

  it('reports canceled when cancelled mid-load', async () => {
    const abort = new AbortController();
    const h = harness({
      runtime: makeRuntime({
        active: { profileId: 'beta', modelKey: 'm', since: NOW },
        hangLoad: true,
        // restore/wait must interrupt on abort; the fake wait rejects on abort.
      }),
    });
    // stageTimeoutMs bounds the wait so the abort can interrupt the hanging load
    // (with --timeout 0 a mid-stage Ctrl+C only lands at the next boundary).
    const resultPromise = h.runner.run(ALPHA, { signal: abort.signal, stageTimeoutMs: 50 });
    // Let the runner reach the hanging load stage, then cancel.
    await new Promise((resolve) => setTimeout(resolve, 10));
    abort.abort();
    const result = await resultPromise;

    expect(result.outcome.status).toBe('canceled');
    expect(result.transaction.status).toBe('canceled');
  });

  it('keeps a canceled transaction canceled even when recovery fails', async () => {
    const abort = new AbortController();
    abort.abort();
    const h = harness({
      runtime: makeRuntime({
        active: { profileId: 'beta', modelKey: 'm', since: NOW },
        faults: { restore: new Error('offline') },
      }),
    });
    const result = await h.runner.run(ALPHA, { signal: abort.signal });
    expect(result.outcome.status).toBe('canceled');
    expect(result.transaction.status).toBe('canceled');
  });
});

describe('activation runner stage timeout', () => {
  it('times out a hung estimate stage and recovers to failed-but-recovered', async () => {
    const control: WaitControl = { mode: 'resolve' };
    const h = harness({
      wait: control,
      estimate: makeEstimatePort({ hang: true }),
    });
    const result = await h.runner.run(ALPHA, { stageTimeoutMs: 50 });

    expect(result.outcome.status).toBe('failed-but-recovered');
    const estimateStage = result.transaction.stages.find((s) => s.name === 'estimating');
    expect(estimateStage?.outcome).toBe('timeout');
    expect(result.transaction.errors.map((e) => e.code)).toContain('ACTIVATION_TIMEOUT');
  });

  it('treats a stage timeout as a failed transaction when restore fails', async () => {
    const control: WaitControl = { mode: 'resolve' };
    const h = harness({
      wait: control,
      estimate: makeEstimatePort({ hang: true }),
      runtime: makeRuntime({
        active: { profileId: 'beta', modelKey: 'm', since: NOW },
        faults: { restore: new Error('offline') },
      }),
    });
    const result = await h.runner.run(ALPHA, { stageTimeoutMs: 50 });
    expect(result.outcome.status).toBe('failed');
  });
});

describe('activation runner preflight errors', () => {
  it('rejects a document that fails the strict composite schema', async () => {
    const h = harness();
    const bad = makeProfile('alpha', { runtime: { contextLength: -5 } });
    await expect(h.runner.run(bad)).rejects.toMatchObject({ code: 'ACTIVATION_PREFLIGHT' });
    expect(h.log.written).toHaveLength(0);
  });

  it('rejects when the active state cannot be read', async () => {
    const h = harness({ runtime: makeRuntime({ faults: { getActive: new Error('offline') } }) });
    await expect(h.runner.run(ALPHA)).rejects.toMatchObject({ code: 'ACTIVATION_PREFLIGHT' });
  });

  it('throws LOCK_BUSY when the lock is held', async () => {
    const h = harness({ lock: makeLock(false) });
    const error = await h.runner.run(ALPHA).catch((e: unknown) => e);
    expect(isActivationError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'ACTIVATION_LOCK_BUSY' });
    expect(h.log.written).toHaveLength(0);
  });

  it('wraps a lock-acquisition fault as a preflight error', async () => {
    const h = harness({ lock: makeLock(new Error('io')) });
    await expect(h.runner.run(ALPHA)).rejects.toMatchObject({ code: 'ACTIVATION_PREFLIGHT' });
  });
});

describe('activation runner error hygiene', () => {
  it('never leaks private paths or tokens in recorded error details', async () => {
    const h = harness({
      runtime: makeRuntime({
        active: { profileId: 'beta', modelKey: 'm', since: NOW },
        faults: { load: new Error('failed at C:\\Users\\alice\\.lmps\\profiles\\secret.json') },
      }),
    });
    const result = await h.runner.run(ALPHA);
    const all = JSON.stringify(result.transaction);
    expect(all).not.toContain('C:\\Users\\alice');
    expect(all).not.toContain('/Users/alice');
    // The log copy is independent of the in-memory tx.
    expect(JSON.stringify(h.log.written[0])).not.toContain('C:\\Users');
  });
});