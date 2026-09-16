import type { BenchmarkResult, CompositeProfile } from '@lmps/domain';

import type { ActiveState } from './ports.js';

/** Statuses deliberately kept independent for hardware, LM Studio and runtime. */
export type ReadinessStatus = 'ready' | 'offline' | 'unavailable' | 'partial' | 'unknown';

export interface ReadinessSnapshot {
  hardware: { status: ReadinessStatus; fingerprint: string | null };
  lmStudio: { status: ReadinessStatus; version: string | null };
  discovery: { status: ReadinessStatus; observedAt: string | null };
  runtime: { status: 'idle' | 'running' | 'unknown'; active: ActiveState | null };
}

/** Adapter-neutral identity used by the model-first projection. */
export interface ModelDiscoveryRecord {
  modelKey: string;
  family: string | null;
  quantization: string | null;
  parametersB: number | null;
}

export interface LegacyProfileIssue {
  id: string;
  reason: 'unclassifiable-model-or-scenario';
}

export interface ModelDefaultRecord {
  modelKey: string;
  taskType: string;
  profileId: string;
}

export interface ModelContextInput {
  now: string;
  /** Maximum age of a validation/benchmark before it becomes stale. */
  evidenceTtlMs?: number;
  models: ReadonlyArray<ModelDiscoveryRecord>;
  profiles: ReadonlyArray<CompositeProfile>;
  benchmarks: ReadonlyArray<BenchmarkResult>;
  /** Explicit per-model/scenario choice; never inferred from profile order. */
  defaults?: ReadonlyArray<ModelDefaultRecord>;
  legacy: ReadonlyArray<LegacyProfileIssue>;
  readiness: ReadinessSnapshot;
}

export type EvidenceStatus = 'unmeasured' | 'current' | 'stale' | 'partial' | 'changed-environment';

export interface ProfileContextItem {
  id: string;
  displayName: CompositeProfile['displayName'];
  updatedAt: string;
  evidence: EvidenceStatus;
  isDefault?: boolean;
}

export interface BenchmarkContextItem {
  id: string;
  status: BenchmarkResult['status'];
  startedAt: string;
  finishedAt: string | null;
  evidence: EvidenceStatus;
}

export interface ScenarioContext {
  type: string;
  profileState: 'none' | 'available';
  /** A default is explicit; stale points to a missing/mismatched profile. */
  defaultProfileId: string | null;
  defaultState: 'none' | 'available' | 'stale';
  hasProfiles: boolean;
  benchmarkCount: number;
  evidence: EvidenceStatus;
  profiles: ProfileContextItem[];
  benchmarks: BenchmarkContextItem[];
}

export interface ModelContextItem {
  model: ModelDiscoveryRecord & { loaded: boolean | null };
  availability: 'available' | 'missing' | 'unknown';
  profileState: 'none' | 'available';
  scenarios: ScenarioContext[];
}

export interface ModelContextProjection {
  readiness: ReadinessSnapshot;
  models: ModelContextItem[];
  needsOrganization: LegacyProfileIssue[];
}

const DEFAULT_EVIDENCE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function dateMs(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function evidenceStatus(
  testedAt: string | null | undefined,
  hardwareFingerprint: string | null | undefined,
  lmStudioVersion: string | null | undefined,
  now: string,
  ttlMs: number,
  readiness: ReadinessSnapshot,
): EvidenceStatus {
  if (testedAt === undefined || testedAt === null) return 'partial';
  if (
    readiness.hardware.fingerprint !== null &&
    hardwareFingerprint !== undefined &&
    hardwareFingerprint !== null &&
    hardwareFingerprint !== readiness.hardware.fingerprint
  ) {
    return 'changed-environment';
  }
  if (
    readiness.lmStudio.version !== null &&
    lmStudioVersion !== undefined &&
    lmStudioVersion !== null &&
    lmStudioVersion !== readiness.lmStudio.version
  ) {
    return 'changed-environment';
  }
  const nowMs = dateMs(now);
  const testedMs = dateMs(testedAt);
  if (nowMs === null || testedMs === null || nowMs - testedMs < 0 || nowMs - testedMs > ttlMs) return 'stale';
  if (
    readiness.hardware.fingerprint === null ||
    hardwareFingerprint === undefined ||
    hardwareFingerprint === null ||
    readiness.lmStudio.version === null ||
    lmStudioVersion === undefined ||
    lmStudioVersion === null
  ) {
    return 'partial';
  }
  return 'current';
}

const EVIDENCE_PRIORITY: Record<EvidenceStatus, number> = {
  'changed-environment': 5,
  stale: 4,
  partial: 3,
  current: 2,
  unmeasured: 1,
};

function strongestEvidence(values: ReadonlyArray<EvidenceStatus>): EvidenceStatus {
  if (values.length === 0) return 'unmeasured';
  return values.reduce((best, value) =>
    EVIDENCE_PRIORITY[value] > EVIDENCE_PRIORITY[best] ? value : best,
  );
}

/**
 * Builds the model-first read projection. It only groups already validated
 * records; model/scenario assignment is never inferred from a display name or
 * a legacy filename. The caller supplies adapter and store snapshots through
 * ports, keeping this module independent of LM Studio, files and the UI.
 */
export function buildModelContext(input: ModelContextInput): ModelContextProjection {
  const ttlMs = input.evidenceTtlMs ?? DEFAULT_EVIDENCE_TTL_MS;
  const modelKeys = new Set<string>();
  for (const model of input.models) modelKeys.add(model.modelKey);
  for (const profile of input.profiles) modelKeys.add(profile.model.modelKey);
  for (const benchmark of input.benchmarks) modelKeys.add(benchmark.modelKey);

  const discovered = new Map(input.models.map((model) => [model.modelKey, model]));
  const profilesByModel = new Map<string, CompositeProfile[]>();
  for (const profile of input.profiles) {
    const current = profilesByModel.get(profile.model.modelKey) ?? [];
    current.push(profile);
    profilesByModel.set(profile.model.modelKey, current);
  }
  const benchmarksByModel = new Map<string, BenchmarkResult[]>();
  for (const benchmark of input.benchmarks) {
    const current = benchmarksByModel.get(benchmark.modelKey) ?? [];
    current.push(benchmark);
    benchmarksByModel.set(benchmark.modelKey, current);
  }
  const defaultsByKey = new Map(
    (input.defaults ?? []).map((entry) => [`${entry.modelKey}\u0000${entry.taskType}`, entry.profileId]),
  );

  const models: ModelContextItem[] = [...modelKeys].sort().map((modelKey) => {
    const base = discovered.get(modelKey) ?? {
      modelKey,
      family: null,
      quantization: null,
      parametersB: null,
    };
    const discoveredHere = discovered.has(modelKey);
    const availability = discoveredHere
      ? 'available'
      : input.readiness.discovery.status === 'ready'
        ? 'missing'
        : 'unknown';
    const active = input.readiness.runtime.active;
    const loaded = active === null ? (input.readiness.runtime.status === 'idle' ? false : null) : active.modelKey === modelKey;
    const profiles = profilesByModel.get(modelKey) ?? [];
    const benchmarks = benchmarksByModel.get(modelKey) ?? [];
    const scenarioTypes = new Set<string>();
    for (const profile of profiles) scenarioTypes.add(profile.task.type);
    for (const benchmark of benchmarks) scenarioTypes.add(benchmark.taskType);
    const scenarios: ScenarioContext[] = [...scenarioTypes].sort().map((type) => {
      const scenarioProfiles = profiles.filter((profile) => profile.task.type === type);
      const scenarioBenchmarks = benchmarks.filter((result) => result.taskType === type);
      const defaultProfileId = defaultsByKey.get(`${modelKey}\u0000${type}`) ?? null;
      const defaultIsAvailable =
        defaultProfileId !== null && scenarioProfiles.some((profile) => profile.id === defaultProfileId);
      const profileItems = scenarioProfiles.map((profile) => ({
        id: profile.id,
        displayName: profile.displayName,
        updatedAt: profile.metadata.updatedAt,
        evidence:
          profile.validation === undefined
            ? ('unmeasured' as const)
            : evidenceStatus(
                profile.validation.testedAt,
                profile.validation.hardwareFingerprint,
                profile.validation.lmStudioVersion,
                input.now,
                ttlMs,
                input.readiness,
              ),
        isDefault: defaultIsAvailable && profile.id === defaultProfileId,
      }));
      const benchmarkItems = scenarioBenchmarks.map((result) => ({
        id: result.id,
        status: result.status,
        startedAt: result.startedAt,
        finishedAt: result.finishedAt ?? null,
        evidence: evidenceStatus(
          result.startedAt,
          result.hardwareFingerprint,
          result.lmStudioVersion,
          input.now,
          ttlMs,
          input.readiness,
        ),
      }));
      return {
        type,
        profileState: scenarioProfiles.length === 0 ? 'none' : 'available',
        defaultProfileId,
        defaultState:
          defaultProfileId === null ? 'none' : defaultIsAvailable ? 'available' : 'stale',
        hasProfiles: scenarioProfiles.length > 0,
        benchmarkCount: scenarioBenchmarks.length,
        evidence: strongestEvidence([
          ...profileItems.map((item) => item.evidence),
          ...benchmarkItems.map((item) => item.evidence),
        ]),
        profiles: profileItems,
        benchmarks: benchmarkItems,
      };
    });
    return {
      model: { ...base, loaded },
      availability,
      profileState: scenarios.length === 0 ? 'none' : 'available',
      scenarios,
    };
  });

  return {
    readiness: input.readiness,
    models,
    needsOrganization: [...input.legacy].sort((a, b) => a.id.localeCompare(b.id)),
  };
}
