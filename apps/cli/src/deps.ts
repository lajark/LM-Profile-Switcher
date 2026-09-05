/**
 * Production wiring for the CLI — with `index.ts` the only module allowed to
 * touch `node:` or `process.`. `createDefaultDeps()` builds the real ProfileStore,
 * the file language store, the i18n service over the shipped locale resources,
 * the default hardware probe env, and the three read ports (models / current /
 * snapshot) on the LM Studio adapter router (M1-003). The activation runtime for
 * `apply` stays null until M1-005 production wiring; it honestly reports
 * capability unsupported (6) meanwhile.
 */
import { captureSnapshot, type RunnerContext } from '@lmps/core';
import { createDefaultProbeEnv } from '@lmps/hardware';
import { createI18n, loadResourceFiles, normalizeLocale, type Locale } from '@lmps/i18n';
import {
  createNodeLmStudioEnv,
  isLmStudioError,
  probeCapabilities,
  resolveAdapters,
  resolveBaseUrl,
  type AdapterBundle,
  type LmStudioEnv,
} from '@lmps/lmstudio-adapter';
import { createDefaultFsys, createDefaultProfileStore, type ProfileStore } from '@lmps/profile-store';
import { join } from 'node:path';

import { createFileLanguageStore } from './config.js';
import { CliError, lmUnreachable } from './errors.js';
import type { CliDeps } from './seams.js';

export interface DefaultDepsOptions {
  rootDir?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
}

/** `LMPS_HOME` wins; otherwise `~/.lmps`. The root may hold passthrough secrets → LOCAL-ONLY. */
export function resolveRootDir(options: DefaultDepsOptions = {}): string {
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

  const lmPorts = createLmStudioCliPorts(store, { env });

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
    // The activation runtime needs the M1-005 production wiring (task f); it
    // stays unwired, so `apply` honestly reports capability unsupported (6).
    activation: null,
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

  async function bundle(): Promise<AdapterBundle> {
    const probe = await probeCapabilities(lmEnv);
    return resolveAdapters(lmEnv, probe);
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