/**
 * Sidecar RPC handlers (spike M0-006 + M3-002 data plane). Built on the real
 * @lmps chain: adapter probe (probeCapabilities -> resolveAdapters), hardware
 * probe, settings persistence, and the desktop profile/optimize/benchmark data
 * plane. PURE module — no Node built-in imports — so it fits the esbuild-inlined
 * Node SEA bundle and the vitest unit tests alike.
 *
 * The LM token is a SECRET: it arrives only as an env value in
 * SidecarHandlerOptions and is handed straight to createNodeLmStudioEnv. It
 * never appears in frames, logs, or results of this module.
 *
 * Error contract (M3-002): typed failures are thrown as RpcMethodError with a
 * stable code the Dispatcher forwards verbatim; anything unexpected collapses to
 * INTERNAL so the existing handler behavior (settings.setLocale) is unchanged.
 */
import {
  calibrateEstimate,
  isActivationError,
  isBenchmarkError,
  type ActivationRunResult,
  type CalibrationVerdict,
} from '@lmps/core';
import {
  describeHookRules,
  describeVirtualAliases,
  isDomainError,
  matchHookRule,
  TASK_KINDS,
  type BenchmarkResult,
  type Candidate,
  type CompositeProfile,
  type Recommendation,
} from '@lmps/domain';
import { createDefaultProbeEnv, probeHardware, redactDiagnostics } from '@lmps/hardware';
import {
  DEFAULT_LOCALE,
  normalizeLocale,
  type Locale,
  type ResourceKey,
  type TranslationFunction,
} from '@lmps/i18n';
import {
  createNodeLmStudioEnv,
  isLmStudioError,
  probeCapabilities,
  resolveAdapters,
} from '@lmps/lmstudio-adapter';
import {
  createDefaultFsys,
  createDefaultProfileStore,
  isProfileStoreError,
  writeFileAtomic,
  type Fsys,
  type ProfileStore,
} from '@lmps/profile-store';
import { LMStudioClient } from '@lmstudio/sdk';

import { RpcMethodError, type Handlers, type SingleHandler, type StreamHandler } from './protocol.js';
import { translateFor } from './tray-i18n.js';
import type {
  SidecarActivationSeam,
  SidecarAliasSeam,
  SidecarBenchmarkSeam,
  SidecarHookSeam,
  SidecarRecommendationSeam,
} from './wiring.js';

export interface SidecarHandlerOptions {
  lmBaseUrl: string | undefined;
  lmToken: string | null;
  lmsBin: string | undefined;
  /**
   * Root directory holding `<rootDir>/config.json` (settings shared with the
   * CLI) and the profile store. When absent the desktop may still switch the
   * language for the session, but it is not persisted and profiles stay
   * unsupported.
   */
  rootDir?: string;
  /** Profile store; defaults to createDefaultProfileStore(rootDir). */
  store?: ProfileStore;
  /** Recommendation seam; null (default) makes optimize.* report METHOD_UNSUPPORTED. */
  recommendation?: SidecarRecommendationSeam | null;
  /** Benchmark seam; null (default) makes benchmark.run report METHOD_UNSUPPORTED. */
  benchmark?: SidecarBenchmarkSeam | null;
  /**
   * Activation seam (M3-003); null (default) makes activation.* and tray.menu
   * report METHOD_UNSUPPORTED / render the menu without a current state.
   */
  activation?: SidecarActivationSeam | null;
  /**
   * Hook seam (M4-001); null (default) makes hook.* report METHOD_UNSUPPORTED.
   */
  hook?: SidecarHookSeam | null;
  /**
   * Virtual-alias seam (M4-002); null (default) makes aliases.status report
   * METHOD_UNSUPPORTED.
   */
  alias?: SidecarAliasSeam | null;
  /**
   * File system for the language store (shared <rootDir>/config.json). Tests
   * inject the memory FakeFs; production keeps the Node Fsys default.
   */
  fs?: Fsys;
  /** Clock for save/session stamps; defaults to wall-clock ISO. */
  now?: () => string;
}

/** Adapter failure kinds that mean "the LM Studio host is not serving us". */
const LM_REACHABILITY_KINDS = new Set<string>(['unreachable', 'timeout', 'auth']);

/** Normalizes any handler failure into a typed RpcMethodError with a stable code. */
function toRpcMethodError(error: unknown): RpcMethodError {
  if (error instanceof RpcMethodError) return error;
  if (isProfileStoreError(error)) return new RpcMethodError(error.code, error.message);
  if (isActivationError(error)) return new RpcMethodError(error.code, error.message);
  if (isBenchmarkError(error)) return new RpcMethodError(error.code, error.message);
  if (isDomainError(error)) return new RpcMethodError('PROFILE_INVALID', error.message);
  if (isLmStudioError(error) && LM_REACHABILITY_KINDS.has(error.kind)) {
    return new RpcMethodError('LM_UNREACHABLE', `LM Studio unreachable (${error.kind})`);
  }
  return new RpcMethodError('INTERNAL', error instanceof Error ? error.message : String(error));
}

/** Catch-and-tag wrapper: the awaited work's failures become typed RPC errors. */
async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw toRpcMethodError(error);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function paramProfileId(params: Record<string, unknown>): string {
  const value = params['profileId'];
  if (typeof value !== 'string') {
    throw new RpcMethodError('STORE_INVALID_ID', 'missing or non-string profileId');
  }
  return value;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? Math.trunc(value) : Number.NaN;
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function reasonOf(signal: AbortSignal): Error {
  const reason = signal.reason;
  return reason instanceof Error ? reason : new Error('canceled');
}

/** Unique profileIds referenced by a rules document, in first-appearance order. */
function uniqueRuleProfileIds(document: {
  rules: ReadonlyArray<{ profileId: string }>;
}): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const rule of document.rules) {
    if (!seen.has(rule.profileId)) {
      seen.add(rule.profileId);
      ids.push(rule.profileId);
    }
  }
  return ids;
}

/** Resource calibration projection shape exposed to the desktop view. */
export interface CalibrationProjection {
  measuredPeakBytes: number | null;
  /** Per-candidate advisory verdicts keyed by candidate id; empty when unmeasured. */
  candidates: Array<{ candidateId: string; verdict: CalibrationVerdict }>;
}

/**
 * M6-002: compare candidate estimates against synchronized resource evidence.
 * Legacy memoryPeakBytes is retained for display but produces an unavailable
 * verdict that explicitly requires a re-benchmark.
 */
function buildCalibrationProjection(
  baseline: CompositeProfile,
  recommendation: Recommendation,
): CalibrationProjection {
  const validation = baseline.validation;
  const measuredPeakBytes = validation?.memoryPeakBytes ?? null;
  if (validation === undefined || (measuredPeakBytes === null && validation.resourceUsage === undefined)) {
    return { measuredPeakBytes: null, candidates: [] };
  }
  const asBenchmark = benchmarkFromValidation(validation);
  const candidates: CalibrationProjection['candidates'] = recommendation.candidates.map(
    (candidate: Candidate) => ({
      candidateId: candidate.id,
      verdict: calibrateEstimate(candidate.estimate, asBenchmark),
    }),
  );
  return { measuredPeakBytes, candidates };
}

function benchmarkFromValidation(validation: NonNullable<CompositeProfile['validation']>): BenchmarkResult {
  return {
    status: 'completed',
    metrics: {
      memoryPeakBytes: validation.memoryPeakBytes ?? null,
      resourceUsage: validation.resourceUsage,
    },
  } as BenchmarkResult;
}

// ---------------------------------------------------------------------------
// Settings mirror of the CLI's apps/cli/src/config.ts createFileLanguageStore.
// Kept local (rather than importing CLI internals) so both hosts share the same
// <rootDir>/config.json `{ "locale": ... }` format through the same atomic
// writer; the desktop and CLI write the same file (last write wins, never corrupt).
// ---------------------------------------------------------------------------

function languageConfigPath(rootDir: string): string {
  return `${rootDir}/config.json`;
}

interface SidecarLanguageStore {
  /** Missing file → null; a corrupt file throws (surfaced as an RPC error). */
  get(): Locale | null;
  set(locale: Locale): void;
}

function createSidecarLanguageStore(rootDir: string, fs: Fsys): SidecarLanguageStore {
  const path = languageConfigPath(rootDir);
  return {
    get() {
      if (!fs.exists(path)) return null;
      const parsed = JSON.parse(fs.readFileUtf8(path)) as { locale?: unknown };
      if (parsed.locale === undefined || typeof parsed.locale !== 'string') return null;
      return normalizeLocale(parsed.locale);
    },
    set(locale) {
      writeFileAtomic(fs, path, `${JSON.stringify({ locale }, null, 2)}\n`, 1);
    },
  };
}

/** Abortable sleep returning normally on completion, rejecting on cancel. */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(reasonOf(signal));
      return;
    }
    const timer = setTimeout(done, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(reasonOf(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    function done(): void {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }
  });
}

// ---------------------------------------------------------------------------
// Tray menu spec (M3-003): one data shape the Rust shell renders. SpecItem ids
// carry the action contract — `apply:<profileId>` routes to activation.apply,
// `open`/`quit`/`unload` route to their own commands. All user-visible labels
// come from the locale resources, never from Rust.
// ---------------------------------------------------------------------------

export interface TraySpecItem {
  id: string;
  label: string;
  kind: 'separator' | 'status' | 'item';
  disabled?: boolean;
  checked?: boolean;
}

export interface TrayMenuSpec {
  locale: Locale;
  /** Menu shown between operations; `apply:<id>` items are live actions. */
  idle: TraySpecItem[];
  /**
   * Menu the shell swaps in locally while an apply is in flight (no stdio
   * round-trip mid-run). Actions are the same ids but greyed out; `open` and
   * `quit` stay live so a long apply never traps the user.
   */
  busy: TraySpecItem[];
}

/** Reenactment of the current host state in one of three renderable shapes. */
export type TrayActiveLine =
  | { kind: 'active'; active: { profileId: string | null; modelKey: string | null; since: string | null } }
  | { kind: 'none' }
  | { kind: 'unreachable' };

interface BuildTraySpecInput {
  locale: Locale;
  t: TranslationFunction;
  profiles: CompositeProfile[];
  activeLine: TrayActiveLine;
  /** Last tray activation/unload failure code, rendered as a status row. */
  failure: { code: string; at: string } | null;
}

/** Recent section size: the top updatedAt-wise profiles get their own row. */
const TRAY_RECENT_LIMIT = 5;

/** The familiar "current" row travels as the first (or second) status line. */
const TRAY_FAILURE_LABEL_KEYS: Record<string, ResourceKey> = {
  LM_UNREACHABLE: 'tray.error.unreachable',
  ACTIVATION_LOCK_BUSY: 'tray.error.lockBusy',
  ACTIVATION_CANCELED: 'tray.error.canceled',
};

/** Locale-first display name; falls back to en then zh-CN then the raw id. */
function trayDisplayName(profile: CompositeProfile, locale: Locale): string {
  return profile.displayName[locale] ?? profile.displayName.en ?? profile.displayName['zh-CN'] ?? profile.id;
}

function trayIsActive(profile: CompositeProfile, line: TrayActiveLine): boolean {
  if (line.kind !== 'active') return false;
  const { profileId, modelKey } = line.active;
  if (profileId !== null) return profileId === profile.id;
  // The demo mock never reports a profileId; match by model identity instead.
  return modelKey !== null && modelKey === profile.model.modelKey;
}

function byUpdatedDesc(a: CompositeProfile, b: CompositeProfile): number {
  return (b.metadata?.updatedAt ?? '').localeCompare(a.metadata?.updatedAt ?? '');
}

function specItems(
  profiles: CompositeProfile[],
  locale: Locale,
  activeLine: TrayActiveLine,
  disabled: boolean,
): TraySpecItem[] {
  return profiles.map((profile) => ({
    id: `apply:${profile.id}`,
    label: trayDisplayName(profile, locale),
    kind: 'item' as const,
    disabled,
    checked: trayIsActive(profile, activeLine),
  }));
}

/**
 * Pure spec builder (exported for unit tests). The result carries exactly the
 * shape the Rust shell renders with zero business or i18n logic on its side.
 */
export function buildTraySpec(input: BuildTraySpecInput): TrayMenuSpec {
  const { locale, t, profiles, activeLine, failure } = input;

  const byRecent = [...profiles].sort(byUpdatedDesc);
  const recent = byRecent.slice(0, TRAY_RECENT_LIMIT);
  const rest = byRecent.slice(TRAY_RECENT_LIMIT);

  const statusItems: TraySpecItem[] = [];
  if (failure !== null) {
    const key = TRAY_FAILURE_LABEL_KEYS[failure.code] ?? 'tray.error.stepFailed';
    statusItems.push({ id: 'notice', label: t('tray.status.failed', { reason: t(key) }), kind: 'status' });
  }
  if (activeLine.kind === 'unreachable') {
    statusItems.push({ id: 'status-unreachable', label: t('tray.status.unreachable'), kind: 'status' });
  } else if (activeLine.kind === 'active') {
    const match = profiles.find((profile) => trayIsActive(profile, activeLine));
    const name =
      match !== undefined ? trayDisplayName(match, locale) : (activeLine.active.modelKey ?? '');
    statusItems.push({ id: 'status', label: t('tray.status.currentActive', { name }), kind: 'status' });
  } else {
    statusItems.push({ id: 'status', label: t('tray.status.currentNone'), kind: 'status' });
  }

  const activeForMenu = activeLine.kind === 'active';
  const idle: TraySpecItem[] = [...statusItems, { id: 'sep-status', label: '', kind: 'separator' }];
  const busy: TraySpecItem[] = [
    { id: 'status', label: t('tray.status.busy'), kind: 'status' },
    { id: 'sep-status', label: '', kind: 'separator' },
  ];
  // Section headers are disabled status items so they render as labels.
  const pushSections = (into: TraySpecItem[], disabled: boolean): void => {
    if (recent.length > 0) {
      into.push({ id: 'section-recent', label: t('tray.section.recent'), kind: 'status', disabled: true });
      into.push(...specItems(recent, locale, activeLine, disabled));
    }
    if (rest.length > 0) {
      into.push({ id: 'section-all', label: t('tray.section.all'), kind: 'status', disabled: true });
      into.push(...specItems(rest, locale, activeLine, disabled));
    }
  };
  pushSections(idle, false);
  pushSections(busy, true);
  // The busy tail keeps `open`/`quit` live so a long apply never traps the
  // user (window hidden by minimize-to-tray, only Open brings it back).
  idle.push(
    { id: 'sep-actions', label: '', kind: 'separator' },
    { id: 'unload', label: t('tray.action.unload'), kind: 'item', disabled: !activeForMenu },
    { id: 'sep-open', label: '', kind: 'separator' },
    { id: 'open', label: t('tray.action.open'), kind: 'item' },
    { id: 'quit', label: t('tray.action.quit'), kind: 'item' },
  );
  busy.push(
    { id: 'sep-actions', label: '', kind: 'separator' },
    { id: 'unload', label: t('tray.action.unload'), kind: 'item', disabled: true },
    { id: 'sep-open', label: '', kind: 'separator' },
    { id: 'open', label: t('tray.action.open'), kind: 'item' },
    { id: 'quit', label: t('tray.action.quit'), kind: 'item' },
  );

  return { locale, idle, busy };
}

export function createHandlers(options: SidecarHandlerOptions): Handlers {
  const env = createNodeLmStudioEnv({
    baseUrl: options.lmBaseUrl,
    token: options.lmToken,
    lmsBin: options.lmsBin,
  });

  // Same <rootDir>/config.json the CLI writes, so desktop and CLI share one
  // settings file (last write wins; the atomic writer never leaves a corrupt
  // file). Falls back to session-only when no rootDir is configured.
  const fs = options.fs ?? createDefaultFsys();
  const languageStore =
    options.rootDir !== undefined
      ? createSidecarLanguageStore(options.rootDir, fs)
      : null;

  // The desktop data plane (M3-002): a real store on rootDir unless injected.
  const store = (options.store ?? (options.rootDir !== undefined ? createDefaultProfileStore(options.rootDir) : null));
  const recommendation = options.recommendation ?? null;
  const benchmark = options.benchmark ?? null;
  const activation = options.activation ?? null;
  const hook = options.hook ?? null;
  const alias = options.alias ?? null;
  const now = options.now ?? (() => new Date().toISOString());

  // The last activation/unload failure, kept session-scoped so the tray menu
  // can keep showing why the previous tray action failed even after the window
  // banner is gone (menu status-line + frontend banner, zero new dependencies).
  let lastTrayFailure: { code: string; at: string } | null = null;

  function requireStore(): ProfileStore {
    if (store === null) {
      throw new RpcMethodError('METHOD_UNSUPPORTED', 'profile store is not wired');
    }
    return store;
  }

  function requireRecommendation(): SidecarRecommendationSeam {
    if (recommendation === null) {
      throw new RpcMethodError('METHOD_UNSUPPORTED', 'optimize is not wired');
    }
    return recommendation;
  }

  function requireBenchmark(): SidecarBenchmarkSeam {
    if (benchmark === null) {
      throw new RpcMethodError('METHOD_UNSUPPORTED', 'benchmark is not wired');
    }
    return benchmark;
  }

  function requireActivation(): SidecarActivationSeam {
    if (activation === null) {
      throw new RpcMethodError('METHOD_UNSUPPORTED', 'activation is not wired');
    }
    return activation;
  }

  function requireHook(): SidecarHookSeam {
    if (hook === null) {
      throw new RpcMethodError('METHOD_UNSUPPORTED', 'hook is not wired');
    }
    return hook;
  }

  function requireAlias(): SidecarAliasSeam {
    if (alias === null) {
      throw new RpcMethodError('METHOD_UNSUPPORTED', 'aliases are not wired');
    }
    return alias;
  }

  /** Surfaces an activation outcome as the tray's remembered failure notice. */
  function recordOutcome(result: ActivationRunResult): void {
    const status = result.outcome.status;
    if (status === 'active') {
      lastTrayFailure = null;
      return;
    }
    const code =
      status === 'canceled'
        ? 'ACTIVATION_CANCELED'
        : (result.transaction.errors[0]?.code ?? 'ACTIVATION_STEP_FAILED');
    lastTrayFailure = { code, at: now() };
  }

  /** Surfaces an activation RPC exception as the tray's remembered failure. */
  function recordOnlyFailure(error: unknown): void {
    lastTrayFailure = { code: toRpcMethodError(error).rpcCode, at: now() };
  }

  const single: Record<string, SingleHandler> = {
    ping: async () => ({ pong: true, ts: new Date().toISOString() }),

    echo: async (params) => ({ echoed: params['text'] ?? null }),

    cancelable: async (params, signal) => {
      const delayMs = clampInt(params['delayMs'], 1000, 1, 30_000);
      try {
        await abortableSleep(delayMs, signal);
        return { completed: true };
      } catch {
        return { canceled: true };
      }
    },

    /** Probe the LM Studio instance for its capability matrices + ops record. */
    probeCapabilities: async () => {
      const probe = await probeCapabilities(env, { force: true });
      return { matrices: probe.matrices, ops: probe.ops, cached: probe.cached, expiresAt: probe.expiresAt };
    },

    /**
     * Full adapter chain against a live instance: capability probe,
     * adapter router selection, then a real discovery call (model list).
     */
    adapterProbe: async () => {
      const probe = await probeCapabilities(env, { force: true });
      const bundle = resolveAdapters(env, probe);
      const models = await bundle.discovery.listModels();
      const names = models.map((model) => model.modelKey);
      return { matrices: probe.matrices, ops: probe.ops, modelCount: names.length, models: names };
    },

    /** Machine profile (redacted so a LOCAL-ONLY report stays safe locally). */
    hardware: async () => {
      const profile = await probeHardware(createDefaultProbeEnv());
      return { profile: JSON.parse(redactDiagnostics(JSON.stringify(profile))) as unknown };
    },

    /** Static SDK import availability inside the bundle / SEA. */
    sdkInfo: async () => ({
      installed: true,
      specifier: '@lmstudio/sdk',
      hasClientExport: typeof LMStudioClient === 'function',
    }),

    /** Settings this shell persists in <rootDir>/config.json (desktop M3-001). */
    'settings.getLocale': async () => ({ locale: languageStore?.get() ?? null }),

    'settings.setLocale': async (params) => {
      const raw = typeof params['locale'] === 'string' ? params['locale'] : null;
      const locale = normalizeLocale(raw);
      if (locale === null) throw new Error(`unsupported locale: ${String(raw)}`);
      languageStore?.set(locale);
      return { ok: true, locale };
    },

    // ------------------------------------------------------------------
    // Desktop data plane (M3-002): profiles / optimize / benchmark
    // ------------------------------------------------------------------

    'profiles.meta': async () => ({ taskKinds: [...TASK_KINDS] }),

    'profiles.list': async () =>
      guard(async () => {
        const profiles = requireStore()
          .list()
          .map((profile) => ({
            id: profile.id,
            displayName: profile.displayName,
            model: {
              modelKey: profile.model.modelKey,
              family: profile.model.family ?? null,
              quantization: profile.model.quantization ?? null,
            },
            task: { type: profile.task.type, kind: profile.task.kind ?? null },
            updatedAt: profile.metadata.updatedAt,
          }));
        return { profiles };
      }),

    /** Sanitized full document (tokens → null) for the editor's JSON preview. */
    'profiles.show': async (params) =>
      guard(async () => {
        const text = requireStore().exportJson(params['id'] as string);
        return { profile: JSON.parse(text) as unknown };
      }),

    'profiles.create': async (params) =>
      guard(async () => {
        const body = params['profile'];
        if (!isRecord(body)) throw new RpcMethodError('PROFILE_INVALID', 'profile must be a JSON object');
        // Zod validates the boundary payload inside create(); the cast only
        // admits the object shape the JSON wire already proves.
        const created = requireStore().create(body as CompositeProfile);
        return { id: created.id };
      }),

    'profiles.update': async (params) =>
      guard(async () => {
        const id = params['id'];
        const patch = params['patch'];
        if (!isRecord(patch)) throw new RpcMethodError('PROFILE_INVALID', 'patch must be a JSON object');
        // The store's patch type forbids id (immutable); the JSON wire already
        // proved the object shape, so the cast only admits the patch contract.
        const updated = requireStore().update(id as string, patch as Partial<CompositeProfile> & { id?: never });
        return { id: updated.id };
      }),

    'profiles.delete': async (params) =>
      guard(async () => {
        const id = params['id'];
        requireStore().delete(id as string);
        return { id };
      }),

    /**
     * M6-002: advisory per-candidate calibration projection. Compares each
     * candidate's load estimate against complete synchronized resource evidence;
     * legacy or partial evidence is surfaced as requiring a re-benchmark.
     */
    'optimize.preview': async (params, signal) =>
      guard(async () => {
        const seam = requireRecommendation();
        const baseline = requireStore().get(paramProfileId(params));
        const recommendation = await seam.service.recommend(baseline, { signal });
        return { recommendation, calibration: buildCalibrationProjection(baseline, recommendation) };
      }),

    /**
     * Re-runs the optimizer and saves the head candidate as
     * `<id>-<ruleVersion>` with validation.source='rule-recommended' (the CLI
     * `--yes` policy, mirrored here because the service never persists).
     * Refuses when no candidate is safe or the head is only low-confidence.
     */
    'optimize.save': async (params, signal) =>
      guard(async () => {
        const seam = requireRecommendation();
        const baseline = requireStore().get(paramProfileId(params));
        const recommendation = await seam.service.recommend(baseline, { signal });
        if (recommendation.selectedIndex === null || recommendation.candidates.length === 0) {
          throw new RpcMethodError('OPTIMIZE_REFUSED', 'no-safe-candidate');
        }
        const head = recommendation.candidates[recommendation.selectedIndex];
        if (head === undefined || head.score.confidence !== 'high') {
          throw new RpcMethodError('OPTIMIZE_REFUSED', 'low-confidence');
        }
        const savedId = `${baseline.id}-${recommendation.ruleVersion}`;
        const timestamp = now();
        const saved: CompositeProfile = {
          ...head.profile,
          id: savedId,
          validation: { source: 'rule-recommended', testedAt: timestamp },
          metadata: { ...head.profile.metadata, createdAt: timestamp, updatedAt: timestamp },
        };
        // Duplicate id → STORE_ALREADY_EXISTS surfaces as-is; no rollback.
        const created = requireStore().create(saved);
        // M6-002: advisory calibration verdict for the saved (head) candidate.
        const projection = buildCalibrationProjection(baseline, recommendation);
        const headCalibration = projection.candidates.find((entry) => entry.candidateId === head.id)?.verdict;
        seam.audit({
          at: timestamp,
          baselineProfileId: baseline.id,
          appliedProfileId: created.id,
          taskKind: recommendation.taskKind,
          ruleVersion: recommendation.ruleVersion,
          confidence: head.score.confidence,
          candidateId: head.id,
          calibration: headCalibration,
        });
        return { appliedProfileId: created.id, recommendation, calibration: projection };
      }),

    /**
     * Bounded benchmark run (show-only by design: validated stays false so a
     * measurement never silently stamps a profile). Bounds are clamped by core:
     * samples [1,10], maxTokens [1,512]. Guard failures (battery/lock/preflight)
     * throw; measurement failures ride in the result's failed status.
     */
    'benchmark.run': async (params, signal) =>
      guard(async () => {
        const seam = requireBenchmark();
        const baseline = requireStore().get(paramProfileId(params));
        const result = await seam.service.run(baseline, {
          samples: typeof params['samples'] === 'number' ? params['samples'] : undefined,
          maxTokens: typeof params['maxTokens'] === 'number' ? params['maxTokens'] : undefined,
          allowBattery: params['allowBattery'] === true,
          signal,
        });
        return { result, validated: false };
      }),

    // ------------------------------------------------------------------
    // Activation + tray menu (M3-003): the same core runner and lock the CLI
    // apply uses, so tray and CLI produce the same transaction behavior.
    // ------------------------------------------------------------------

    /** What the host currently has loaded; null when no model is active. */
    'activation.status': async () =>
      guard(async () => {
        const seam = requireActivation();
        const state = await seam.runtime.getActiveState();
        const active =
          state.profileId === null && state.modelKey === null ? null : state;
        return { active };
      }),

    /**
     * Trays and the GUI share one apply contract: no `--yes` flag — a click IS
     * the explicit confirmation (the frontend asks before sending when a
     * different profile is active, mirroring the CLI prompt). Failed outcomes
     * are DATA (a failed transaction), not exceptions; exceptions surface lock
     * busy / unreachable / preflight and are forwarded verbatim.
     */
    'activation.apply': async (params, signal) => {
      try {
        return await guard(async () => {
          const seam = requireActivation();
          const id = params['id'];
          if (typeof id !== 'string') {
            throw new RpcMethodError('STORE_INVALID_ID', 'missing or non-string id');
          }
          const target = requireStore().get(id);
          // Reachability preflight mirrors the CLI's pre-`--yes` getActiveState
          // (commands/apply.ts): a dead host must surface LM_UNREACHABLE HERE —
          // the runner's validating stage would wrap the same failure into
          // ACTIVATION_PREFLIGHT, and tray/CLI must report the same thing.
          await seam.runtime.getActiveState();
          const result = await seam.runner.run(target, { signal });
          recordOutcome(result);
          return {
            outcome: result.outcome.status,
            alreadyActive: result.outcome.alreadyActive,
            transaction: result.transaction,
          };
        });
      } catch (error) {
        recordOnlyFailure(error);
        throw error;
      }
    },

    /**
     * Unload the current configuration. Idempotent: nothing active resolves as
     * { outcome: 'ok' } with null ids. The host is served under the shared
     * activation lock (apply/benchmark cannot interleave); every real unload
     * appends a redacted row to `<rootDir>/logs/unloads.ndjson`.
     */
    'activation.unload': async () => {
      try {
        return await guard(async () => {
          const seam = requireActivation();
          const active = await seam.runtime.getActiveState();
          if (active.profileId === null && active.modelKey === null) {
            return { profileId: null, modelKey: null, outcome: 'ok' };
          }
          const acquired = await seam.lock.acquire();
          if (!acquired) {
            throw new RpcMethodError('ACTIVATION_LOCK_BUSY', 'another activation is in progress');
          }
          try {
            await seam.runtime.unload();
            seam.auditUnload({
              at: now(),
              profileId: active.profileId,
              modelKey: active.modelKey,
              outcome: 'ok',
            });
            lastTrayFailure = null;
            return { profileId: active.profileId, modelKey: active.modelKey, outcome: 'ok' };
          } finally {
            await seam.lock.release();
          }
        });
      } catch (error) {
        recordOnlyFailure(error);
        throw error;
      }
    },

    /**
     * The tray menu as a data spec (ADR-0001: Rust renders opaque items, all
     * business + i18n lives here). `idle` is what the menu shows between
     * operations; `busy` is what the tray swaps in locally while a long apply
     * is in flight — so the shell never needs another stdio round-trip mid-run.
     * The current-profile row is read resiliently: when LM Studio is down the
     * menu still renders, with an explicit unreachable status line.
     */
    'tray.menu': async () =>
      guard(async () => {
        const locale = languageStore?.get() ?? DEFAULT_LOCALE;
        const t = translateFor(locale);
        const profiles = requireStore().list();

        let activeLine: TrayActiveLine = { kind: 'none' };
        if (activation !== null) {
          try {
            const state = await activation.runtime.getActiveState();
            activeLine =
              state.profileId === null && state.modelKey === null
                ? { kind: 'none' }
                : { kind: 'active', active: state };
          } catch (error) {
            const mapped = toRpcMethodError(error);
            if (mapped.rpcCode === 'LM_UNREACHABLE') {
              activeLine = { kind: 'unreachable' };
            } else {
              throw mapped;
            }
          }
        }

        return buildTraySpec({ locale, t, profiles, activeLine, failure: lastTrayFailure });
      }),

    // ------------------------------------------------------------------
    // Local hook (M4-001): rules mapping + deny-by-default switch, driven by
    // the same store + activation runner + lock as activation.apply.
    // ------------------------------------------------------------------

    /**
     * Hook readiness overview: whether rules are configured, the global switch,
     * the rules pack version/rule count, whether a persistent auth token exists,
     * and the unique profileIds the rules reference (so the CLI can validate
     * store existence without parsing the document itself).
     */
    'hook.status': async () =>
      guard(async () => {
        const seam = requireHook();
        const doc = seam.readRules();
        return {
          configured: doc !== null,
          enabled: doc === null ? false : doc.enabled,
          version: doc === null ? null : doc.version,
          ruleCount: doc === null ? 0 : doc.rules.length,
          tokenStored: seam.readToken() !== null,
          profileIds: doc === null ? [] : uniqueRuleProfileIds(doc),
        };
      }),

    /** The rules document summary (human + machine readable); never the token. */
    'hook.rules': async () =>
      guard(async () => {
        const seam = requireHook();
        const doc = seam.readRules();
        if (doc === null) {
          return { configured: false, version: null, enabled: false, rules: [] };
        }
        return { configured: true, ...describeHookRules(doc) };
      }),

    /**
     * Resolve { app, taskKind? } against the rules and activate the mapped
     * profile (M4-001). Deny-by-default: an unconfigured document, a globally
     * disabled hook, or no matching rule refuses with a stable code BEFORE any
     * LM Studio work. Refused calls append an audit row; allowed calls run
     * through the SAME activation runner + activation.lock as activation.apply
     * (a concurrent CLI/tray/benchmark op surfaces ACTIVATION_LOCK_BUSY) and
     * return the same transaction shape. The caller never picks a profileId.
     */
    'hook.switch': async (params, signal) =>
      guard(async () => {
        const seam = requireHook();
        const app = typeof params['app'] === 'string' ? params['app'].trim() : '';
        if (app === '') {
          throw new RpcMethodError('HOOK_INVALID_REQUEST', 'missing or non-string app');
        }
        const rawTask = params['taskKind'];
        const taskKind = typeof rawTask === 'string' && rawTask !== '' ? rawTask : undefined;

        const auditBase = { at: now(), app, taskKind: taskKind ?? null };

        const doc = seam.readRules();
        if (doc === null) {
          seam.audit({ ...auditBase, outcome: 'unconfigured' });
          throw new RpcMethodError('HOOK_UNCONFIGURED', 'hook rules are not configured');
        }
        const target = matchHookRule(doc, { app, taskKind });
        if (target === null) {
          seam.audit({
            ...auditBase,
            outcome: doc.enabled === false ? 'disabled' : 'denied',
          });
          throw new RpcMethodError(
            doc.enabled === false ? 'HOOK_DISABLED' : 'HOOK_DENIED',
            doc.enabled === false ? 'hook is disabled' : 'no hook rule matches this request',
          );
        }

        // Resolve the profile (STORE_NOT_FOUND surfaces verbatim) then run the
        // same activation chain the tray/reapply paths use: reachability
        // preflight, then the shared runner under the shared lock.
        const profile = requireStore().get(target.profileId);
        const activationSeam = requireActivation();
        await activationSeam.runtime.getActiveState();
        const result = await activationSeam.runner.run(profile, { signal });
        seam.audit({
          ...auditBase,
          outcome: result.outcome.status,
          ruleId: target.ruleId,
          profileId: target.profileId,
          transactionId: result.transaction.id,
        });
        return {
          outcome: result.outcome.status,
          alreadyActive: result.outcome.alreadyActive,
          profileId: target.profileId,
          ruleId: target.ruleId,
          transaction: result.transaction,
        };
      }),

    /**
     * Proxy aliases readiness (M4-002): whether the aliases document is
     * configured, the global switch, version, the same-session lock defaults
     * and the enabled-alias summary (virtualModel + profileId) so the CLI can
     * validate store existence without parsing the document itself.
     */
    'aliases.status': async () =>
      guard(async () => {
        const seam = requireAlias();
        const doc = seam.readAliases();
        if (doc === null) {
          return {
            configured: false,
            enabled: false,
            version: null,
            sessionLock: null,
            sessionTtlMs: null,
            aliasCount: 0,
            aliases: [],
          };
        }
        const described = describeVirtualAliases(doc);
        return {
          configured: true,
          enabled: described.enabled,
          version: described.version,
          sessionLock: described.sessionLock,
          sessionTtlMs: described.sessionTtlMs,
          aliasCount: described.aliases.length,
          aliases: described.aliases,
        };
      }),
  };

  const stream: Record<string, StreamHandler> = {
    stream: async function* stream(params) {
      const count = clampInt(params['count'], 5, 1, 1000);
      for (let i = 0; i < count; i += 1) {
        yield { chunk: i, count };
      }
    },
  };

  return { single, stream };
}
