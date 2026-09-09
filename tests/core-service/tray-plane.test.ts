// policy-scan:fixture — throwaway 'sekrit-token' fixture; exemption in scripts/lib/policy-scan-exemptions.json
// M3-003 tray/activation plane tests. Every activation RPC plus `tray.menu`
// runs over the REAL createSidecarActivationSeam (same core runner, same
// lease-bearing activation.lock, same redacted log sinks the production wiring
// assembles) with the real mock adapter injected through a fake LmStudioEnv —
// so "the tray and the CLI produce the same transaction behavior" is asserted
// through the real Dispatcher wire contract (result vs {code,message} error).
// The idempotent alreadyActive case uses a hand-built seam (a fake runtime that
// already reports the target profile active) because the demo mock never
// reports a profileId — mirroring the CLI `apply --yes` idempotency loop.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createActivationRunner,
  createFileLock,
  type ActivationLock,
  type RunnerContext,
  type TransactionLogSink,
} from '@lmps/core';
import type { CompositeProfile } from '@lmps/domain';
import { clearProbeCache, type LmStudioEnv } from '@lmps/lmstudio-adapter';

import {
  createHandlers,
  type TrayMenuSpec,
  type TraySpecItem,
} from '../../apps/core-service/src/handlers.ts';
import { Dispatcher, type DispatchResult } from '../../apps/core-service/src/protocol.ts';
import {
  createSidecarActivationSeam,
  type SidecarActivationSeam,
} from '../../apps/core-service/src/wiring.ts';
import { makeEstimatePort, makeProfile, makeRuntime } from '../core/fixtures.ts';
import { makeFakeEnv } from '../lmstudio-adapter/fixtures.ts';
import { createProfileStore, type ProfileStore } from '@lmps/profile-store';
import { FAKE_NOW, FakeFs } from '../profile-store/fixtures.ts';

const ROOT = '/app';
const PROFILE_DIR = `${ROOT}/profiles`;
const BACKUP_DIR = `${ROOT}/backups`;
const CONFIG_PATH = `${ROOT}/config.json`;
const TX_LOG = `${ROOT}/logs/transactions.ndjson`;
const UNLOAD_LOG = `${ROOT}/logs/unloads.ndjson`;
const LOCK_PATH = `${ROOT}/locks/activation.lock`;
const QWEN_KEY = 'qwen2.5-7b-instruct-q4_k_m.gguf';

function unreachableHttp(): LmStudioEnv['http'] {
  return async () => {
    throw new TypeError('fetch failed');
  };
}

function makeStore(fs: FakeFs): ProfileStore {
  return createProfileStore({ fs, now: () => FAKE_NOW, profileDir: PROFILE_DIR, backupDir: BACKUP_DIR });
}

/** A profile the mock (or the seam's matched model) can activate. */
function qwenProfile(id: string, overrides: Partial<CompositeProfile> = {}): CompositeProfile {
  return makeProfile(id, { model: { modelKey: QWEN_KEY, family: 'qwen2' }, ...overrides });
}

let basePort = 3500;

interface Plane {
  fs: FakeFs;
  store: ProfileStore;
  seam: SidecarActivationSeam | null;
  dispatch(method: string, params?: Record<string, unknown>): Promise<DispatchResult>;
}

interface PlaneOptions {
  fs?: FakeFs;
  store?: ProfileStore;
  /** Wire the real activation seam (default). `seam` overrides; false omits it. */
  seam?: SidecarActivationSeam | null;
  activate?: boolean;
  /** Adapter selection; mock (default) drives the deterministic demo adapter. */
  selection?: 'auto' | 'mock';
  /** Injected adapter env (default: plain fake on a unique base URL). */
  lmEnv?: LmStudioEnv;
  /** Token handed to the adapter env (SECRET inside the seam's reach, never logged). */
  token?: string | null;
  /** Seed <rootDir>/config.json with this locale (default: no file → session default). */
  locale?: string | null;
}

function makePlane(options: PlaneOptions = {}): Plane {
  const fs = options.fs ?? new FakeFs();
  const store = options.store ?? makeStore(fs);
  if (options.locale !== undefined && options.locale !== null) {
    fs.writeFileUtf8(CONFIG_PATH, `${JSON.stringify({ locale: options.locale }, null, 2)}\n`);
  }
  const activation =
    options.seam !== undefined
      ? options.seam
      : options.activate === false
        ? null
        : createSidecarActivationSeam(fs, {
            lmEnv:
              options.lmEnv ??
              makeFakeEnv({ baseUrl: `http://127.0.0.1:${basePort++}`, token: options.token ?? null }),
            selection: options.selection ?? 'mock',
            rootDir: ROOT,
            owner: 'sidecar',
            now: () => FAKE_NOW,
          });
  const handlers = createHandlers({
    lmBaseUrl: undefined,
    lmToken: options.token ?? null,
    lmsBin: undefined,
    rootDir: ROOT,
    store,
    activation,
    // Same virtual disk as the store and the seam: the language store reads
    // <rootDir>/config.json off THIS fs, never the real one.
    fs,
    now: () => FAKE_NOW,
  });
  const dispatcher = new Dispatcher(handlers);
  return {
    fs,
    store,
    seam: activation,
    dispatch: (method, params = {}) =>
      dispatcher.dispatch({ jsonrpc: '2.0', id: 1, method, params }, new AbortController().signal),
  };
}

function applyIdle(menu: TrayMenuSpec): TraySpecItem[] {
  return menu.idle;
}

describe('activation.status (M3-003)', () => {
  beforeEach(() => clearProbeCache());

  it('reports nothing before apply and the loaded model after', async () => {
    const plane = makePlane();
    const before = await plane.dispatch('activation.status');
    expect(before.error).toBeUndefined();
    expect(before.result).toEqual({ active: null });

    plane.store.create(qwenProfile('alpha'));
    const applied = await plane.dispatch('activation.apply', { id: 'alpha' });
    expect(applied.error).toBeUndefined();

    const after = await plane.dispatch('activation.status');
    const active = (
      after.result as { active: { profileId: string | null; modelKey: string | null; since: string | null } | null }
    ).active;
    expect(active).not.toBeNull();
    // The demo mock never reports a profile identity; the model key is the match.
    expect(active?.profileId).toBeNull();
    expect(active?.modelKey).toBe(QWEN_KEY);
  });

  it('reports METHOD_UNSUPPORTED when the seam is not wired', async () => {
    const plane = makePlane({ activate: false });
    const res = await plane.dispatch('activation.status');
    expect(res.error?.code).toBe('METHOD_UNSUPPORTED');
  });
});

describe('activation.apply (M3-003)', () => {
  beforeEach(() => clearProbeCache());

  it('activates through the shared runner and writes a redacted transaction', async () => {
    const plane = makePlane({ token: 'sekrit-token' });
    plane.store.create(qwenProfile('alpha'));

    const res = await plane.dispatch('activation.apply', { id: 'alpha' });
    expect(res.error).toBeUndefined();
    const body = res.result as {
      outcome: string;
      alreadyActive: boolean;
      transaction: { status: string; targetProfileId: string };
    };
    expect(body.outcome).toBe('active');
    expect(body.alreadyActive).toBe(false);
    expect(body.transaction.status).toBe('active');
    expect(body.transaction.targetProfileId).toBe('alpha');

    const logText = plane.fs.readFileUtf8(TX_LOG);
    const tx = JSON.parse(logText) as { status: string; targetProfileId: string };
    expect(tx.status).toBe('active');
    expect(tx.targetProfileId).toBe('alpha');
    // Featured remains redacted: no token, no local paths reach the audit log.
    expect(logText).not.toContain('sekrit-token');
    expect(logText).not.toContain(ROOT);
    // The lease-bearing lock is held only for the run.
    expect(plane.fs.exists(LOCK_PATH)).toBe(false);
  });

  it('maps missing and non-string ids to stable store codes', async () => {
    const plane = makePlane();
    const missing = await plane.dispatch('activation.apply', { id: 'nope' });
    expect(missing.error?.code).toBe('STORE_NOT_FOUND');
    const nonString = await plane.dispatch('activation.apply', { id: 42 });
    expect(nonString.error?.code).toBe('STORE_INVALID_ID');
  });

  it('reports ACTIVATION_LOCK_BUSY when the shared lock is held and the menu shows it', async () => {
    const plane = makePlane();
    plane.store.create(qwenProfile('alpha'));
    // A concurrent process holds THE SAME path lock the sidecar acquires.
    expect(await plane.seam?.lock.acquire()).toBe(true);
    let code: string | undefined;
    try {
      const res = await plane.dispatch('activation.apply', { id: 'alpha' });
      code = res.error?.code;
    } finally {
      await plane.seam?.lock.release();
    }
    expect(code).toBe('ACTIVATION_LOCK_BUSY');

    // The failure is remembered for the tray menu's notice row.
    const menu = await plane.dispatch('tray.menu');
    const notice = applyIdle(menu.result as TrayMenuSpec).find((item) => item.id === 'notice');
    expect(notice?.label).toBe('Last action failed: Another operation is running');
  });

  it('already-active targets short-circuit as an idempotent success', async () => {
    const fs = new FakeFs();
    const ctx: RunnerContext = {
      now: () => FAKE_NOW,
      wait: async () => {},
      defaultStageTimeoutMs: 0,
      createTxId: () => 'tx-idem',
    };
    const runtime = makeRuntime({
      active: { profileId: 'alpha', modelKey: QWEN_KEY, since: FAKE_NOW },
      readback: { runtime: { contextLength: 8192, gpuOffload: 'max' } },
    });
    const fileLock = createFileLock(fs, { path: LOCK_PATH, owner: 'sidecar', leaseMs: 30 * 60_000, now: () => FAKE_NOW });
    const lock: ActivationLock = {
      acquire: async () => {
        fs.mkdirRecursive(`${ROOT}/locks`);
        return fileLock.acquire();
      },
      release: () => fileLock.release(),
    };
    const log: TransactionLogSink = {
      write: async (transaction) => {
        fs.mkdirRecursive(`${ROOT}/logs`);
        const prior = fs.exists(TX_LOG) ? fs.readFileUtf8(TX_LOG) : '';
        const line = JSON.stringify(transaction);
        fs.writeFileUtf8(TX_LOG, prior === '' ? line : `${prior}\n${line}`);
      },
    };
    const seam: SidecarActivationSeam = {
      runtime,
      lock,
      estimate: makeEstimatePort(),
      log,
      context: ctx,
      runner: createActivationRunner(ctx, { runtime, lock, estimate: makeEstimatePort(), log }),
      auditUnload: () => {},
    };
    const plane = makePlane({ fs, seam });
    plane.store.create(qwenProfile('alpha'));

    const res = await plane.dispatch('activation.apply', { id: 'alpha' });
    expect(res.error).toBeUndefined();
    const body = res.result as {
      outcome: string;
      alreadyActive: boolean;
      transaction: { status: string };
    };
    expect(body.outcome).toBe('active');
    expect(body.alreadyActive).toBe(true);
    expect(body.transaction.status).toBe('active');

    // The short-circuit must not touch the host again, but the audit row lands.
    const tx = JSON.parse(fs.readFileUtf8(TX_LOG)) as { status: string; targetProfileId: string };
    expect(tx.status).toBe('active');
    expect(tx.targetProfileId).toBe('alpha');
  });

  it('a dead host surfaces LM_UNREACHABLE (CLI parity) and no transaction is written', async () => {
    const plane = makePlane({
      selection: 'auto',
      lmEnv: makeFakeEnv({
        baseUrl: `http://127.0.0.1:${basePort++}`,
        httpHandler: unreachableHttp(),
      }),
    });
    plane.store.create(qwenProfile('alpha'));

    const res = await plane.dispatch('activation.apply', { id: 'alpha' });
    expect(res.error?.code).toBe('LM_UNREACHABLE');
    expect(plane.fs.exists(TX_LOG)).toBe(false);

    // The menu stays usable: a failure notice plus an explicit unreachable row.
    const menu = await plane.dispatch('tray.menu');
    expect(menu.error).toBeUndefined();
    const idle = applyIdle(menu.result as TrayMenuSpec);
    expect(idle.find((item) => item.id === 'notice')?.label).toBe('Last action failed: Cannot reach LM Studio');
    expect(idle.find((item) => item.id === 'status-unreachable')).toBeDefined();
  });

  it('reports METHOD_UNSUPPORTED when the seam is not wired', async () => {
    const plane = makePlane({ activate: false });
    const res = await plane.dispatch('activation.apply', { id: 'alpha' });
    expect(res.error?.code).toBe('METHOD_UNSUPPORTED');
  });
});

describe('activation.unload (M3-003)', () => {
  beforeEach(() => clearProbeCache());

  it('unloads the active configuration and audits a redacted unload row', async () => {
    const plane = makePlane();
    plane.store.create(qwenProfile('alpha'));
    await plane.dispatch('activation.apply', { id: 'alpha' });

    const res = await plane.dispatch('activation.unload');
    expect(res.error).toBeUndefined();
    expect(res.result).toEqual({ profileId: null, modelKey: QWEN_KEY, outcome: 'ok' });

    const row = JSON.parse(plane.fs.readFileUtf8(UNLOAD_LOG)) as {
      profileId: string | null;
      modelKey: string;
      outcome: string;
      at: string;
    };
    expect(row.outcome).toBe('ok');
    expect(row.modelKey).toBe(QWEN_KEY);
    expect(row.at).toBe(FAKE_NOW);

    const status = await plane.dispatch('activation.status');
    expect((status.result as { active: unknown }).active).toBeNull();
    // The lock was released; nothing lingers from the unload path.
    expect(plane.fs.exists(LOCK_PATH)).toBe(false);
  });

  it('nothing active is an idempotent no-op that writes no audit and takes no lock', async () => {
    const plane = makePlane();
    const res = await plane.dispatch('activation.unload');
    expect(res.error).toBeUndefined();
    expect(res.result).toEqual({ profileId: null, modelKey: null, outcome: 'ok' });
    expect(plane.fs.exists(UNLOAD_LOG)).toBe(false);
    expect(plane.fs.exists(LOCK_PATH)).toBe(false);
  });

  it('reports ACTIVATION_LOCK_BUSY when the shared lock is held', async () => {
    const plane = makePlane();
    plane.store.create(qwenProfile('alpha'));
    await plane.dispatch('activation.apply', { id: 'alpha' }); // active, so the unload proceeds past the short-circuit

    expect(await plane.seam?.lock.acquire()).toBe(true);
    let code: string | undefined;
    try {
      const res = await plane.dispatch('activation.unload');
      code = res.error?.code;
    } finally {
      await plane.seam?.lock.release();
    }
    expect(code).toBe('ACTIVATION_LOCK_BUSY');
  });

  it('reports METHOD_UNSUPPORTED when the seam is not wired', async () => {
    const plane = makePlane({ activate: false });
    const res = await plane.dispatch('activation.unload');
    expect(res.error?.code).toBe('METHOD_UNSUPPORTED');
  });
});

describe('tray.menu spec (M3-003)', () => {
  beforeEach(() => clearProbeCache());

  it('renders bilingual labels from the persisted locale', async () => {
    const zh = makePlane({ locale: 'zh-CN' });
    zh.store.create(qwenProfile('alpha'));
    const res = await zh.dispatch('tray.menu');
    expect(res.error).toBeUndefined();
    const spec = res.result as TrayMenuSpec;
    expect(spec.locale).toBe('zh-CN');
    expect(spec.idle.find((item) => item.id === 'status')?.label).toBe('当前：无激活');
    expect(spec.idle.find((item) => item.id === 'unload')?.label).toBe('卸载当前');
    expect(spec.idle.find((item) => item.id === 'quit')?.label).toBe('退出');
    expect(spec.busy.find((item) => item.id === 'status')?.label).toBe('处理中…');

    const en = makePlane({ locale: 'en' });
    en.store.create(qwenProfile('alpha'));
    const enRes = await en.dispatch('tray.menu');
    const enIdle = (enRes.result as TrayMenuSpec).idle;
    expect(enIdle.find((item) => item.id === 'status')?.label).toBe('Current: none');
  });

  it('disables actions in the busy half while keeping open/quit live', async () => {
    const plane = makePlane();
    plane.store.create(qwenProfile('alpha'));
    const spec = (await plane.dispatch('tray.menu')).result as TrayMenuSpec;

    for (const item of spec.idle) {
      if (item.id === 'apply:alpha' || item.id === 'unload') {
        if (item.id === 'apply:alpha') expect(item.disabled).toBe(false);
      } else if (item.id === 'open' || item.id === 'quit') {
        expect(item.disabled).toBeUndefined();
      }
    }
    for (const item of spec.busy) {
      if (item.id.startsWith('apply:') || item.id === 'unload') {
        expect(item.disabled).toBe(true);
      }
      if (item.id === 'open' || item.id === 'quit') {
        expect(item.disabled).toBeUndefined();
      }
    }
    // The busy split is what the shell swaps in locally during a long apply.
    expect(spec.busy.find((item) => item.id === 'status')?.label).toBe('Working…');
  });

  it('recent section is sorted by updatedAt desc, capped at five, the rest under all', async () => {
    const plane = makePlane();
    for (let i = 1; i <= 6; i += 1) {
      const at = `2026-0${i}-01T00:00:00.000Z`; // p1 oldest → p6 newest
      plane.store.create(makeProfile(`p${i}`, { metadata: { createdAt: at, updatedAt: at } }));
    }
    const spec = (await plane.dispatch('tray.menu')).result as TrayMenuSpec;
    const idle = spec.idle;
    const recentIdx = idle.findIndex((item) => item.id === 'section-recent');
    expect(recentIdx).toBeGreaterThanOrEqual(0);
    const afterRecent = idle.slice(recentIdx + 1);
    expect(afterRecent.slice(0, 5).map((item) => item.id)).toEqual([
      'apply:p6',
      'apply:p5',
      'apply:p4',
      'apply:p3',
      'apply:p2',
    ]);
    const allIdx = afterRecent.findIndex((item) => item.id === 'section-all');
    expect(allIdx).toBe(5);
    // The remainder sits under `all` (the action tail is not a profile row).
    expect(
      afterRecent
        .slice(allIdx + 1)
        .filter((item) => item.id.startsWith('apply:'))
        .map((item) => item.id),
    ).toEqual(['apply:p1']);
    // Labels come from the locale, not the raw id.
    expect(idle.find((item) => item.id === 'section-recent')?.label).toBe('Recent profiles');
  });

  it('marks the active profile with a check and enables unload', async () => {
    const plane = makePlane();
    plane.store.create(qwenProfile('alpha'));
    plane.store.create(makeProfile('beta', { model: { modelKey: 'other/model', family: 'other' } }));
    await plane.dispatch('activation.apply', { id: 'alpha' });

    const spec = (await plane.dispatch('tray.menu')).result as TrayMenuSpec;
    const alpha = spec.idle.find((item) => item.id === 'apply:alpha');
    const beta = spec.idle.find((item) => item.id === 'apply:beta');
    expect(alpha?.checked).toBe(true);
    expect(beta?.checked).toBe(false);
    expect(spec.idle.find((item) => item.id === 'unload')?.disabled).toBe(false);
  });

  it('disables unload while nothing is active', async () => {
    const plane = makePlane();
    plane.store.create(qwenProfile('alpha'));
    const spec = (await plane.dispatch('tray.menu')).result as TrayMenuSpec;
    expect(spec.idle.find((item) => item.id === 'unload')?.disabled).toBe(true);
  });

  it('renders without an activation seam (no active state, no error)', async () => {
    const plane = makePlane({ activate: false });
    plane.store.create(qwenProfile('alpha'));
    const res = await plane.dispatch('tray.menu');
    expect(res.error).toBeUndefined();
    const spec = res.result as TrayMenuSpec;
    expect(spec.idle.find((item) => item.id === 'status')?.label).toBe('Current: none');
  });

  it('remembers a failed apply as a notice row', async () => {
    const plane = makePlane();
    const failed = await plane.dispatch('activation.apply', { id: 'nope' });
    expect(failed.error?.code).toBe('STORE_NOT_FOUND');

    const spec = (await plane.dispatch('tray.menu')).result as TrayMenuSpec;
    const notice = spec.idle.find((item) => item.id === 'notice');
    expect(notice).toBeDefined();
    expect(notice?.label).toBe('Last action failed: The activation failed');
  });
});