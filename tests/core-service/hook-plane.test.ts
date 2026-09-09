// M4-001 local hook plane tests. hook.status / hook.rules / hook.switch run over
// the REAL createSidecarHookSeam (strict rule parsing, atomic writes, redacted
// hook audit) and the REAL activation seam (same core runner + same lease-
// bearing activation.lock as activation.apply), with the mock adapter injected
// through a fake LmStudioEnv — so rule resolution, deny-by-default, the shared
// lock and the audit stream are all asserted through the real Dispatcher wire.
// policy-scan:fixture — throwaway 'sekrit-token' fixture; exemption in scripts/lib/policy-scan-exemptions.json
import { beforeEach, describe, expect, it } from 'vitest';
import type { CompositeProfile, HookRulesDocument } from '@lmps/domain';
import { clearProbeCache } from '@lmps/lmstudio-adapter';
import { createProfileStore, type ProfileStore } from '@lmps/profile-store';

import { createHandlers } from '../../apps/core-service/src/handlers.ts';
import { Dispatcher, type DispatchResult } from '../../apps/core-service/src/protocol.ts';
import {
  createHookSeam,
  createSidecarActivationSeam,
  type SidecarActivationSeam,
  type SidecarHookSeam,
} from '../../apps/core-service/src/wiring.ts';
import { makeProfile } from '../core/fixtures.ts';
import { makeFakeEnv } from '../lmstudio-adapter/fixtures.ts';
import { FAKE_NOW, FakeFs } from '../profile-store/fixtures.ts';

const ROOT = '/app';
const PROFILE_DIR = `${ROOT}/profiles`;
const BACKUP_DIR = `${ROOT}/backups`;
const RULES_PATH = `${ROOT}/hooks/rules.json`;
const TOKEN_PATH = `${ROOT}/hooks/token.json`;
const HOOK_LOG = `${ROOT}/logs/hooks.ndjson`;
const LOCK_PATH = `${ROOT}/locks/activation.lock`;
const QWEN_KEY = 'qwen2.5-7b-instruct-q4_k_m.gguf';

/** Rules that map the shared app to the qwen-loadable profile. */
function makeRules(overrides: Partial<HookRulesDocument> = {}): HookRulesDocument {
  return {
    schemaVersion: 2,
    version: '2026.09.test',
    enabled: true,
    rules: [
      {
        id: 'editor-code',
        app: 'editor',
        taskKind: 'coding',
        profileId: 'alpha',
        rationale: { 'zh-CN': '编辑器编码', en: 'Editor coding.' },
      },
    ],
    ...overrides,
  };
}

function qwenProfile(id: string, overrides: Partial<CompositeProfile> = {}): CompositeProfile {
  return makeProfile(id, { model: { modelKey: QWEN_KEY, family: 'qwen2' }, ...overrides });
}

const makeStore = (fs: FakeFs): ProfileStore =>
  createProfileStore({ fs, now: () => FAKE_NOW, profileDir: PROFILE_DIR, backupDir: BACKUP_DIR });

let basePort = 3600;

interface Plane {
  fs: FakeFs;
  store: ProfileStore;
  hook: SidecarHookSeam | null;
  activation: SidecarActivationSeam | null;
  dispatch(method: string, params?: Record<string, unknown>): Promise<DispatchResult>;
}

interface PlaneOptions {
  fs?: FakeFs;
  store?: ProfileStore;
  /** Activation seam; default wires the real one (mock adapter). `null` omits it. */
  activation?: SidecarActivationSeam | null;
  /** Hook seam; default wires the real one. `null` omits it. */
  hook?: SidecarHookSeam | null;
  /** Seed <rootDir>/hooks/rules.json via the real atomic writer. */
  rules?: HookRulesDocument | null;
  /** Seed <rootDir>/hooks/token.json via the real rotate path. */
  hookToken?: string | null;
}

function makePlane(options: PlaneOptions = {}): Plane {
  const fs = options.fs ?? new FakeFs();
  const store = options.store ?? makeStore(fs);
  const hook =
    options.hook !== undefined
      ? options.hook
      : createHookSeam(fs, { rootDir: ROOT });
  if (hook !== null) {
    if (options.rules !== null && options.rules !== undefined) hook.writeRules(options.rules);
    if (options.hookToken !== null && options.hookToken !== undefined) hook.rotateToken(options.hookToken);
  }
  const activation =
    options.activation !== undefined
      ? options.activation
      : createSidecarActivationSeam(fs, {
          lmEnv: makeFakeEnv({ baseUrl: `http://127.0.0.1:${basePort++}`, token: null }),
          selection: 'mock',
          rootDir: ROOT,
          owner: 'sidecar',
          now: () => FAKE_NOW,
        });

  const handlers = createHandlers({
    lmBaseUrl: undefined,
    lmToken: null,
    lmsBin: undefined,
    rootDir: ROOT,
    store,
    activation,
    hook,
    fs,
    now: () => FAKE_NOW,
  });
  const dispatcher = new Dispatcher(handlers);
  return {
    fs,
    store,
    hook,
    activation,
    dispatch: (method, params = {}) =>
      dispatcher.dispatch({ jsonrpc: '2.0', id: 1, method, params }, new AbortController().signal),
  };
}

describe('hook.status (M4-001)', () => {
  beforeEach(() => clearProbeCache());

  it('reports an unconfigured hook without error', async () => {
    const plane = makePlane();
    const res = await plane.dispatch('hook.status');
    expect(res.error).toBeUndefined();
    expect(res.result).toEqual({
      configured: false,
      enabled: false,
      version: null,
      ruleCount: 0,
      tokenStored: false,
      profileIds: [],
    });
  });

  it('reports the rules and store-referenced profile ids when configured', async () => {
    const plane = makePlane({ rules: makeRules(), hookToken: 'sekrit-token' });
    const res = await plane.dispatch('hook.status');
    expect(res.error).toBeUndefined();
    expect(res.result).toEqual({
      configured: true,
      enabled: true,
      version: '2026.09.test',
      ruleCount: 1,
      tokenStored: true,
      profileIds: ['alpha'],
    });
  });

  it('reports METHOD_UNSUPPORTED when the seam is not wired', async () => {
    const plane = makePlane({ hook: null });
    const res = await plane.dispatch('hook.status');
    expect(res.error?.code).toBe('METHOD_UNSUPPORTED');
  });
});

describe('hook.rules (M4-001)', () => {
  beforeEach(() => clearProbeCache());

  it('summarizes a configured document', async () => {
    const plane = makePlane({ rules: makeRules() });
    const res = await plane.dispatch('hook.rules');
    expect(res.error).toBeUndefined();
    const body = res.result as { configured: boolean; enabled: boolean; rules: Array<{ id: string }> };
    expect(body.configured).toBe(true);
    expect(body.enabled).toBe(true);
    expect(body.rules[0]?.id).toBe('editor-code');
  });

  it('returns an empty summary when unconfigured', async () => {
    const plane = makePlane();
    const res = await plane.dispatch('hook.rules');
    expect(res.error).toBeUndefined();
    expect(res.result).toEqual({ configured: false, version: null, enabled: false, rules: [] });
  });
});

describe('hook.switch (M4-001)', () => {
  beforeEach(() => clearProbeCache());

  it('activates the mapped profile through the shared runner and audits the allowed row', async () => {
    const plane = makePlane({ rules: makeRules(), hookToken: 'sekrit-token' });
    plane.store.create(qwenProfile('alpha'));

    const res = await plane.dispatch('hook.switch', { app: 'editor', taskKind: 'coding' });
    expect(res.error).toBeUndefined();
    const body = res.result as {
      outcome: string;
      alreadyActive: boolean;
      profileId: string;
      ruleId: string;
      transaction: { status: string };
    };
    expect(body.outcome).toBe('active');
    expect(body.alreadyActive).toBe(false);
    expect(body.profileId).toBe('alpha');
    expect(body.ruleId).toBe('editor-code');
    expect(body.transaction.status).toBe('active');

    // One audit row, redacted: no token, no local paths, rule + tx + profile ids.
    const row = JSON.parse(plane.fs.readFileUtf8(HOOK_LOG)) as {
      outcome: string;
      app: string;
      taskKind: string | null;
      ruleId?: string;
      profileId?: string;
      transactionId?: string;
    };
    expect(row.outcome).toBe('active');
    expect(row.app).toBe('editor');
    expect(row.taskKind).toBe('coding');
    expect(row.ruleId).toBe('editor-code');
    expect(row.profileId).toBe('alpha');
    expect(row.transactionId).toBeDefined();
    const logText = plane.fs.readFileUtf8(HOOK_LOG);
    expect(logText).not.toContain('sekrit-token');
    expect(logText).not.toContain(ROOT);
    // The lease-bearing lock is not left behind.
    expect(plane.fs.exists(LOCK_PATH)).toBe(false);
  });

  it('audits a denied call and refuses with HOOK_DENIED (no rule for this app/task)', async () => {
    const plane = makePlane({ rules: makeRules() });
    const res = await plane.dispatch('hook.switch', { app: 'vscode' });
    expect(res.error?.code).toBe('HOOK_DENIED');
    expect(plane.fs.exists(HOOK_LOG)).toBe(true);
    expect(
      JSON.parse(plane.fs.readFileUtf8(HOOK_LOG)) as { outcome: string; app: string },
    ).toEqual({ at: FAKE_NOW, outcome: 'denied', app: 'vscode', taskKind: null });
  });

  it('refuses with HOOK_DISABLED when the global switch is off and audits it', async () => {
    const plane = makePlane({ rules: makeRules({ enabled: false }) });
    const res = await plane.dispatch('hook.switch', { app: 'editor', taskKind: 'coding' });
    expect(res.error?.code).toBe('HOOK_DISABLED');
    expect(
      JSON.parse(plane.fs.readFileUtf8(HOOK_LOG)) as { outcome: string },
    ).toMatchObject({ outcome: 'disabled' });
  });

  it('refuses with HOOK_UNCONFIGURED when no rules document exists', async () => {
    const plane = makePlane();
    const res = await plane.dispatch('hook.switch', { app: 'editor' });
    expect(res.error?.code).toBe('HOOK_UNCONFIGURED');
  });

  it('refuses a request without an app as HOOK_INVALID_REQUEST', async () => {
    const plane = makePlane({ rules: makeRules() });
    const res = await plane.dispatch('hook.switch', {});
    expect(res.error?.code).toBe('HOOK_INVALID_REQUEST');
    expect(plane.fs.exists(HOOK_LOG)).toBe(false);
  });

  it('resolves profile existence through the store (missing profile → STORE_NOT_FOUND)', async () => {
    const plane = makePlane({ rules: makeRules() }); // 'alpha' has no store profile
    const res = await plane.dispatch('hook.switch', { app: 'editor', taskKind: 'coding' });
    expect(res.error?.code).toBe('STORE_NOT_FOUND');
  });

  it('reports ACTIVATION_LOCK_BUSY when the shared lock is held (global mutual exclusion)', async () => {
    const plane = makePlane({ rules: makeRules() });
    plane.store.create(qwenProfile('alpha'));
    // A concurrent process holds THE SAME path lock the sidecar acquires.
    expect(await plane.activation?.lock.acquire()).toBe(true);
    let code: string | undefined;
    try {
      const res = await plane.dispatch('hook.switch', { app: 'editor', taskKind: 'coding' });
      code = res.error?.code;
    } finally {
      await plane.activation?.lock.release();
    }
    expect(code).toBe('ACTIVATION_LOCK_BUSY');
  });

  it('maps a hand-edited non-conforming rules file to HOOK_RULES_INVALID', async () => {
    const fs = new FakeFs();
    fs.mkdirRecursive(`${ROOT}/hooks`);
    // Hand-edited breakage: `enabled` missing makes the document non-conforming.
    fs.writeFileUtf8(RULES_PATH, `${JSON.stringify({ schemaVersion: 2, version: 'x', rules: [] })}\n`);
    const plane = makePlane({ fs });
    const res = await plane.dispatch('hook.switch', { app: 'editor' });
    expect(res.error?.code).toBe('HOOK_RULES_INVALID');
  });

  it('reports METHOD_UNSUPPORTED when the hook seam is not wired', async () => {
    const plane = makePlane({ hook: null });
    const res = await plane.dispatch('hook.switch', { app: 'editor' });
    expect(res.error?.code).toBe('METHOD_UNSUPPORTED');
  });
});

describe('hook seam token + address io (M4-001)', () => {
  it('readOrCreateToken persists on first use and keeps the stored value after', () => {
    const fs = new FakeFs();
    const seam = createHookSeam(fs, { rootDir: ROOT });
    expect(seam.readToken()).toBeNull();
    expect(seam.readOrCreateToken('generated-one')).toBe('generated-one');
    expect(seam.readToken()).toBe('generated-one');
    // A second mint must not clobber the persisted token.
    expect(seam.readOrCreateToken('generated-two')).toBe('generated-one');
    expect(fs.exists(TOKEN_PATH)).toBe(true);
  });

  it('rotateToken replaces the stored value without leaking the root path', () => {
    const fs = new FakeFs();
    const seam = createHookSeam(fs, { rootDir: ROOT });
    seam.rotateToken('first');
    expect(seam.readToken()).toBe('first');
    seam.rotateToken('second');
    expect(seam.readToken()).toBe('second');
    expect(fs.readFileUtf8(TOKEN_PATH)).not.toContain(ROOT);
  });

  it('writeAddress/readAddress round-trip the loopback rendezvous', () => {
    const fs = new FakeFs();
    const seam = createHookSeam(fs, { rootDir: ROOT });
    seam.writeAddress({ transport: 'http', address: 'http://127.0.0.1:39999', pid: 4242 });
    expect(seam.readAddress()).toMatchObject({ transport: 'http', pid: 4242 });
  });
});