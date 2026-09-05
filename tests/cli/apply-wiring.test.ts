/**
 * M1-005 production wiring tests: the `apply` activation seam assembled in
 * `deps.ts`. Covers the mock-selection end-to-end path through the FULL CLI
 * (exit 0 active outcome, redacted transactions.ndjson with the token absent,
 * file lock released), the production-default offline path (auto → LM_UNREACHABLE
 * exit 4, no transaction written), and `createDefaultDeps` against a real temp
 * directory (the actual production assembly — real Fsys, real store, real lock
 * and log files). No sockets or child processes: the adapter env is the fake.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { clearProbeCache, type LmStudioEnv } from '@lmps/lmstudio-adapter';
import { createProfileStore } from '@lmps/profile-store';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createActivationSeam, createDefaultDeps } from '../../apps/cli/src/deps.ts';
import { runCli } from '../../apps/cli/src/run.ts';
import { makeCliHarness, envelopeOf, CLI_ROOT } from './helpers';
import { makeFakeEnv } from '../lmstudio-adapter/fixtures';
import { BACKUP_DIR, FakeFs, makeClock, PROFILE_DIR } from '../profile-store/fixtures';
import { makeProfile } from '../core/fixtures';

const QWEN_KEY = 'qwen2.5-7b-instruct-q4_k_m.gguf';

function unreachableHttp(): LmStudioEnv['http'] {
  return async () => {
    throw new TypeError('fetch failed');
  };
}

/** Store on a virtual fs seeded with one profile matching the target model. */
function seededStore(fs: FakeFs): ReturnType<typeof createProfileStore> {
  const store = createProfileStore({ fs, now: makeClock(), profileDir: PROFILE_DIR, backupDir: BACKUP_DIR });
  store.create(makeProfile('alpha', { model: { modelKey: QWEN_KEY, family: 'qwen2' } }));
  return store;
}

/**
 * A harness whose store shares the seam's file system. `makeCliHarness` builds
 * its own store/fs by default; the activation seam and the profile store must
 * sit on the same virtual disk for a run to find its profile and write its log.
 */
function harnessWithSeam(fs: FakeFs, seam: ReturnType<typeof createActivationSeam>): ReturnType<typeof makeCliHarness> {
  const store = seededStore(fs);
  return makeCliHarness({ store, activation: seam });
}

/** A scratch dir on the real disk for the `createDefaultDeps` integration path. */
function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'lmps-apply-wiring-'));
}

describe('Activation seam wiring (M1-005)', () => {
  /** The probe TTL cache is global; a unique base URL per test already isolates
   *  results, and the explicit clear keeps mock/auto selections from leaking. */
  beforeEach(() => clearProbeCache());

  it('seam + mock selection: `apply --yes` activates, log is redacted, lock released', async () => {
    const fs = new FakeFs();
    const seam = createActivationSeam(fs, {
      lmEnv: makeFakeEnv({ baseUrl: 'http://127.0.0.1:3401', token: 'sekrit-token' }),
      selection: 'mock',
      rootDir: CLI_ROOT,
      owner: 'test-owner',
    });
    const { deps } = harnessWithSeam(fs, seam);

    const result = await runCli(['apply', 'alpha', '--yes'], deps);
    expect(result.exitCode).toBe(0);

    const logPath = `${CLI_ROOT}/logs/transactions.ndjson`;
    expect(fs.exists(logPath)).toBe(true);
    const logText = fs.readFileUtf8(logPath);
    const tx = JSON.parse(logText) as { status: string; targetProfileId: string };
    expect(tx.status).toBe('active');
    expect(tx.targetProfileId).toBe('alpha');
    // Runner redacts; the seam must never persist the authorization secret.
    expect(logText).not.toContain('sekrit-token');
    expect(logText).not.toContain(CLI_ROOT);
    // The lock is acquired for the run and released on completion.
    expect(fs.exists(`${CLI_ROOT}/locks/activation.lock`)).toBe(false);
  });

  it('seam machine envelope: `apply --yes` reports the active transaction', async () => {
    const fs = new FakeFs();
    const seam = createActivationSeam(fs, {
      lmEnv: makeFakeEnv({ baseUrl: 'http://127.0.0.1:3402' }),
      selection: 'mock',
      rootDir: CLI_ROOT,
      owner: 'test-owner',
    });
    const { deps } = harnessWithSeam(fs, seam);

    const json = await runCli(['--json', 'apply', 'alpha', '--yes'], deps);
    const envelope = envelopeOf(json.text);
    expect(envelope.ok).toBe(true);
    const tx = (envelope.data as { transaction: { status: string; targetProfileId: string } }).transaction;
    expect(tx.status).toBe('active');
    expect(tx.targetProfileId).toBe('alpha');
  });

  it('seam, offline default: LM_UNREACHABLE exit 4 at preflight, no transaction logged', async () => {
    const fs = new FakeFs();
    const seam = createActivationSeam(fs, {
      lmEnv: makeFakeEnv({ baseUrl: 'http://127.0.0.1:3403', httpHandler: unreachableHttp() }),
      rootDir: CLI_ROOT,
      owner: 'test-owner',
    });
    const { deps } = harnessWithSeam(fs, seam);

    const human = await runCli(['apply', 'alpha', '--yes'], deps);
    expect(human.exitCode).toBe(4);
    expect(human.stderr).toContain('Cannot reach LM Studio');

    const json = await runCli(['--json', 'apply', 'alpha', '--yes'], deps);
    const envelope = envelopeOf(json.text);
    expect(envelope.ok).toBe(false);
    expect(envelope.error?.code).toBe('LM_UNREACHABLE');

    // The failure happens in preflight, before the runner's first stage.
    expect(fs.exists(`${CLI_ROOT}/logs/transactions.ndjson`)).toBe(false);
  });
});

describe('createDefaultDeps production wiring (M1-005)', () => {
  beforeEach(() => clearProbeCache());

  it('is wired by default and activates a stored profile against the mock under LMPS_ADAPTER=mock', async () => {
    const rootDir = tempRoot();
    try {
      const deps = createDefaultDeps({
        rootDir,
        env: { LMPS_ADAPTER: 'mock' },
        lmEnv: makeFakeEnv({ baseUrl: 'http://127.0.0.1:3411', token: 'sekrit-token' }),
      });
      deps.store.create(makeProfile('alpha', { model: { modelKey: QWEN_KEY, family: 'qwen2' } }));

      const result = await runCli(['apply', 'alpha', '--yes'], deps);
      expect(result.exitCode).toBe(0);

      const logPath = join(rootDir, 'logs', 'transactions.ndjson');
      expect(existsSync(logPath)).toBe(true);
      const logText = readFileSync(logPath, 'utf8');
      const tx = JSON.parse(logText.split('\n')[0] as string) as {
        status: string;
        targetProfileId: string;
      };
      expect(tx.status).toBe('active');
      expect(tx.targetProfileId).toBe('alpha');
      // No token, no private local paths reach the on-disk log.
      expect(logText).not.toContain('sekrit-token');
      expect(logText).not.toContain(rootDir);
      // The lease-bearing lock file exists only while the run holds it.
      expect(existsSync(join(rootDir, 'locks', 'activation.lock'))).toBe(false);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('lays the activation seam down as non-null without LMPS_ADAPTER', () => {
    const rootDir = tempRoot();
    try {
      const deps = createDefaultDeps({
        rootDir,
        env: {},
        lmEnv: makeFakeEnv({ baseUrl: 'http://127.0.0.1:3412' }),
      });
      expect(deps.activation).not.toBeNull();
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('never silently flips to mock: plain offline defaults to LM_UNREACHABLE exit 4', async () => {
    const rootDir = tempRoot();
    try {
      const deps = createDefaultDeps({
        rootDir,
        env: {},
        lmEnv: makeFakeEnv({ baseUrl: 'http://127.0.0.1:3413', httpHandler: unreachableHttp() }),
      });
      deps.store.create(makeProfile('alpha', { model: { modelKey: QWEN_KEY, family: 'qwen2' } }));

      const result = await runCli(['apply', 'alpha', '--yes'], deps);
      expect(result.exitCode).toBe(4);
      expect(result.stderr).toContain('Cannot reach LM Studio');
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});