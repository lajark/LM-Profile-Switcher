/**
 * Sidecar wiring (M3-002/M7-003) — the model-context, recommendation and benchmark seams the desktop
 * data plane runs on. Mirrors the CLI's apps/cli/src/deps.ts production recipes
 * (createRecommendationSeam / createBenchmarkSeam) trimmed for the sidecar host:
 * paths are built by string concatenation (Node's join is off-limits in this
 * pure module) and the lock owner label is REQUIRED because the SEA has no
 * `pid`. Both seams re-verify reachability through mapLmStudioReachability so a
 * live-host failure surfaces as LM_UNREACHABLE at the RPC boundary.
 *
 * The CLI and the sidecar deliberately assemble the SAME packages separately
 * (recorded in docs/adr); extracting a shared bundle is a later refactor task.
 */
import {
  createActivationRunner,
  createBenchmarkService,
  createFileLock,
  createRecommendationService,
  createOptimizationLoopService,
  createSessionLock,
  parseBenchmarkLogLines,
  type ActivationLock,
  type ActivationRuntime,
  type ActivationRunner,
  type BenchmarkLogSink,
  type BenchmarkRuntime,
  type BenchmarkService,
  type EstimatePort,
  type HardwarePort,
  type MeasuredResultsPort,
  type ModelDefaultRecord,
  type ModelDiscoveryRecord,
  type ReadinessSnapshot,
  type RecommendationService,
  type OptimizationLoopService,
  type OptimizationPreflightPort,
  type RunnerContext,
  type TransactionLogSink,
} from '@lmps/core';
import {
  DEFAULT_SESSION_TTL_MS,
  HookRulesDocumentSchema,
  SCHEMA_VERSION,
  VirtualAliasesDocumentSchema,
  type BenchmarkResult,
  type CapabilityMatrix,
  type HookRulesDocument,
  type VirtualAliasesDocument,
} from '@lmps/domain';
import { createDefaultProbeEnv, probeHardware } from '@lmps/hardware';
import {
  createCliEstimatePort,
  createMockBenchmarkRuntime,
  createMockChatUpstream,
  createMockEstimatePort,
  createRestBenchmarkRuntime,
  isLmStudioError,
  mockProbeResult,
  probeCapabilities,
  resolveAdapters,
  restOpenAiChatStream,
  type AdapterBundle,
  type AdapterSelection,
  type CapabilityProbeResult,
  type LmStudioEnv,
  type MockAdapterOptions,
  type MockBenchmarkOptions,
} from '@lmps/lmstudio-adapter';
import { createProfileDefaultStore, writeFileAtomic, type Fsys, type ProfileDefaultStore, type ProfileStore } from '@lmps/profile-store';

import { RpcMethodError } from './protocol.js';
import {
  handleChatCompletions,
  handleListModels,
  type ProxyPorts,
  type ProxyResult,
  type ProxyUpstream,
} from './proxy.js';

export interface SidecarModelContextSeam {
  /** Reads adapter discovery, readiness/runtime state and benchmark evidence. */
  read(): Promise<{
    models: ModelDiscoveryRecord[];
    benchmarks: BenchmarkResult[];
    defaults?: ModelDefaultRecord[];
    readiness: ReadinessSnapshot;
  }>;
}

export interface SidecarRecommendationSeam {
  service: RecommendationService;
  /** Appends one redacted optimization-save record (ndjson line). */
  audit(entry: Record<string, unknown>): void;
}

/**
 * The activation seam the sidecar handlers drive (M3-003). Mirrors the CLI's
 * `ActivationSeam` plus an unload audit sink: the activation *transaction*
 * schema cannot express "unloaded, nothing active" (targetProfileId is
 * mandatory, statuses are activation-oriented), so unload events get their own
 * `<rootDir>/logs/unloads.ndjson` stream instead of bending the contract.
 */
export interface SidecarActivationSeam {
  runtime: ActivationRuntime;
  lock: ActivationLock;
  estimate: EstimatePort;
  log: TransactionLogSink;
  context: RunnerContext;
  runner: ActivationRunner;
  /** Appends one redacted unload record (ndjson line). */
  auditUnload(entry: Record<string, unknown>): void;
}

export interface SidecarBenchmarkSeam {
  service: BenchmarkService;
}

export interface SidecarOptimizationSeam {
  service: OptimizationLoopService;
}

/**
 * The local hook seam (M4-001): rules, persistent auth token, loopback
 * rendezvous file and the hook audit sink, all under `<rootDir>/hooks/` and
 * `<rootDir>/logs/hooks.ndjson`. The token is a SECRET — stored under
 * `<rootDir>/hooks/token.json` (LOCAL-ONLY), never emitted through audit rows,
 * addresses or error messages. Rule parsing is strict: a hand-edited rules file
 * that stops conforming to `HookRulesDocument` surfaces as the stable
 * HOOK_RULES_INVALID RPC code instead of silently reading as "unconfigured".
 */
export interface SidecarHookSeam {
  /** Parsed rules document; missing file → null (not configured yet). */
  readRules(): HookRulesDocument | null;
  /** Atomic replace of `<rootDir>/hooks/rules.json`. */
  writeRules(document: HookRulesDocument): void;
  /** True when the global switch is explicitly off (rules configured + enabled false). */
  disabled(): boolean;
  /** Appends one redacted hook call record (ndjson line). */
  audit(entry: Record<string, unknown>): void;
  /** Persisted hook token; generating + persisting one on first use. */
  readOrCreateToken(randomToken: string): string;
  /** Regenerates and persists the hook token; the previous one stops working. */
  rotateToken(randomToken: string): string;
  /** Persistent hook token; null when never initialized. */
  readToken(): string | null;
  /** Writes the loopback rendezvous for human/CLI inspection (LOCAL-ONLY). */
  writeAddress(address: Record<string, unknown>): void;
  /** Rendezvous file; null when the http transport has not run yet. */
  readAddress(): Record<string, unknown> | null;
}

/** Adapter failure kinds that mean the LM Studio host is not serving us. */
const LM_REACHABILITY_KINDS = new Set<string>(['unreachable', 'timeout', 'auth']);

/** The stable error a reachability failure becomes at the RPC boundary (M3-002). */
export function mapLmStudioReachability(error: unknown): unknown {
  if (isLmStudioError(error) && LM_REACHABILITY_KINDS.has(error.kind)) {
    return new RpcMethodError('LM_UNREACHABLE', `LM Studio unreachable (${error.kind})`);
  }
  return error;
}

/** Minimal runner context the sidecar services run under (mirrors deps.ts). */
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
  createTxId: () => `sd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
};

/** A lease a run cannot outgrow in normal operation: 30 minutes (CLI parity). */
const ACTIVATION_LEASE_MS = 30 * 60_000;

export interface SidecarSeamOptions {
  lmEnv: LmStudioEnv;
  /** Adapter selection; `mock` routes the whole call to the demo adapter. */
  selection?: AdapterSelection;
  rootDir: string;
  /** Lock owner label. In production this is the numeric OS pid (the CLI
   *  owner is also a pid), so both contend on the same lease and a crashed
   *  owner's lease can be reclaimed via isOwnerAlive. */
  owner: string;
  /**
   * Liveness probe for a lease's recorded owner (a numeric pid in production).
   * A live lease whose owner is gone is crash residue and is reclaimed on
   * acquire instead of blocking until the lease expires. Absent → live leases
   * always block (never steal from a live peer).
   */
  isOwnerAlive?: (owner: string) => boolean;
  /** Optional controls for the explicit Mock Adapter only. */
  mockAdapter?: MockAdapterOptions;
  /** Optional controls for the explicit Mock Benchmark runtime only. */
  mockBenchmark?: MockBenchmarkOptions;
  now?: () => string;
}

/** `mkdir(parent)` + append one ndjson line (paths built by concatenation). */
function appendNdjson(fs: Fsys, path: string, entry: Record<string, unknown>): void {
  const dir = dirnameOf(path);
  fs.mkdirRecursive(dir);
  const prior = fs.exists(path) ? fs.readFileUtf8(path) : '';
  const line = JSON.stringify(entry);
  fs.writeFileUtf8(path, prior === '' ? line : `${prior}\n${line}`);
}

function dirnameOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '.' : path.slice(0, index);
}

function pickActiveMatrix(result: CapabilityProbeResult): CapabilityMatrix {
  const active = result.matrices.find((matrix) =>
    matrix.capabilities.some(
      (entry) => entry.field === 'ops.load' && (entry.support === 'exact' || entry.support === 'degraded'),
    ),
  );
  const fallback = result.matrices[0];
  if (fallback === undefined) {
    throw new Error('capability probe returned no matrices');
  }
  return active ?? fallback;
}

/** probeCapabilities + matrix pick, with LM unreachability mapped to LM_UNREACHABLE. */
function pickActiveMatrixGuarded(lmEnv: LmStudioEnv): () => Promise<CapabilityMatrix> {
  return async () => {
    try {
      return pickActiveMatrix(await probeCapabilities(lmEnv));
    } catch (error) {
      const mapped = mapLmStudioReachability(error);
      if (mapped !== error) throw mapped;
      throw error;
    }
  };
}

/**
 * Reads the external model/readiness surfaces for the model-first data plane.
 * Discovery failures are represented in the snapshot; they do not turn a
 * stale local profile into a silently verified model.
 */
export function createSidecarModelContextSeam(fs: Fsys, options: SidecarSeamOptions): SidecarModelContextSeam {
  const now = options.now ?? (() => new Date().toISOString());

  return {
    async read() {
      const probe = options.selection === 'mock' ? mockProbeResult(options.lmEnv.baseUrl, now()) : await probeCapabilities(options.lmEnv);
      const adapters = resolveAdapters(options.lmEnv, probe, { selection: options.selection, mock: options.mockAdapter });
      const lmStatus = probe.ops.restReachable ? 'ready' : probe.ops.lmsAvailable ? 'partial' : 'offline';
      let models: ModelDiscoveryRecord[];
      let discoveryStatus: ReadinessSnapshot['discovery']['status'];
      try {
        models = (await adapters.discovery.listModels()).map((model) => ({
          modelKey: model.modelKey,
          family: model.family,
          quantization: model.quantization,
          parametersB: model.parametersB,
        }));
        discoveryStatus = 'ready';
      } catch {
        models = [];
        discoveryStatus = 'offline';
      }

      let active: Awaited<ReturnType<AdapterBundle['runtime']['getActiveState']>> | null;
      let runtimeStatus: ReadinessSnapshot['runtime']['status'];
      try {
        active = await adapters.runtime.getActiveState();
        runtimeStatus = active.modelKey === null ? 'idle' : 'running';
      } catch {
        active = null;
        runtimeStatus = 'unknown';
      }

      let hardwareStatus: ReadinessSnapshot['hardware'] = { status: 'unavailable', fingerprint: null };
      try {
        const hardware = await probeHardware(createDefaultProbeEnv());
        hardwareStatus = { status: 'ready', fingerprint: hardware.hardwareFingerprint ?? null };
      } catch {
        // The model list remains useful when a hardware probe is unavailable.
      }
      const benchmarkPath = options.rootDir + '/logs/benchmarks.ndjson';
      const benchmarks = fs.exists(benchmarkPath) ? parseBenchmarkLogLines(fs.readFileUtf8(benchmarkPath)) : [];
      const defaults = createProfileDefaultStore({
        fs,
        path: options.rootDir + '/profile-defaults.json',
        now,
      }).list().map(({ modelKey, taskType, profileId }) => ({ modelKey, taskType, profileId }));
      return {
        models,
        benchmarks,
        defaults,
        readiness: {
          hardware: hardwareStatus,
          lmStudio: { status: lmStatus, version: probe.ops.lmStudioVersion },
          discovery: { status: discoveryStatus, observedAt: probe.ops.probedAt },
          runtime: { status: runtimeStatus, active },
        },
      };
    },
  };
}

/**
 * The `optimize.preview|save` seam. Capability probe picks the most operational
 * matrix; the estimate port is the same official estimator `apply` uses (whose
 * unreachable path degrades to a labeled `rough` estimate — the safety margin
 * then fails closed); the hardware port reuses probeHardware so the desktop and
 * `lmps hardware` agree on VRAM. The audit sink appends each confirmed save to
 * `<rootDir>/logs/optimizations.ndjson`.
 */
export function createSidecarRecommendationSeam(
  fs: Fsys,
  options: SidecarSeamOptions,
): SidecarRecommendationSeam {
  // Measured-feedback loop: the same append-only benchmark audit log the CLI
  // reads backs the desktop ranking; a missing or unreadable log degrades to
  // the pure static ranking.
  const benchmarkLogPath = `${options.rootDir}/logs/benchmarks.ndjson`;
  const measured: MeasuredResultsPort = {
    list: async () =>
      fs.exists(benchmarkLogPath) ? parseBenchmarkLogLines(fs.readFileUtf8(benchmarkLogPath)) : [],
  };
  return {
    service: createRecommendationService(runnerContext, {
      estimate: createCliEstimatePort(options.lmEnv),
      capability: { probe: pickActiveMatrixGuarded(options.lmEnv) },
      hardware: { profile: () => probeHardware(createDefaultProbeEnv()) },
      measured,
    }),
    audit: (entry) => appendNdjson(fs, `${options.rootDir}/logs/optimizations.ndjson`, entry),
  };
}

/**
 * The `activation.apply|status|unload` seam (M3-003). Created as a trimmed
 * mirror of the CLI's `deps.ts` recipe: the adapter runtime is resolved lazily
 * through the capability router on first use (a tray menu fetch never pays for
 * probing), reachability failures map to LM_UNREACHABLE, mutual exclusion uses
 * the SAME `activation.lock` path as the CLI and the benchmark (owner is this
 * process's pid — the desktop and the CLI can no longer interleave
 * activations, and a crashed owner's still-valid lease is reclaimed via
 * isOwnerAlive on the next acquire), the official estimator feeds the
 * estimating stage and every transaction lands redacted in
 * `<rootDir>/logs/transactions.ndjson`.
 * Unload events append to `<rootDir>/logs/unloads.ndjson` (a schema cannot
 * express "nothing active", so they audit as their own record).
 */
export function createSidecarActivationSeam(
  fs: Fsys,
  options: SidecarSeamOptions,
): SidecarActivationSeam {
  const now = options.now ?? (() => new Date().toISOString());
  const lockPath = `${options.rootDir}/locks/activation.lock`;

  // One sidecar serves many operations, so a single consistent host view across
  // preflight and stages is what matters: the bundle is resolved on first use
  // and cached for the seam's lifetime (probeCapabilities keeps its own TTL for
  // the read ports). Re-resolving per call would split a run across two adapter
  // instances — fatal for an in-memory mock, misleading for REST.
  let cached: AdapterBundle | null = null;
  async function bundle(): Promise<AdapterBundle> {
    if (cached !== null) return cached;
    // The explicit mock path resolves WITHOUT a live probe (resolveAdapters
    // ignores the probe under `selection: 'mock'`; a probe would otherwise hit
    // REST/`lms` on the host for zero benefit). Mirrors createSidecarBenchmarkSeam.
    const probe = options.selection === 'mock' ? mockProbeResult(options.lmEnv.baseUrl, now()) : await probeCapabilities(options.lmEnv);
    cached = resolveAdapters(options.lmEnv, probe, { selection: options.selection, mock: options.mockAdapter });
    return cached;
  }

  async function guarded<T>(work: (r: ActivationRuntime) => Promise<T>): Promise<T> {
    try {
      return await work((await bundle()).runtime);
    } catch (error) {
      const mapped = mapLmStudioReachability(error);
      if (mapped !== error) throw mapped;
      throw error;
    }
  }

  const runtime: ActivationRuntime = {
    getActiveState: () => guarded((r) => r.getActiveState()),
    unload: () => guarded((r) => r.unload()),
    restore: () => guarded((r) => r.restore()),
    load: (profile, estimate) => guarded((r) => r.load(profile, estimate)),
    healthCheck: (profile) => guarded((r) => r.healthCheck(profile)),
    readEffectiveConfig: (profile) => guarded((r) => r.readEffectiveConfig(profile)),
  };

  const fileLock = createFileLock(fs, {
    path: lockPath,
    owner: options.owner,
    leaseMs: ACTIVATION_LEASE_MS,
    now,
    isOwnerAlive: options.isOwnerAlive,
  });
  const lock: ActivationLock = {
    acquire: async () => {
      fs.mkdirRecursive(dirnameOf(lockPath));
      return fileLock.acquire();
    },
    release: () => fileLock.release(),
  };

  const log: TransactionLogSink = {
    write: async (transaction) => {
      appendNdjson(fs, `${options.rootDir}/logs/transactions.ndjson`, transaction as unknown as Record<string, unknown>);
    },
  };

  const estimate =
    options.selection === 'mock' ? createMockEstimatePort(now) : createCliEstimatePort(options.lmEnv);
  const ports = { runtime, lock, estimate, log };
  return {
    runtime,
    lock,
    estimate,
    log,
    context: runnerContext,
    runner: createActivationRunner(runnerContext, ports),
    auditUnload: (entry) => appendNdjson(fs, `${options.rootDir}/logs/unloads.ndjson`, entry),
  };
}

/**
 * The `benchmark.run` seam. The runtime goes straight to the REST chat streaming
 * endpoint (the mock is the only alternative, selected explicitly); the hardware
 * port reuses probeHardware so fingerprint/VRAM figures match `lmps hardware`;
 * mutual exclusion reuses the SAME `activation.lock` path as `apply` (a run and
 * an activation cannot interleave); every run result is appended to
 * `<rootDir>/logs/benchmarks.ndjson`.
 */
export function createSidecarBenchmarkSeam(fs: Fsys, options: SidecarSeamOptions): SidecarBenchmarkSeam {
  const lockPath = `${options.rootDir}/locks/activation.lock`;

  async function runtime(): Promise<BenchmarkRuntime> {
    return options.selection === 'mock'
      ? createMockBenchmarkRuntime(options.mockBenchmark)
      : createRestBenchmarkRuntime(options.lmEnv);
  }

  async function guarded<T>(work: (r: BenchmarkRuntime) => Promise<T>): Promise<T> {
    try {
      return await work(await runtime());
    } catch (error) {
      const mapped = mapLmStudioReachability(error);
      if (mapped !== error) throw mapped;
      throw error;
    }
  }

  // Lazy delegate over the runtime; load covers the environment preflight (host
  // unreachable/auth token → LM_UNREACHABLE), measure passes transport failures
  // through so core classifies them into result-level codes (failed status).
  const runtimePort: BenchmarkRuntime = {
    getActiveState: () => guarded((r) => r.getActiveState()),
    load: (profile) => guarded((r) => r.load(profile)),
    measure: (profile, measureOptions) => runtime().then((r) => r.measure(profile, measureOptions)),
    restore: () => guarded((r) => r.restore()),
  };

  const fileLock = createFileLock(fs, {
    path: lockPath,
    owner: options.owner,
    leaseMs: ACTIVATION_LEASE_MS,
    now: options.now ?? (() => new Date().toISOString()),
    isOwnerAlive: options.isOwnerAlive,
  });
  const lock: ActivationLock = {
    acquire: async () => {
      fs.mkdirRecursive(`${options.rootDir}/locks`);
      return fileLock.acquire();
    },
    release: () => fileLock.release(),
  };

  const log: BenchmarkLogSink = {
    write: async (result) => {
      appendNdjson(fs, `${options.rootDir}/logs/benchmarks.ndjson`, result as unknown as Record<string, unknown>);
    },
  };

  const hardware: HardwarePort = {
    profile: () => probeHardware(createDefaultProbeEnv()),
  };

  return { service: createBenchmarkService(runnerContext, { runtime: runtimePort, hardware, lock, log }) };
}

/**
 * The local hook seam (M4-001). Everything the hook RPC surface needs under
 * `<rootDir>/hooks/`: the rules document (parsed strict, paths by string
 * concatenation because this pure module cannot import Node's path module), the
 * persisted auth token (`token.json`, SECRET — never read back into any frame
 * or audit row), the loopback rendezvous (`address.json`, for `lmps hook
 * status`) and the `logs/hooks.ndjson` audit stream. Writes reuse
 * `writeFileAtomic` so a crash never leaves a half-written token or rules set.
 */
export function createHookSeam(fs: Fsys, options: { rootDir: string }): SidecarHookSeam {
  const rulesPath = `${options.rootDir}/hooks/rules.json`;
  const tokenPath = `${options.rootDir}/hooks/token.json`;
  const addressPath = `${options.rootDir}/hooks/address.json`;

  function readJson<T>(path: string): T | null {
    if (!fs.exists(path)) return null;
    return JSON.parse(fs.readFileUtf8(path)) as T;
  }

  function readRules(): HookRulesDocument | null {
    const raw = readJson<unknown>(rulesPath);
    if (raw === null) return null;
    const parsed = HookRulesDocumentSchema.safeParse(raw);
    if (!parsed.success) {
      throw new RpcMethodError('HOOK_RULES_INVALID', 'hook rules document failed schema validation');
    }
    return parsed.data;
  }

  function writeRules(document: HookRulesDocument): void {
    fs.mkdirRecursive(`${options.rootDir}/hooks`);
    writeFileAtomic(fs, rulesPath, `${JSON.stringify(document, null, 2)}\n`, 1);
  }

  function readToken(): string | null {
    const raw = readJson<{ token?: unknown }>(tokenPath);
    if (raw === null || typeof raw.token !== 'string' || raw.token === '') return null;
    return raw.token;
  }

  function writeToken(token: string, createdAt: string): void {
    fs.mkdirRecursive(`${options.rootDir}/hooks`);
    writeFileAtomic(
      fs,
      tokenPath,
      `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, token, createdAt }, null, 2)}\n`,
      1,
    );
  }

  function readAddress(): Record<string, unknown> | null {
    return readJson<Record<string, unknown>>(addressPath);
  }

  return {
    readRules,
    writeRules,
    disabled() {
      const doc = readRules();
      return doc !== null && doc.enabled === false;
    },
    audit: (entry) => appendNdjson(fs, `${options.rootDir}/logs/hooks.ndjson`, entry),
    readOrCreateToken(randomToken) {
      const existing = readToken();
      if (existing !== null) return existing;
      writeToken(randomToken, new Date().toISOString());
      return randomToken;
    },
    rotateToken(randomToken) {
      writeToken(randomToken, new Date().toISOString());
      return randomToken;
    },
    readToken,
    writeAddress: (address) => {
      fs.mkdirRecursive(`${options.rootDir}/hooks`);
      writeFileAtomic(fs, addressPath, `${JSON.stringify(address, null, 2)}\n`, 1);
    },
    readAddress,
  };
}

/**
 * The virtual-alias seam (M4-002): strict parsing of `<rootDir>/hooks/aliases.json`
 * (a hand-edited document that stops conforming surfaces as ALIASES_INVALID,
 * never as "unconfigured") and the `logs/proxy.ndjson` audit sink. Mirrors the
 * read half of createHookSeam; the OpenAI proxy front reads and audits, and
 * aliases are edited only through the CLI (or by hand in the file).
 */
export interface SidecarAliasSeam {
  /** Parsed aliases document; missing file → null (not configured yet). */
  readAliases(): VirtualAliasesDocument | null;
  /** Appends one redacted proxy resolution record (ndjson line). */
  audit(entry: Record<string, unknown>): void;
}

/**
 * The OpenAI-compatible proxy front (M4-002) the http transport drives. The
 * transport only parses the request body and session headers, then hands the
 * framed result back; every orchestration/wire decision lives in proxy.ts.
 */
export interface OpenAiProxySeam {
  handleChatCompletions(
    requestValue: unknown,
    sessionId: string | null,
    release: boolean,
    signal: AbortSignal,
  ): Promise<ProxyResult>;
  handleListModels(): Promise<{ status: number; body: Record<string, unknown> }>;
}

export function createAliasSeam(fs: Fsys, options: { rootDir: string }): SidecarAliasSeam {
  const aliasesPath = `${options.rootDir}/hooks/aliases.json`;
  function readAliases(): VirtualAliasesDocument | null {
    if (!fs.exists(aliasesPath)) return null;
    const raw = JSON.parse(fs.readFileUtf8(aliasesPath)) as unknown;
    const parsed = VirtualAliasesDocumentSchema.safeParse(raw);
    if (!parsed.success) {
      throw new RpcMethodError('ALIASES_INVALID', 'aliases document failed schema validation');
    }
    return parsed.data;
  }
  return {
    readAliases,
    audit: (entry) => appendNdjson(fs, `${options.rootDir}/logs/proxy.ndjson`, entry),
  };
}

/**
 * Assembles the proxy ports (M4-002). The upstream is the scripted mock under
 * the explicit `LMPS_ADAPTER=mock` demo path, else the real REST streaming
 * seam on the shared env; the session lock's TTL re-reads the aliases
 * document's `sessionTtlMs` live (edits apply without rebuilding the lock);
 * the activation seam powers per-alias `activate: true` under the shared
 * activation.lock. The profile store is injected so the proxy resolves the
 * SAME profiles the RPC data plane sees.
 */
export function createOpenAiProxySeam(
  fs: Fsys,
  options: {
    alias: SidecarAliasSeam;
    store: ProfileStore;
    lmEnv: LmStudioEnv;
    selection?: AdapterSelection;
    activation: SidecarActivationSeam | null;
    now?: () => string;
  },
): OpenAiProxySeam {
  const now = options.now ?? (() => new Date().toISOString());
  const upstream: ProxyUpstream =
    options.selection === 'mock'
      ? createMockChatUpstream()
      : { open: (body, signal) => restOpenAiChatStream(options.lmEnv, body, { signal }) };
  const session = createSessionLock({
    ttlMs: () => {
      try {
        return options.alias.readAliases()?.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
      } catch {
        return DEFAULT_SESSION_TTL_MS;
      }
    },
    now,
  });
  const ports: ProxyPorts = {
    aliases: options.alias,
    store: options.store,
    upstream,
    session,
    activation:
      options.activation === null
        ? null
        : {
            runtime: options.activation.runtime,
            lock: options.activation.lock,
            runner: options.activation.runner,
          },
    now,
  };
  return {
    handleChatCompletions: (requestValue, sessionId, release, signal) =>
      handleChatCompletions(ports, requestValue, sessionId, release, signal),
    handleListModels: () => handleListModels(ports),
  };
}

/** All seams wired from one env; null means the method is unsupported. */
export interface SidecarSeams {
  modelContext: SidecarModelContextSeam | null;
  recommendation: SidecarRecommendationSeam | null;
  benchmark: SidecarBenchmarkSeam | null;
  optimization: SidecarOptimizationSeam | null;
  activation: SidecarActivationSeam | null;
}
/**
 * The model-first optimization workspace seam (M7-005). It composes the
 * already-wired recommendation, benchmark, activation-estimate and profile
 * stores into Core's ordering service; no UI or Rust business rules are added.
 */
export function createSidecarOptimizationSeam(
  fs: Fsys,
  options: SidecarSeamOptions,
  dependencies: {
    recommendation: SidecarRecommendationSeam;
    benchmark: SidecarBenchmarkSeam;
    activation: SidecarActivationSeam;
    profiles: ProfileStore;
  },
): SidecarOptimizationSeam {
  const now = options.now ?? (() => new Date().toISOString());
  const defaults: ProfileDefaultStore = createProfileDefaultStore({
    fs,
    path: `${options.rootDir}/profile-defaults.json`,
    now,
    profileExists: (profileId, modelKey, taskType) => {
      try {
        const profile = dependencies.profiles.get(profileId);
        return profile.model.modelKey === modelKey && profile.task.type === taskType;
      } catch {
        return false;
      }
    },
  });
  const preflight: OptimizationPreflightPort = {
    async check(profile) {
      // Reachability and estimate are safety checks only; BenchmarkService owns
      // the later load/measure/restore transaction.
      await dependencies.activation.runtime.getActiveState();
      await dependencies.activation.estimate.estimate(profile);
    },
  };
  return {
    service: createOptimizationLoopService({
      recommendation: dependencies.recommendation.service,
      benchmark: dependencies.benchmark.service,
      preflight,
      profiles: dependencies.profiles,
      defaults,
      now,
    }),
  };
}
