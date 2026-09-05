// `lmps apply` integration tests (M1-005): the command is exercised end-to-end
// through runCli with a stubbed ActivationSeam, so the exit-code mapping, the
// --yes gate, human/JSON rendering and the redacted transaction record are all
// verified without any real LM Studio or filesystem.
import { describe, expect, it } from 'vitest';
import { createActivationRunner, type ActivationRunner, type ActivationRunnerPorts } from '@lmps/core';
import type { CompositeProfile } from '@lmps/domain';

import { runCli } from '../../apps/cli/src/run.ts';
import type { ActivationSeam, CliDeps } from '../../apps/cli/src/seams.ts';
import { envelopeOf, makeCliHarness } from './helpers';
import { ALPHA, BETA, NOW, makeContext, makeEstimatePort, makeLock, makeLog, makeRuntime } from '../core/fixtures';

/** A stubbed seam: real runner over fake ports, or a scripted runner per test. */
function makeSeam(options: {
  runtime?: ReturnType<typeof makeRuntime>;
  lock?: ReturnType<typeof makeLock>;
  estimate?: ReturnType<typeof makeEstimatePort>;
  runner?: ActivationRunner;
} = {}): { seam: ActivationSeam; ports: ActivationRunnerPorts; log: ReturnType<typeof makeLog> } {
  const runtime = options.runtime ?? makeRuntime();
  const lock = options.lock ?? makeLock();
  const estimate = options.estimate ?? makeEstimatePort();
  const log = makeLog();
  const ports: ActivationRunnerPorts = { runtime, lock, estimate, log: log.sink };
  const runner = options.runner ?? createActivationRunner(makeContext(), ports);
  return { seam: { runtime, lock, estimate, log: log.sink, context: makeContext(), runner }, ports, log };
}

/** Swaps the (null by default) activation seam on an already-built harness. */
function depsWithSeam(deps: CliDeps, seam: ActivationSeam): CliDeps {
  return { ...deps, activation: seam };
}

describe('apply without wiring', () => {
  it('reports capability unsupported when the production seam is null', async () => {
    const { deps } = makeCliHarness(); // activation: null by default
    const result = await runCli(['apply', 'alpha', '--yes'], deps);
    expect(result.exitCode).toBe(6);
    expect(result.stderr).toContain('does not support: apply');
    expect(result.text).toBe('');
  });
});

describe('apply with a stubbed seam', () => {
  it('activates a profile with --yes (human) and exits 0', async () => {
    const { deps, store } = makeCliHarness();
    store.create(ALPHA);
    const { seam } = makeSeam();
    const result = await runCli(['apply', 'alpha', '--yes'], depsWithSeam(deps, seam));

    expect(result.exitCode).toBe(0);
    expect(result.text).toContain('Activated alpha');
    expect(result.stderr).toBe('');
  });

  it('records the transaction as the machine data (JSON)', async () => {
    const { deps, store } = makeCliHarness();
    store.create(BETA);
    const { seam } = makeSeam();
    const result = await runCli(['--json', 'apply', 'beta', '--yes'], depsWithSeam(deps, seam));

    expect(result.exitCode).toBe(0);
    const envelope = envelopeOf(result.text);
    expect(envelope.command).toBe('apply');
    expect(envelope.data).toBeTruthy();
    const transaction = (envelope.data as { transaction: { status: string; targetProfileId: string } }).transaction;
    expect(transaction.status).toBe('active');
    expect(transaction.targetProfileId).toBe('beta');
  });

  it('is idempotent when the target is already the active profile', async () => {
    const { deps, store } = makeCliHarness();
    store.create(ALPHA);
    const { seam } = makeSeam({
      runtime: makeRuntime({
        active: { profileId: 'alpha', modelKey: 'synthetic/test-model', since: NOW },
        // readback matches ALPHA.runtime → the idle short-circuit fires.
        readback: { runtime: { contextLength: 8192, gpuOffload: 'max' } },
      }),
    });
    const result = await runCli(['apply', 'alpha'], depsWithSeam(deps, seam));

    expect(result.exitCode).toBe(0);
    expect(result.text).toContain('alpha is already the active profile');
  });

  it('refuses to switch without --yes when the target differs from the active profile', async () => {
    const { deps, store } = makeCliHarness();
    store.create(ALPHA);
    const { seam, log } = makeSeam({
      runtime: makeRuntime({ active: { profileId: 'beta', modelKey: 'm', since: NOW } }),
    });
    const result = await runCli(['apply', 'alpha'], depsWithSeam(deps, seam));

    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain('Switching profiles requires --yes');
    // No transaction ran — the gate fired before the runner.
    expect(log.written).toHaveLength(0);
  });

  it('reports a missing profile as a preflight error (exit 4)', async () => {
    const { deps } = makeCliHarness();
    const { seam } = makeSeam();
    const result = await runCli(['apply', 'nope', '--yes'], depsWithSeam(deps, seam));
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain('Profile not found');
  });

  it('maps a lock-busy activation to exit 4', async () => {
    const { deps, store } = makeCliHarness();
    store.create(ALPHA);
    const { seam } = makeSeam({ lock: makeLock(false) });
    const result = await runCli(['apply', 'alpha', '--yes'], depsWithSeam(deps, seam));

    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain('in progress');
    expect(result.text).toBe('');
  });

  it('maps a failed-but-recovered transaction to exit 3', async () => {
    const { deps, store } = makeCliHarness();
    store.create(ALPHA);
    const { seam } = makeSeam({
      estimate: makeEstimatePort({ fault: new Error('estimate boom') }),
      runtime: makeRuntime({ active: { profileId: 'beta', modelKey: 'm', since: NOW } }),
    });
    const result = await runCli(['apply', 'alpha', '--yes'], depsWithSeam(deps, seam));

    expect(result.exitCode).toBe(3);
    expect(result.text).toContain('previous profile beta was restored');
  });

  it('maps a failed transaction (rollback failed too) to exit 5', async () => {
    const { deps, store } = makeCliHarness();
    store.create(ALPHA);
    const { seam } = makeSeam({
      estimate: makeEstimatePort({ fault: new Error('estimate boom') }),
      runtime: makeRuntime({
        active: { profileId: 'beta', modelKey: 'm', since: NOW },
        faults: { restore: new Error('restore boom') },
      }),
    });
    const result = await runCli(['apply', 'alpha', '--yes'], depsWithSeam(deps, seam));

    expect(result.exitCode).toBe(5);
    expect(result.text).toContain('Activation and rollback both failed');
  });

  it('maps a cancelled transaction to exit 2', async () => {
    const { deps, store } = makeCliHarness();
    store.create(ALPHA);
    const abort = new AbortController();
    abort.abort();
    const { seam } = makeSeam();
    const result = await runCli(['apply', 'alpha', '--yes'], depsWithSeam(deps, seam), abort.signal);

    expect(result.exitCode).toBe(2);
    expect(result.text).toContain('Activation cancelled');
  });

  it('propagates --timeout into the runner stage timeout', async () => {
    const { deps, store } = makeCliHarness();
    store.create(ALPHA);
    let seenTimeout: number | null | undefined;
    const scripted: ActivationRunner = {
      run: async (profile: CompositeProfile, options) => {
        seenTimeout = options?.stageTimeoutMs;
        const base = makeSeam();
        return base.seam.runner.run(profile, options);
      },
    };
    const { seam } = makeSeam({ runner: scripted });
    const result = await runCli(['apply', 'alpha', '--yes', '--timeout', '1234'], depsWithSeam(deps, seam));

    expect(result.exitCode).toBe(0);
    expect(seenTimeout).toBe(1234);
  });
});