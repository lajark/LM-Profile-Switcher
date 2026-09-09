/**
 * Capability probe (M0-005, PRD FR-03): turns "the docs say LM Studio supports
 * X" into "this host, through this adapter, supports X today". Output is a
 * two-segment record:
 *
 * 1. `matrices` — domain-contract rows (`packages/domain/capability.ts`), one
 *    per adapter source. `exact`/`degraded`/`unavailable` describe what THIS
 *    adapter can apply precisely today; anything not yet evidenced by the host
 *    reads `unknown` (never silently claimed).
 * 2. `ops` — LOCAL-ONLY operational segment (reachability, observed endpoint
 *    latency, errors) that never enters the domain schema; the scripts redact
 *    it before writing any record.
 *
 * Probe order: REST (loopback HTTP, primary) → CLI (`lms`) → SDK (guarded
 * import). Results are cached per base URL with a TTL for CLI/doctor reuse.
 */
import { SCHEMA_VERSION } from '@lmps/domain';
import type { CapabilityEntry, CapabilityMatrix } from '@lmps/domain';

import { createCliAdapter } from './cli/cli-adapter.js';
import type { LmStudioEnv } from './env.js';
import { describeError } from './errors.js';
import type { LmSubsystem } from './errors.js';
import { REST_MODELS_PATH, restListModels } from './rest/v1.js';
import { probeSdk } from './sdk/sdk-adapter.js';

/** Runtime knobs the REST v1 load body maps directly (rest/v1.ts). */
const REST_MAPPED_RUNTIME_FIELDS = new Set([
  'runtime.contextLength',
  'runtime.gpuOffload',
  'runtime.evalBatchSize',
  'runtime.flashAttention',
  'runtime.offloadKvCacheToGpu',
  'runtime.numExperts',
]);

export const RUNTIME_CAPABILITY_FIELDS = [
  'runtime.contextLength',
  'runtime.gpuOffload',
  'runtime.evalBatchSize',
  'runtime.flashAttention',
  'runtime.offloadKvCacheToGpu',
  'runtime.kCacheQuantization',
  'runtime.vCacheQuantization',
  'runtime.ropeFrequencyBase',
  'runtime.ropeFrequencyScale',
  'runtime.tryMmap',
  'runtime.keepModelInMemory',
  'runtime.numExperts',
  'runtime.parallelSlots',
] as const;

export const OPERATION_CAPABILITY_FIELDS = [
  'ops.discoverModels',
  'ops.readEffectiveConfig',
  'ops.load',
  'ops.unload',
  'ops.healthCheck',
  'ops.restore',
  'ops.inference',
] as const;

export const DEFAULT_PROBE_TTL_SECONDS = 300;

export interface ObservedCall {
  source: LmSubsystem;
  endpoint: string;
  ok: boolean;
  ms: number;
  note: string;
}

/** Operational (LOCAL-ONLY) probe segment — never part of the domain schema. */
export interface ProbeOps {
  restReachable: boolean;
  lmsAvailable: boolean;
  sdkAvailable: boolean;
  restBaseUrl: string;
  lmStudioVersion: string | null;
  engineVersion: string | null;
  observed: ObservedCall[];
  probedAt: string;
}

export interface CapabilityProbeOptions {
  ttlSeconds?: number;
  /** Ignore the TTL cache and probe live. */
  force?: boolean;
  now?: () => string;
}

export interface CapabilityProbeResult {
  matrices: CapabilityMatrix[];
  ops: ProbeOps;
  cached: boolean;
  expiresAt: string;
}

/**
 * A synthetic probe for the explicit mock path (LMPS_ADAPTER=mock): every field
 * reads as nobody-reachable so it never serializes into a matrix, and the
 * adapter router ignores it entirely under `selection: 'mock'`. Its purpose is
 * purely to satisfy the type without ever touching REST or `lms` on the host.
 */
export function mockProbeResult(baseUrl: string, nowIso: string): CapabilityProbeResult {
  return {
    matrices: [],
    ops: {
      restReachable: false,
      lmsAvailable: false,
      sdkAvailable: false,
      restBaseUrl: baseUrl,
      lmStudioVersion: null,
      engineVersion: null,
      observed: [],
      probedAt: nowIso,
    },
    cached: false,
    expiresAt: nowIso,
  };
}

const probeCache = new Map<string, { expiresAt: string; result: CapabilityProbeResult }>();

export function clearProbeCache(): void {
  probeCache.clear();
}

export async function probeCapabilities(
  env: LmStudioEnv,
  options: CapabilityProbeOptions = {},
): Promise<CapabilityProbeResult> {
  const now = options.now ?? env.now;
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_PROBE_TTL_SECONDS;
  const key = env.baseUrl;

  const cachedEntry = probeCache.get(key);
  if (!options.force && cachedEntry !== undefined && cachedEntry.expiresAt > now()) {
    return { ...cachedEntry.result, cached: true };
  }

  const result = await probeLive(env, now, ttlSeconds);
  const expiresAt = timestampAfter(now, ttlSeconds);
  probeCache.set(key, { expiresAt, result });
  return { ...result, expiresAt };
}

async function probeLive(env: LmStudioEnv, now: () => string, ttlSeconds: number): Promise<CapabilityProbeResult> {
  const probedAt = now();
  const observed: ObservedCall[] = [];

  // --- REST (primary) ---
  const restStart = env.nowMs();
  let restReachable = false;
  try {
    const models = await restListModels(env);
    restReachable = true;
    observed.push({
      source: 'rest',
      endpoint: REST_MODELS_PATH,
      ok: true,
      ms: Math.round(env.nowMs() - restStart),
      note: `listed ${models.length} model(s)`,
    });
  } catch (error) {
    observed.push({
      source: 'rest',
      endpoint: REST_MODELS_PATH,
      ok: false,
      ms: Math.round(env.nowMs() - restStart),
      note: describeError(error),
    });
  }

  // --- CLI (`lms`) ---
  const cli = createCliAdapter(env);
  let lmsAvailable = false;
  let cliLsOk = false;
  let lmStudioVersion: string | null = null;

  const statusStart = env.nowMs();
  try {
    const status = await cli.status();
    lmsAvailable = true;
    lmStudioVersion = status.version;
    observed.push({
      source: 'cli',
      endpoint: 'status',
      ok: true,
      ms: Math.round(env.nowMs() - statusStart),
      note: `server ${status.serverRunning ? 'running' : 'stopped'}${
        status.version === null ? '' : ` · v${status.version}`
      }`,
    });
  } catch (error) {
    observed.push({
      source: 'cli',
      endpoint: 'status',
      ok: false,
      ms: Math.round(env.nowMs() - statusStart),
      note: describeError(error),
    });
  }

  if (lmsAvailable) {
    const lsStart = env.nowMs();
    try {
      const keys = await cli.listModels();
      cliLsOk = true;
      observed.push({
        source: 'cli',
        endpoint: 'ls --json',
        ok: true,
        ms: Math.round(env.nowMs() - lsStart),
        note: `listed ${keys.length} model(s)`,
      });
    } catch (error) {
      observed.push({
        source: 'cli',
        endpoint: 'ls --json',
        ok: false,
        ms: Math.round(env.nowMs() - lsStart),
        note: describeError(error),
      });
    }
  }

  // --- SDK (guarded import; no network in this probe) ---
  const sdk = await probeSdk();
  if (!sdk.installed) {
    observed.push({
      source: 'sdk',
      endpoint: 'import @lmstudio/sdk',
      ok: false,
      ms: 0,
      note: sdk.note,
    });
  } else {
    observed.push({
      source: 'sdk',
      endpoint: 'import @lmstudio/sdk',
      ok: true,
      ms: 0,
      note: sdk.note,
    });
  }

  const ops: ProbeOps = {
    restReachable,
    lmsAvailable,
    sdkAvailable: sdk.installed,
    restBaseUrl: env.baseUrl,
    lmStudioVersion,
    engineVersion: null,
    observed,
    probedAt,
  };

  return {
    matrices: [
      buildRestMatrix(probedAt, ttlSeconds, restReachable),
      buildCliMatrix(probedAt, ttlSeconds, lmsAvailable, cliLsOk),
      buildSdkMatrix(probedAt, ttlSeconds, sdk.installed),
    ],
    ops,
    cached: false,
    expiresAt: timestampAfter(now, ttlSeconds),
  };
}

function matrixFor(adapter: CapabilityMatrix['adapter'], probedAt: string, ttlSeconds: number, capabilities: CapabilityEntry[]): CapabilityMatrix {
  return {
    schemaVersion: SCHEMA_VERSION,
    adapter,
    probedAt,
    cacheTtlSeconds: ttlSeconds,
    capabilities,
  };
}

function runtimeEntries(support: CapabilityEntry['support'], mappedSupport: CapabilityEntry['support'], note: string | null): CapabilityEntry[] {
  return RUNTIME_CAPABILITY_FIELDS.map((field) => {
    const mapped = REST_MAPPED_RUNTIME_FIELDS.has(field);
    return {
      field,
      support: mapped ? mappedSupport : support,
      ...(note === null ? {} : { note }),
    };
  });
}

function buildRestMatrix(probedAt: string, ttlSeconds: number, reachable: boolean): CapabilityMatrix {
  const opSupport = reachable ? 'exact' : 'unavailable';
  const capabilities: CapabilityEntry[] = [
    ...OPERATION_CAPABILITY_FIELDS.map((field): CapabilityEntry => ({
      field,
      support: opSupport,
      ...(reachable ? {} : { note: 'REST v1 unreachable' }),
    })),
    ...runtimeEntries('unknown', 'unknown', reachable ? 'mapped to REST v1 load body; host echo unverified' : 'REST v1 unreachable'),
  ];
  return matrixFor('rest', probedAt, ttlSeconds, capabilities);
}

function buildCliMatrix(probedAt: string, ttlSeconds: number, lmsAvailable: boolean, lsOk: boolean): CapabilityMatrix {
  if (!lmsAvailable) {
    return matrixFor('cli', probedAt, ttlSeconds, [
      ...OPERATION_CAPABILITY_FIELDS.map((field): CapabilityEntry => ({
        field,
        support: 'unavailable',
        note: 'lms binary not usable',
      })),
      ...runtimeEntries('unknown', 'unknown', 'lms binary not usable'),
    ]);
  }
  const capabilities: CapabilityEntry[] = [
    { field: 'ops.discoverModels', support: lsOk ? 'exact' : 'unknown', note: lsOk ? undefined : 'ls --json failed' },
    ...OPERATION_CAPABILITY_FIELDS.filter((field) => field !== 'ops.discoverModels').map((field): CapabilityEntry => ({
      field,
      support: 'unavailable',
      note: 'write paths live in the REST adapter; estimate lands in the CLI adapter (M1-006)',
    })),
    ...runtimeEntries('unavailable', 'unavailable', 'CLI adapter applies no runtime fields'),
  ];
  return matrixFor('cli', probedAt, ttlSeconds, capabilities);
}

function buildSdkMatrix(probedAt: string, ttlSeconds: number, installed: boolean): CapabilityMatrix {
  const capabilities: CapabilityEntry[] = [
    ...OPERATION_CAPABILITY_FIELDS.map((field): CapabilityEntry => ({
      field,
      support: installed ? 'unknown' : 'unavailable',
      ...(installed ? { note: 'exports verified; live RPC not yet exercised' } : { note: '@lmstudio/sdk not installed' }),
    })),
    ...runtimeEntries('unknown', 'unknown', installed ? 'exports verified; live RPC not yet exercised' : '@lmstudio/sdk not installed'),
  ];
  return matrixFor('sdk', probedAt, ttlSeconds, capabilities);
}

/**
 * Expiry instant as an ISO string. The adapter is the host layer (Node is
 * allowed here — unlike packages/core), so `Date.parse` gives a deterministic
 * expiry from the injected clock.
 */
function timestampAfter(now: () => string, seconds: number): string {
  const ms = Date.parse(now());
  if (Number.isNaN(ms)) return now();
  return new Date(ms + seconds * 1000).toISOString();
}