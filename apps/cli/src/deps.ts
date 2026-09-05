/**
 * Production wiring for the CLI — with `index.ts` the only module allowed to
 * touch `node:` or `process.`. `createDefaultDeps()` builds the real ProfileStore,
 * the file language store, the i18n service over the shipped locale resources,
 * the default hardware probe env, the three read ports (models / current /
 * snapshot) on the LM Studio adapter router (M1-003), and the `apply` activation
 * seam (M1-005 production wiring): a lazy adapter router runtime, a lease-bearing
 * file lock owned by `process.pid`, the official estimator with rough fallback,
 * a redacted transaction log under `<rootDir>/logs/transactions.ndjson` and the
 * injected runner context.
 */
import {
  createActivationRunner,
  captureSnapshot,
  createFileLock,
  type ActivationLock,
  type ActivationRuntime,
  type RunnerContext,
  type TransactionLogSink,
} from '@lmps/core';
import { createDefaultProbeEnv } from '@lmps/hardware';
import { createI18n, loadResourceFiles, normalizeLocale, type Locale } from '@lmps/i18n';
import {
  createCliEstimatePort,
  createNodeLmStudioEnv,
  isLmStudioError,
  probeCapabilities,
  resolveAdapters,
  resolveBaseUrl,
  type AdapterBundle,
  type AdapterSelection,
  type LmStudioEnv,
} from '@lmps/lmstudio-adapter';
import { createDefaultFsys, createDefaultProfileStore, type Fsys, type ProfileStore } from '@lmps/profile-store';
import { join } from 'node:path';

import { createFileLanguageStore } from './config.js';
import { CliError, lmUnreachable } from './errors.js';
import type { ActivationSeam, CliDeps } from './seams.js';

export interface DefaultDepsOptions {
  rootDir?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
  /** Pre-built adapter env; tests inject an in-memory fake here. */
  lmEnv?: LmStudioEnv;
}

/** Explicit `rootDir` wins; then `LMPS_HOME`; otherwise `~/.lmps`. The root may hold passthrough secrets → LOCAL-ONLY. */
export function resolveRootDir(options: DefaultDepsOptions = {}): string {
  if (options.rootDir !== undefined) return options.rootDir;
  const env = options.env ?? process.env;
  const home = options.home ?? env.USERPROFILE ?? env.HOME ?? '.';
  return env.LMPS_HOME || join(home, '.lmps');
}

export function createDefaultDeps(options: DefaultDepsOptions = {}): CliDeps {
  const env = options.env ?? process.env;
  const rootDir = resolveRootDir(options);
  const fs = createDefaultFsys();
  const store = createDefaultProfileStore(rootDir);
  const languageStore = createFileLanguageStore(rootDir, fs);

  // i18n persistence calls `void store.set(...)`; failures land here so a
  // `lang` switch can surface them as exit 10 instead of silently dropping.
  let persistenceError: unknown = null;
  const i18n = createI18n({
    resources: loadResourceFiles(),
    store: languageStore,
    persistenceErrorHandler: (error) => {
      persistenceError = error;
    },
  });

  const lmEnv: LmStudioEnv =
    options.lmEnv ??
    createNodeLmStudioEnv({
      baseUrl: resolveBaseUrl(env.LMPS_LM_URL),
      // SECRET by classification; only ever sent as an Authorization header.
      token: env.LMPS_LM_TOKEN ?? null,
      lmsBin: env.LMPS_LMS_BIN ?? undefined,
    });
  // The explicit `LMPS_ADAPTER=mock` switch is the only way to select the demo
  // adapter; production defaults to `auto` and never silently flips to mock.
  const selection: AdapterSelection = env.LMPS_ADAPTER === 'mock' ? 'mock' : 'auto';

  const lmPorts = createLmStudioCliPorts(store, { lmEnv, selection });

  return {
    store,
    t: i18n.t,
    getLocale: () => i18n.getLocale(),
    storedLocale: () => languageStore.get(),
    systemLocale: () => systemLocaleFromEnv(env),
    applyLocale: (locale) => {
      i18n.setLocale(locale);
      if (persistenceError !== null) {
        const error = persistenceError;
        persistenceError = null;
        throw error;
      }
    },
    readStdin: createDefaultReadStdin(),
    readTextFile: (path) => fs.readFileUtf8(path),
    writeTextFile: (path, data) => fs.writeFileUtf8(path, data),
    now: () => new Date().toISOString(),
    probeEnv: createDefaultProbeEnv(),
    discovery: lmPorts.discovery,
    state: lmPorts.state,
    snapshot: lmPorts.snapshot,
    activation: createActivationSeam(fs, { lmEnv, selection, rootDir }),
    nodeVersion: process.versions.node ?? null,
  };
}

/**
 * Adapter failure kinds that mean "the LM Studio host is not serving us".
 * `auth` belongs here even though the host answered: a rejected token is a
 * user-level configuration problem, not an internal fault.
 */
const LM_REACHABILITY_KINDS = new Set<string>(['unreachable', 'timeout', 'auth']);

/**
 * Maps an adapter reachability failure to the stable user-level LM_UNREACHABLE
 * CliError (exit 4). Anything else passes through unchanged so parse/process/
 * internal bugs surface as INTERNAL instead of being papered over. Exported for
 * unit tests; production callers are the guarded port closures below.
 */
export function mapLmStudioReachability(error: unknown): unknown {
  if (isLmStudioError(error) && LM_REACHABILITY_KINDS.has(error.kind)) {
    return lmUnreachable(error.kind);
  }
  return error;
}

export interface LmStudioCliPortOptions {
  /** Process env read for LMPS_LM_URL / LMPS_LM_TOKEN / LMPS_LMS_BIN. */
  env?: NodeJS.ProcessEnv;
  /** Pre-built adapter env; tests inject an in-memory fake here. */
  lmEnv?: LmStudioEnv;
  /** Adapter selection; defaults to `auto`. Only `mock` overrides the router. */
  selection?: AdapterSelection;
}

export interface LmStudioCliPorts {
  discovery: NonNullable<CliDeps['discovery']>;
  state: NonNullable<CliDeps['state']>;
  snapshot: NonNullable<CliDeps['snapshot']>;
}

/**
 * Wires the three read ports (models / current / snapshot) to the adapter
 * router (M1-003). The capability probe runs once per command call; the adapter
 * caches results for its TTL so repeated calls are cheap and a server that comes
 * up mid-process is picked up without a CLI restart. Reachability failures map
 * to LM_UNREACHABLE (exit 4); never-used capabilities keep CAPABILITY_UNSUPPORTED.
 */
export function createLmStudioCliPorts(store: ProfileStore, options: LmStudioCliPortOptions = {}): LmStudioCliPorts {
  const lmEnv =
    options.lmEnv ??
    createNodeLmStudioEnv({
      baseUrl: resolveBaseUrl(options.env?.LMPS_LM_URL),
      // SECRET by classification; only ever sent as an Authorization header.
      token: options.env?.LMPS_LM_TOKEN ?? null,
      lmsBin: options.env?.LMPS_LMS_BIN ?? undefined,
    });
  const selection = options.selection ?? 'auto';

  async function bundle(): Promise<AdapterBundle> {
    const probe = await probeCapabilities(lmEnv);
    return resolveAdapters(lmEnv, probe, { selection });
  }

  async function guarded<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      const mapped = mapLmStudioReachability(error);
      if (mapped !== error) throw mapped;
      throw error;
    }
  }

  return {
    discovery: {
      listModels: () =>
        guarded(async () => {
          const models = await (await bundle()).discovery.listModels();
          return models.map((m) => ({
            key: m.modelKey,
            family: m.family,
            quantization: m.quantization,
            parametersB: m.parametersB,
          }));
        }),
    },
    state: {
      getActive: () =>
        guarded(async () => {
          const active = await (await bundle()).runtime.getActiveState();
          return {
            profileId: active.modelKey === null ? null : profileIdForModelKey(store, active.modelKey),
            modelKey: active.modelKey,
            since: active.since,
          };
        }),
    },
    snapshot: {
      capture: () =>
        guarded(async () => {
          const data = await captureSnapshot(runnerContext, (await bundle()).runtime);
          return {
            profileId: data.profileId === 'none' ? snapshotProfileId(store, data.captured) : data.profileId,
            at: data.at,
            captured: data.captured,
          };
        }),
    },
  };
}

/** A lease the run cannot outgrow in normal operation: 30 minutes. */
const ACTIVATION_LEASE_MS = 30 * 60_000;

export interface ActivationSeamOptions {
  /** Pre-built adapter env; tests inject an in-memory fake here. */
  lmEnv: LmStudioEnv;
  /** Adapter selection; `mock` routes the whole activation to the demo adapter. */
  selection?: AdapterSelection;
  rootDir: string;
  /** Lock owner label; defaults to `process.pid`. */
  owner?: string;
  now?: () => string;
}

/**
 * M1-005 production wiring: the `apply` activation seam. The adapter runtime is
 * resolved lazily through the capability router on the first call, so `lmps
 * profile list` never pays for LM Studio probing; reachability failures map to
 * `LM_UNREACHABLE` (exit 4) at the apply preflight. Mutual exclusion uses the
 * lease-bearing file lock owned by this process; the official estimator (with
 * the explicit rough fallback) feeds the estimating stage; every transaction is
 * appended (already redacted by the runner) to `<rootDir>/logs/transactions.ndjson`.
 * `LMPS_ADAPTER=mock` is the only way to select the in-memory demo adapter.
 */
export function createActivationSeam(fs: Fsys, options: ActivationSeamOptions): ActivationSeam {
  const now = options.now ?? (() => new Date().toISOString());
  const selection = options.selection ?? 'auto';
  const lockDir = join(options.rootDir, 'locks');
  const logPath = join(options.rootDir, 'logs', 'transactions.ndjson');

  // One CLI process runs one command, so a single consistent host view across
  // the apply preflight and the runner is what matters: the bundle is resolved
  // on first use and cached for the seam's lifetime (probeCapabilities keeps its
  // own TTL for the read ports). Re-resolving per call would split a run across
  // two adapter instances — fatal for an in-memory mock, misleading for REST.
  let cached: AdapterBundle | null = null;
  async function bundle(): Promise<AdapterBundle> {
    if (cached !== null) return cached;
    const probe = await probeCapabilities(options.lmEnv);
    cached = resolveAdapters(options.lmEnv, probe, { selection });
    return cached;
  }

  async function guarded<T>(work: (runtime: ActivationRuntime) => Promise<T>): Promise<T> {
    try {
      return await work((await bundle()).runtime);
    } catch (error) {
      const mapped = mapLmStudioReachability(error);
      if (mapped !== error) throw mapped;
      throw error;
    }
  }

  // A lazy delegate over the router bundle: `lmps apply` probes around first
  // every call; the adapter shares its TTL cache with the read ports.
  const runtime: ActivationRuntime = {
    getActiveState: () => guarded((r) => r.getActiveState()),
    unload: () => guarded((r) => r.unload()),
    restore: () => guarded((r) => r.restore()),
    load: (profile, estimate) => guarded((r) => r.load(profile, estimate)),
    healthCheck: (profile) => guarded((r) => r.healthCheck(profile)),
    readEffectiveConfig: (profile) => guarded((r) => r.readEffectiveConfig(profile)),
  };

  const fileLock = createFileLock(fs, {
    path: join(lockDir, 'activation.lock'),
    owner: options.owner ?? String(process.pid),
    leaseMs: ACTIVATION_LEASE_MS,
    now,
  });
  const lock: ActivationLock = {
    acquire: async () => {
      fs.mkdirRecursive(lockDir);
      return fileLock.acquire();
    },
    release: () => fileLock.release(),
  };

  const log: TransactionLogSink = {
    write: async (transaction) => {
      fs.mkdirRecursive(join(options.rootDir, 'logs'));
      const prior = fs.exists(logPath) ? fs.readFileUtf8(logPath) : '';
      const line = JSON.stringify(transaction);
      fs.writeFileUtf8(logPath, prior === '' ? line : `${prior}\n${line}`);
    },
  };

  const estimate = createCliEstimatePort(options.lmEnv);
  const ports = { runtime, lock, estimate, log };
  return { runtime, lock, estimate, log, context: runnerContext, runner: createActivationRunner(runnerContext, ports) };
}

/**
 * REST reports a loaded model without profile identity, so `captureSnapshot`'s
 * fallback id is the literal 'none'. `lmps snapshot` and `lmps current` must
 * agree, so the same store reverse-lookup backfills it here.
 */
function snapshotProfileId(store: ProfileStore, captured: Record<string, unknown>): string {
  const active = captured.active;
  if (typeof active !== 'object' || active === null || Array.isArray(active)) return 'none';
  const modelKey = (active as Record<string, unknown>).modelKey;
  if (typeof modelKey !== 'string') return 'none';
  return profileIdForModelKey(store, modelKey) ?? 'none';
}

/**
 * Backfills the CLI-visible profile id when the adapter cannot know it (REST
 * reports a loaded model without a profile identity): the store is the source
 * of truth for "which of my profiles maps to this model".
 */
function profileIdForModelKey(store: ProfileStore, modelKey: string): string | null {
  return store.list().find((profile) => profile.model.modelKey === modelKey)?.id ?? null;
}

/**
 * Minimal runner context for `captureSnapshot`, which only consumes `now()`.
 * `wait`/`defaultStageTimeoutMs`/`createTxId` are structural; the M1-005 apply
 * runner provides its own context when task f wires the activation seam.
 */
const runnerContext: RunnerContext = {
  now: () => new Date().toISOString(),
  wait: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(new Error('wait aborted'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    }),
  defaultStageTimeoutMs: 60_000,
  createTxId: () => `lm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
};

function systemLocaleFromEnv(env: NodeJS.ProcessEnv): Locale | null {
  for (const key of ['LMPS_LANG', 'LC_ALL', 'LC_MESSAGES', 'LANG', 'LANGUAGE'] as const) {
    const value = env[key];
    if (typeof value === 'string' && value.trim() !== '') {
      const normalized = normalizeLocale(value);
      if (normalized !== null) return normalized;
    }
  }
  return null;
}

/**
 * Reads all of stdin. An interactive terminal (isTTY) is a usage error: the CLI
 * has no prompt loop, and hanging a human waiting on EOF is a worse failure.
 */
function createDefaultReadStdin(): () => Promise<string> {
  return async () => {
    if (process.stdin.isTTY === true) {
      throw new CliError('USAGE', 'stdin requested from an interactive terminal', {
        params: { key: 'error.usage', values: { detail: 'stdin is a terminal; pipe a file instead' } },
      });
    }
    let data = '';
    for await (const chunk of process.stdin) data += String(chunk);
    return data;
  };
}