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
  createBenchmarkService,
  createFileLock,
  createRecommendationService,
  captureSnapshot,
  type ActivationLock,
  type ActivationRuntime,
  type BenchmarkLogSink,
  type BenchmarkRuntime,
  type CapabilityPort,
  type HardwarePort,
  type RunnerContext,
  type TransactionLogSink,
} from '@lmps/core';
import {
  HookRulesDocumentSchema,
  SCHEMA_VERSION,
  VirtualAliasesDocumentSchema,
  type CapabilityMatrix,
  type HookRulesDocument,
  type VirtualAliasesDocument,
} from '@lmps/domain';
import { createDefaultProbeEnv, probeHardware, type ProbeEnv } from '@lmps/hardware';
import { createI18n, loadResourceFiles, normalizeLocale, type Locale } from '@lmps/i18n';
import {
  createCliEstimatePort,
  createMockBenchmarkRuntime,
  createMockEstimatePort,
  createNodeLmStudioEnv,
  createRestBenchmarkRuntime,
  isLmStudioError,
  mockProbeResult,
  probeCapabilities,
  resolveAdapters,
  resolveBaseUrl,
  type AdapterBundle,
  type AdapterSelection,
  type CapabilityProbeResult,
  type LmStudioEnv,
} from '@lmps/lmstudio-adapter';
import {
  createDefaultFsys,
  createDefaultProfileStore,
  writeFileAtomic,
  type Fsys,
  type ProfileStore,
} from '@lmps/profile-store';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import { createFileLanguageStore } from './config.js';
import { CliError, lmUnreachable } from './errors.js';
import type {
  ActivationSeam,
  AliasConfigPort,
  BenchmarkSeam,
  CliDeps,
  HookConfigPort,
  RecommendationSeam,
} from './seams.js';

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
  const probeEnv = createDefaultProbeEnv();
  const recommendation = createRecommendationSeam(fs, { lmEnv, selection, probeEnv, rootDir });
  const benchmark = createBenchmarkSeam(fs, { lmEnv, selection, probeEnv, rootDir });
  const hookConfig = createHookConfigStore(fs, rootDir);
  const aliasConfig = createAliasConfigStore(fs, rootDir);

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
    probeEnv,
    discovery: lmPorts.discovery,
    state: lmPorts.state,
    snapshot: lmPorts.snapshot,
    activation: createActivationSeam(fs, { lmEnv, selection, rootDir }),
    recommendation,
    benchmark,
    hookConfig,
    aliasConfig,
    nodeVersion: process.versions.node ?? null,
  };
}

/**
 * The local hook config port (M4-001) over the real filesystem: strict rules
 * parsing (a hand-edited non-conforming rules file is a USAGE error so
 * `lmps hook rules validate` can surface the issues), atomic writes, the
 * persistent Bearer token (SECRET — stored under `<rootDir>/hooks/token.json`,
 * LOCAL-ONLY) and the loopback rendezvous the core-service writes on http
 * startup. The CLI only manages these files; it never serves the loopback API.
 */
export function createHookConfigStore(fs: Fsys, rootDir: string): HookConfigPort {
  const rulesPath = join(rootDir, 'hooks', 'rules.json');
  const tokenPath = join(rootDir, 'hooks', 'token.json');
  const addressPath = join(rootDir, 'hooks', 'address.json');

  function readRaw(file: string): unknown | null {
    if (!fs.exists(file)) return null;
    return JSON.parse(fs.readFileUtf8(file)) as unknown;
  }

  function readRules(): HookRulesDocument | null {
    const raw = readRaw(rulesPath);
    if (raw === null) return null;
    const parsed = HookRulesDocumentSchema.safeParse(raw);
    if (!parsed.success) {
      throw new CliError('USAGE', 'hook rules file is not a valid rules document', {
        params: { key: 'hook.error.invalidRules' },
      });
    }
    return parsed.data;
  }

  return {
    rulesPath: () => rulesPath,
    readRulesRaw: () => readRaw(rulesPath),
    readRules,
    writeRules(document) {
      fs.mkdirRecursive(join(rootDir, 'hooks'));
      writeFileAtomic(fs, rulesPath, `${JSON.stringify(document, null, 2)}\n`, 1);
    },
    disabled() {
      const doc = readRules();
      return doc !== null && doc.enabled === false;
    },
    readToken() {
      const raw = readRaw(tokenPath);
      if (raw === null || typeof raw !== 'object' || raw === null) return null;
      const token = (raw as { token?: unknown }).token;
      return typeof token === 'string' && token !== '' ? token : null;
    },
    rotateToken() {
      const token = randomBytes(24).toString('hex');
      fs.mkdirRecursive(join(rootDir, 'hooks'));
      writeFileAtomic(
        fs,
        tokenPath,
        `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, token, createdAt: new Date().toISOString() }, null, 2)}\n`,
        1,
      );
      return token;
    },
    readAddress() {
      const raw = readRaw(addressPath);
      if (raw === null || typeof raw !== 'object') return null;
      return raw as Record<string, unknown>;
    },
  };
}

/**
 * The virtual-alias config port (M4-002) over the real filesystem: strict
 * aliases parsing (a hand-edited non-conforming aliases file is a USAGE error
 * so `lmps proxy aliases validate` can surface the issues) and atomic writes.
 * The CLI only manages this file; core-service serves the loopback proxy.
 */
export function createAliasConfigStore(fs: Fsys, rootDir: string): AliasConfigPort {
  const aliasesPath = join(rootDir, 'hooks', 'aliases.json');

  function readRaw(): unknown | null {
    if (!fs.exists(aliasesPath)) return null;
    return JSON.parse(fs.readFileUtf8(aliasesPath)) as unknown;
  }

  function readAliases(): VirtualAliasesDocument | null {
    const raw = readRaw();
    if (raw === null) return null;
    const parsed = VirtualAliasesDocumentSchema.safeParse(raw);
    if (!parsed.success) {
      throw new CliError('USAGE', 'aliases file is not a valid aliases document', {
        params: { key: 'proxy.error.invalidAliases' },
      });
    }
    return parsed.data;
  }

  return {
    aliasesPath: () => aliasesPath,
    readAliasesRaw: readRaw,
    readAliases,
    writeAliases(document) {
      fs.mkdirRecursive(join(rootDir, 'hooks'));
      writeFileAtomic(fs, aliasesPath, `${JSON.stringify(document, null, 2)}\n`, 1);
    },
    disabled() {
      const doc = readAliases();
      return doc !== null && doc.enabled === false;
    },
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
    // The explicit mock path resolves WITHOUT a live probe (resolveAdapters
    // ignores the probe under `selection: 'mock'`; a probe would otherwise hit
    // REST/`lms` on the host for zero benefit). Mirrors the benchmark seam.
    const probe = selection === 'mock' ? mockProbeResult(options.lmEnv.baseUrl, now()) : await probeCapabilities(options.lmEnv);
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

  const estimate = selection === 'mock' ? createMockEstimatePort(now) : createCliEstimatePort(options.lmEnv);
  const ports = { runtime, lock, estimate, log };
  return { runtime, lock, estimate, log, context: runnerContext, runner: createActivationRunner(runnerContext, ports) };
}

export interface RecommendationSeamOptions {
  /** Pre-built adapter env; tests inject an in-memory fake here. */
  lmEnv: LmStudioEnv;
  /** Adapter selection; only `mock` overrides the router. */
  selection?: AdapterSelection;
  /** Hardware probe env; the same `lmps hardware` uses. */
  probeEnv: ProbeEnv;
  rootDir: string;
  now?: () => string;
}

/**
 * M2-002 production wiring: the `lmps optimize` seam. The capability port picks
 * the most operational matrix from the probe result (first with a reachable
 * `ops.load`, falling back to the REST matrix); the estimate port is the same
 * official estimator `apply` uses (whose unreachable path degrades to a labeled
 * `rough` estimate — the safety margin then fails closed); the hardware port
 * reuses `probeHardware`, so `lmps optimize` and `lmps hardware` agree on VRAM.
 * The audit sink appends each confirmed save to `<rootDir>/logs/optimizations.ndjson`.
 */
export function createRecommendationSeam(fs: Fsys, options: RecommendationSeamOptions): RecommendationSeam {
  const logPath = join(options.rootDir, 'logs', 'optimizations.ndjson');

  function pickActiveMatrix(result: CapabilityProbeResult): CapabilityMatrix {
    const active = result.matrices.find((matrix) =>
      matrix.capabilities.some((entry) => entry.field === 'ops.load' && (entry.support === 'exact' || entry.support === 'degraded')),
    );
    const fallback = result.matrices[0];
    if (fallback === undefined) {
      throw new Error('capability probe returned no matrices');
    }
    return active ?? fallback;
  }

  const capability: CapabilityPort = {
    probe: async () => {
      try {
        return pickActiveMatrix(await probeCapabilities(options.lmEnv));
      } catch (error) {
        const mapped = mapLmStudioReachability(error);
        if (mapped !== error) throw mapped;
        throw error;
      }
    },
  };

  const hardware: HardwarePort = {
    profile: async () => probeHardware(options.probeEnv),
  };

  const service = createRecommendationService(runnerContext, {
    estimate: createCliEstimatePort(options.lmEnv),
    capability,
    hardware,
  });

  return {
    service,
    audit: (entry) => {
      fs.mkdirRecursive(join(options.rootDir, 'logs'));
      const prior = fs.exists(logPath) ? fs.readFileUtf8(logPath) : '';
      const line = JSON.stringify(entry);
      fs.writeFileUtf8(logPath, prior === '' ? line : `${prior}\n${line}`);
    },
  };
}

export interface BenchmarkSeamOptions {
  /** Pre-built adapter env; tests inject an in-memory fake here. */
  lmEnv: LmStudioEnv;
  /** Adapter selection; `mock` routes the whole benchmark to the mock runtime. */
  selection?: AdapterSelection;
  /** Hardware probe env; the same `lmps hardware` uses. */
  probeEnv: ProbeEnv;
  rootDir: string;
  /** Lock owner label; defaults to `process.pid`. */
  owner?: string;
  now?: () => string;
}

/**
 * M2-003 production wiring: the `lmps benchmark` seam. The benchmark runtime
 * goes straight to the REST chat streaming endpoint (the mock is the only
 * alternative, selected explicitly); the hardware port reuses `probeHardware`,
 * so fingerprint/VRAM figures match `lmps hardware`; mutual exclusion reuses
 * the SAME `activation.lock` path as `apply`, so a benchmark and an activation
 * cannot interleave; every run result is appended to `<rootDir>/logs/benchmarks.ndjson`.
 * Reachability failures (host unreachable, token refused) map to the familiar
 * LM_UNREACHABLE (exit 4) at the runtime boundary; measurement failures stay
 * result-level (failed status, exit 0).
 */
export function createBenchmarkSeam(fs: Fsys, options: BenchmarkSeamOptions): BenchmarkSeam {
  const now = options.now ?? (() => new Date().toISOString());
  const selection = options.selection ?? 'auto';
  const lockPath = join(options.rootDir, 'locks', 'activation.lock');
  const logPath = join(options.rootDir, 'logs', 'benchmarks.ndjson');

  // One runtime instance per seam lifetime. The REST benchmark runtime must see
  // its own `load` snapshot in `restore` (it unloads only instances the run
  // created), which requires sharing the instance across the delegated calls;
  // the mock runtime's script counter has the same per-run identity demand.
  let shared: Promise<BenchmarkRuntime> | null = null;
  async function runtimes(): Promise<BenchmarkRuntime> {
    shared ??= selection === 'mock' ? Promise.resolve(createMockBenchmarkRuntime()) : Promise.resolve(createRestBenchmarkRuntime(options.lmEnv));
    return shared;
  }

  async function guarded<T>(work: (runtime: BenchmarkRuntime) => Promise<T>): Promise<T> {
    try {
      return await work(await runtimes());
    } catch (error) {
      const mapped = mapLmStudioReachability(error);
      if (mapped !== error) throw mapped;
      throw error;
    }
  }

  // Lazy delegate over the runtime; load covers the environment preflight (host
  // unreachable/auth token → LM_UNREACHABLE, exit 4). measure passes transport
  // failures through so core can classify them into result-level codes
  // (BENCHMARK_TIMEOUT/OOM/CRASH, failed status, exit 0) per the M2-003 rule.
  const runtime: BenchmarkRuntime = {
    getActiveState: () => guarded((r) => r.getActiveState()),
    load: (profile) => guarded((r) => r.load(profile)),
    measure: (profile, options) => runtimes().then((r) => r.measure(profile, options)),
    restore: () => guarded((r) => r.restore()),
  };

  const hardware: HardwarePort = {
    profile: async () => probeHardware(options.probeEnv),
  };

  const fileLock = createFileLock(fs, { path: lockPath, owner: options.owner ?? String(process.pid), leaseMs: ACTIVATION_LEASE_MS, now });
  const lock: ActivationLock = {
    acquire: async () => {
      fs.mkdirRecursive(join(options.rootDir, 'locks'));
      return fileLock.acquire();
    },
    release: () => fileLock.release(),
  };

  const log: BenchmarkLogSink = {
    write: async (result) => {
      fs.mkdirRecursive(join(options.rootDir, 'logs'));
      const prior = fs.exists(logPath) ? fs.readFileUtf8(logPath) : '';
      const line = JSON.stringify(result);
      fs.writeFileUtf8(logPath, prior === '' ? line : `${prior}\n${line}`);
    },
  };

  const service = createBenchmarkService(runnerContext, { runtime, hardware, lock, log });
  return { service };
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