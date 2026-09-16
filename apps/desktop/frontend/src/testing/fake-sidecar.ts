/**
 * In-memory fake of the Rust shell commands and the Core Service data plane
 * for browser-mode E2E (M6-004). It speaks the exact wire the real frontend
 * uses (`invoke('sidecar_rpc', { method, params })` plus the sidecar_* and
 * settings commands), so views exercise the real code path with mocked IPC.
 *
 * Only reachable through e2e-main.tsx (served at /e2e.html by the dev server);
 * the production index.html build graph never imports this module.
 */
import { mockIPC } from '@tauri-apps/api/mocks';
import { CompositeProfileSchema } from '@lmps/domain';
import type {
  ActivationApplyResult,
  ActivationStatus,
  BenchmarkBody,
  LocalizedText,
  ModelContextProjection,
  OptimizePreviewView,
  ProfileCard,
  ProfileDocument,
} from '../types';
import {
  canceledBenchmark,
  chatAlternativeProfile,
  chatProfile,
  codeProfile,
  completedBenchmark,
  failedBenchmark,
  happyPreview,
  HARDWARE_FIXTURE,
  noSafePreview,
  SDK_INFO_FIXTURE,
  type E2eScenario,
} from './fixtures';

const LOCALE_STORAGE_KEY = 'lmps-e2e-locale';
const NO_PROFILE_MODEL = {
  modelKey: 'vendor/empty-7b-q4_k_m',
  family: 'chat',
  quantization: 'Q4_K_M',
  parametersB: 7,
} as const;

function safeBaselineForFixture(taskType: string): ProfileDocument {
  const base = chatProfile();
  const kind = taskType === 'quick-chat' || taskType === 'coding' ? taskType : undefined;
  return {
    ...base,
    id: `draft-empty-7b-${taskType}`,
    displayName: { 'zh-CN': 'Fixture safe baseline', en: 'Unsaved safe baseline' },
    description: { 'zh-CN': 'Test-only; never saved automatically.', en: 'Test-only baseline; never saved automatically.' },
    model: { modelKey: NO_PROFILE_MODEL.modelKey, family: NO_PROFILE_MODEL.family, quantization: NO_PROFILE_MODEL.quantization },
    task: { type: taskType, ...(kind === undefined ? {} : { kind }) },
    runtime: { gpuOffload: 'auto' },
    generation: {},
    behavior: { mode: 'exclusive', rollback: 'best-effort' },
  };
}

function safePreviewForFixture(taskType: string): OptimizePreviewView {
  const baseline = safeBaselineForFixture(taskType);
  const preview = happyPreview();
  return {
    recommendation: {
      ...preview.recommendation,
      baselineProfileId: baseline.id,
      taskKind: taskType,
      candidates: preview.recommendation.candidates.map((candidate) => ({
        ...candidate,
        baselineProfileId: baseline.id,
        profile: { ...candidate.profile, id: baseline.id, model: baseline.model, task: baseline.task },
      })),
    },
    calibration: preview.calibration,
  };
}

/** Rust rejects invokes with plain "CODE: message" strings; mimic that exactly. */
function rpcReject(code: string, message: string): Promise<never> {
  return Promise.reject(`${code}: ${message}`);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * Validates writes with the same @lmps/domain composite contract the real
 * sidecar enforces, so browser-mode E2E catches schema drift (e.g. missing
 * runtime/generation/behavior sections) instead of only the Windows-shell run.
 * Returns the Zod failure message, or null when the document is valid.
 */
function profileValidationError(value: unknown): string | null {
  const parsed = CompositeProfileSchema.safeParse(value);
  return parsed.success ? null : parsed.error.message;
}

class FakeSidecar {
  private readonly profiles = new Map<string, ProfileDocument>();
  private active: ActivationStatus['active'] = null;
  private preparationSeq = 0;
  private readonly preparations = new Map<string, ProfileDocument>();
  private readonly defaults = new Map<string, string>([
    ['vendor/chat-9b-q4_k_m\u0000quick-chat', 'chat-9b'],
  ]);

  constructor(private readonly scenario: E2eScenario) {
    const docs = [chatProfile(), codeProfile()];
    if (scenario === 'no-default') docs.push(chatAlternativeProfile());
    for (const doc of docs) this.profiles.set(doc.id, doc);
    if (scenario === 'no-profiles-replace') {
      this.active = { profileId: 'chat-9b', modelKey: 'vendor/chat-9b-q4_k_m', since: '2026-09-01T09:00:00.000Z' };
    }
  }

  getLocale(): string {
    return window.localStorage.getItem(LOCALE_STORAGE_KEY) ?? 'zh-CN';
  }

  setLocale(locale: string): void {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }

  private cardOf(doc: ProfileDocument): ProfileCard {
    return {
      id: doc.id,
      displayName: doc.displayName as LocalizedText,
      model: {
        modelKey: doc.model.modelKey,
        family: doc.model.family ?? null,
        quantization: doc.model.quantization ?? null,
      },
      task: {
        type: doc.task.type,
        kind: doc.task.kind ?? null,
      },
      updatedAt: String(doc.metadata?.updatedAt ?? ''),
    };
  }

  private modelContext(): ModelContextProjection {
    const docs = [...this.profiles.values()];
    const discoveredOnly = this.scenario === 'no-profiles' || this.scenario === 'no-profiles-replace' ? [NO_PROFILE_MODEL] : [];
    const modelKeys = [...new Set([...docs.map((doc) => doc.model.modelKey), ...discoveredOnly.map((model) => model.modelKey)])].sort();
    const models = modelKeys.map((modelKey) => {
      const modelDocs = docs.filter((doc) => doc.model.modelKey === modelKey);
      const discovered = discoveredOnly.find((model) => model.modelKey === modelKey);
      const base = modelDocs[0];
      const scenarios = [...new Set(modelDocs.map((doc) => doc.task.type))].sort().map((type) => {
        const scenarioDocs = modelDocs.filter((doc) => doc.task.type === type);
        const defaultId = this.scenario === 'no-default' ? null : this.defaults.get(`${modelKey}\u0000${type}`) ?? null;
        const defaultAvailable = defaultId !== null && scenarioDocs.some((doc) => doc.id === defaultId);
        return {
          type,
          profileState: 'available' as const,
          defaultProfileId: defaultId,
          defaultState: defaultId === null ? 'none' as const : defaultAvailable ? 'available' as const : 'stale' as const,
          hasProfiles: true,
          benchmarkCount: 0,
          evidence: 'unmeasured' as const,
          profiles: scenarioDocs.map((doc) => ({
            id: doc.id,
            displayName: doc.displayName as LocalizedText,
            updatedAt: String(doc.metadata?.updatedAt ?? ''),
            evidence: 'unmeasured' as const,
            isDefault: defaultAvailable && doc.id === defaultId,
          })),
          benchmarks: [],
        };
      });
      return {
        model: {
          modelKey,
          family: base?.model.family ?? discovered?.family ?? null,
          quantization: base?.model.quantization ?? discovered?.quantization ?? null,
          parametersB: discovered?.parametersB ?? null,
          loaded: this.active?.modelKey === modelKey,
        },
        availability: 'available' as const,
        profileState: scenarios.length === 0 ? 'none' as const : 'available' as const,
        scenarios,
      };
    });
    return {
      readiness: {
        hardware: { status: 'ready', fingerprint: 'fp-e2e-fixture' },
        lmStudio: { status: 'ready', version: '0.0.0-e2e' },
        discovery: { status: 'ready', observedAt: '2026-09-01T08:00:00.000Z' },
        runtime: { status: this.active === null ? 'idle' : 'running', active: this.active },
      },
      models,
      needsOrganization: [],
    };
  }
  async rpc(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'profiles.meta':
        return { taskKinds: ['quick-chat', 'coding'] };
      case 'models.context':
        if (this.scenario === 'list-error') return rpcReject('LM_UNREACHABLE', 'fixture: LM Studio is offline');
        return this.modelContext();
      case 'defaults.set': {
        const id = String(params.profileId);
        const profile = this.profiles.get(id);
        if (profile === undefined) return rpcReject('STORE_NOT_FOUND', `fixture: ${id}`);
        const key = `${profile.model.modelKey}\u0000${profile.task.type}`;
        this.defaults.set(key, id);
        return { default: { modelKey: profile.model.modelKey, taskType: profile.task.type, profileId: id, updatedAt: '2026-09-01T08:00:00.000Z' } };
      }
      case 'profiles.list':
        if (this.scenario === 'list-error') {
          return rpcReject('LM_UNREACHABLE', 'fixture: sidecar data plane unreachable');
        }
        return { profiles: [...this.profiles.values()].map((doc) => this.cardOf(doc)) };
      case 'profiles.show': {
        const doc = this.profiles.get(String(params.id));
        if (doc === undefined) return rpcReject('STORE_NOT_FOUND', `fixture: ${String(params.id)}`);
        return { profile: structuredClone(doc) };
      }
      case 'profiles.create': {
        const doc = asRecord(params.profile) as unknown as ProfileDocument;
        const invalid = profileValidationError(params.profile);
        if (invalid !== null) return rpcReject('PROFILE_INVALID', invalid);
        this.profiles.set(doc.id, structuredClone(doc));
        return { id: doc.id };
      }
      case 'profiles.update': {
        const existing = this.profiles.get(String(params.id));
        if (existing === undefined) return rpcReject('STORE_NOT_FOUND', `fixture: ${String(params.id)}`);
        const patch = asRecord(params.patch) as Partial<ProfileDocument>;
        const merged: ProfileDocument = { ...existing, ...structuredClone(patch), id: existing.id };
        const invalid = profileValidationError(merged);
        if (invalid !== null) return rpcReject('PROFILE_INVALID', invalid);
        this.profiles.set(existing.id, merged);
        return { id: existing.id };
      }
      case 'profiles.delete': {
        this.profiles.delete(String(params.id));
        if (this.active?.profileId === String(params.id)) this.active = null;
        return { id: String(params.id) };
      }
      case 'activation.status':
        return { active: this.active } satisfies ActivationStatus;
      case 'activation.startSafe': {
        const modelKey = String(params.modelKey);
        const taskType = String(params.taskType);
        if ((this.scenario !== 'no-profiles' && this.scenario !== 'no-profiles-replace') || modelKey !== NO_PROFILE_MODEL.modelKey) {
          return rpcReject('STORE_NOT_FOUND', `fixture: ${modelKey}`);
        }
        const id = `draft-empty-7b-${taskType}`;
        this.active = { profileId: id, modelKey, since: '2026-09-01T09:00:00.000Z' };
        return {
          outcome: 'active',
          alreadyActive: false,
          transaction: { transactionId: `tx-e2e-${id}`, targetProfileId: id, status: 'committed' },
        } satisfies ActivationApplyResult;
      }      case 'activation.apply': {
        const id = String(params.id);
        if (!this.profiles.has(id)) return rpcReject('STORE_NOT_FOUND', `fixture: ${id}`);
        if (this.scenario === 'apply-recovered') {
          // Automatic rollback path: the transaction failed and the previous
          // profile was restored, so the active slot stays empty.
          return {
            outcome: 'failed-but-recovered',
            alreadyActive: false,
            transaction: {
              transactionId: `tx-e2e-${id}`,
              targetProfileId: id,
              status: 'rolled-back',
            },
          } satisfies ActivationApplyResult;
        }
        const alreadyActive = this.active?.profileId === id;
        const doc = this.profiles.get(id);
        this.active = {
          profileId: id,
          modelKey: doc?.model.modelKey ?? 'unknown',
          since: '2026-09-01T09:00:00.000Z',
        };
        return {
          outcome: 'active',
          alreadyActive,
          transaction: {
            transactionId: `tx-e2e-${id}`,
            targetProfileId: id,
            status: 'committed',
          },
        } satisfies ActivationApplyResult;
      }
      case 'optimization.prepare': {
        if (this.scenario === 'optimization-failed') {
          return rpcReject('OPTIMIZE_REFUSED', 'fixture: optimization benchmark failed');
        }
        const profileId = String(params.profileId);
        const baseline = this.profiles.get(profileId) ?? chatProfile();
        const preview = this.scenario === 'no-safe' ? noSafePreview() : happyPreview();
        const requestedCandidate = typeof params.candidateId === 'string' ? params.candidateId : null;
        const selectedCandidate = requestedCandidate === null
          ? (preview.recommendation.selectedIndex === null ? null : preview.recommendation.candidates[preview.recommendation.selectedIndex] ?? null)
          : preview.recommendation.candidates.find((candidate) => candidate.id === requestedCandidate) ?? null;
        const baselineDecision = params.baselineBenchmark === 'skip' ? 'skip' : 'run';
        const candidateDecision = params.candidateBenchmark === 'skip' ? 'skip' : 'run';
        const baselineResult = baselineDecision === 'run' ? completedBenchmark(profileId).result : null;
        const candidateCanceled = this.scenario === 'optimization-canceled' && candidateDecision === 'run' && selectedCandidate !== null;
        const candidateResult = candidateCanceled
          ? canceledBenchmark(profileId).result
          : candidateDecision === 'run' && selectedCandidate !== null
            ? completedBenchmark(profileId).result
            : null;
        const status = selectedCandidate === null
          ? 'no-candidate'
          : candidateCanceled
            ? 'canceled'
            : candidateDecision === 'skip'
              ? (baselineDecision === 'skip' ? 'baseline-skipped' : 'candidate-skipped')
              : 'ready-to-save';
        const candidateEvidence = selectedCandidate === null
          ? 'not-run'
          : candidateCanceled
            ? 'canceled'
            : candidateDecision === 'skip'
              ? 'unmeasured'
              : 'measured';
        this.preparationSeq += 1;
        const preparationId = 'fixture-optimization-' + this.preparationSeq;
        if (selectedCandidate !== null) this.preparations.set(preparationId, structuredClone(selectedCandidate.profile));
        return {
          preparationId,
          preparation: {
            baselineProfile: structuredClone(baseline),
            baselineBenchmark: { decision: baselineDecision, result: baselineResult },
            recommendation: preview.recommendation,
            selectedCandidate,
            candidateBenchmark: { decision: selectedCandidate === null ? 'not-run' : candidateDecision, result: candidateResult },
            candidateEvidence,
            status,
          },
        };
      }
      case 'optimization.prepareModel': {
        if (this.scenario !== 'no-profiles') return rpcReject('STORE_NOT_FOUND', 'fixture: no-profile model');
        const modelKey = String(params.modelKey);
        const taskType = String(params.taskType);
        if (modelKey !== NO_PROFILE_MODEL.modelKey) return rpcReject('STORE_NOT_FOUND', `fixture: ${modelKey}`);
        const baseline = safeBaselineForFixture(taskType);
        const preview = safePreviewForFixture(taskType);
        const requestedCandidate = typeof params.candidateId === 'string' ? params.candidateId : null;
        const selectedCandidate = requestedCandidate === null
          ? (preview.recommendation.selectedIndex === null ? null : preview.recommendation.candidates[preview.recommendation.selectedIndex] ?? null)
          : preview.recommendation.candidates.find((candidate) => candidate.id === requestedCandidate) ?? null;
        const baselineDecision = params.baselineBenchmark === 'skip' ? 'skip' : 'run';
        const candidateDecision = params.candidateBenchmark === 'skip' ? 'skip' : 'run';
        const baselineResult = baselineDecision === 'run' ? completedBenchmark(baseline.id).result : null;
        const candidateResult = candidateDecision === 'run' && selectedCandidate !== null ? completedBenchmark(baseline.id).result : null;
        const status = selectedCandidate === null ? 'no-candidate' : candidateDecision === 'skip' ? (baselineDecision === 'skip' ? 'baseline-skipped' : 'candidate-skipped') : 'ready-to-save';
        const candidateEvidence = selectedCandidate === null ? 'not-run' : candidateDecision === 'skip' ? 'unmeasured' : 'measured';
        this.preparationSeq += 1;
        const preparationId = `fixture-optimization-${this.preparationSeq}`;
        if (selectedCandidate !== null) this.preparations.set(preparationId, structuredClone(selectedCandidate.profile));
        return {
          preparationId,
          baselinePersistence: 'unsaved',
          preparation: {
            baselineProfile: structuredClone(baseline),
            baselineBenchmark: { decision: baselineDecision, result: baselineResult },
            recommendation: preview.recommendation,
            selectedCandidate,
            candidateBenchmark: { decision: selectedCandidate === null ? 'not-run' : candidateDecision, result: candidateResult },
            candidateEvidence,
            status,
          },
        };
      }      case 'optimization.save': {
        const id = String(params.id);
        const preparationId = String(params.preparationId ?? '');
        const preparedProfile = this.preparations.get(preparationId);
        if (preparedProfile === undefined) return rpcReject('OPTIMIZATION_NO_CANDIDATE', 'fixture: no candidate preparation');
        const saved = structuredClone(preparedProfile);
        saved.id = id;
        this.preparations.delete(preparationId);
        this.profiles.set(id, saved);
        const key = `${saved.model.modelKey}\u0000${saved.task.type}`;
        const isDefault = params.setDefault === true || !this.defaults.has(key);
        if (isDefault) this.defaults.set(key, id);
        return { profileId: id, isDefault };
      }
      case 'optimization.setDefault': {
        const id = String(params.profileId);
        const profile = this.profiles.get(id);
        if (profile === undefined) return rpcReject('STORE_NOT_FOUND', `fixture: ${id}`);
        this.defaults.set(`${profile.model.modelKey}\u0000${profile.task.type}`, id);
        return { profileId: id };
      }
      case 'optimize.preview':
        if (this.scenario === 'no-safe') return noSafePreview();
        return happyPreview();
      case 'optimize.save': {
        const preview: OptimizePreviewView = happyPreview();
        return { appliedProfileId: 'chat-9b-loop-max', recommendation: preview.recommendation };
      }
      case 'benchmark.run':
        return (
          this.scenario === 'benchmark-failed'
            ? failedBenchmark(String(params.profileId))
            : completedBenchmark(String(params.profileId))
        ) satisfies BenchmarkBody;
      case 'hardware':
        return { profile: HARDWARE_FIXTURE };
      case 'sdkInfo':
        return SDK_INFO_FIXTURE;
      default:
        return rpcReject('METHOD_UNSUPPORTED', `fixture: ${method}`);
    }
  }
}

function resolveScenario(): E2eScenario {
  const raw = new URLSearchParams(window.location.search).get('scenario');
  if (raw === 'list-error' || raw === 'no-safe' || raw === 'no-default' || raw === 'no-profiles' || raw === 'no-profiles-replace' || raw === 'benchmark-failed' || raw === 'apply-recovered' || raw === 'optimization-failed' || raw === 'optimization-canceled') {
    return raw;
  }
  return 'happy';
}

/**
 * Installs the fake Tauri internals before the real bootstrap runs. Reads the
 * scenario from `?scenario=` (default happy) and exposes the fake on a global
 * solely so specs can read state when a UI affordance does not exist.
 */
export function installE2eTauriMock(): void {
  const scenario = resolveScenario();
  const fake = new FakeSidecar(scenario);

  mockIPC(async (cmd, args) => {
    const payload = asRecord(args);
    switch (cmd) {
      case 'sidecar_status':
        return 'connected';
      case 'sidecar_probe':
        return { ok: true, transport: 'e2e-mock' };
      case 'sidecar_hardware':
        return { profile: HARDWARE_FIXTURE };
      case 'sidecar_sdk_info':
        return SDK_INFO_FIXTURE;
      case 'sidecar_locale_get':
        return fake.getLocale();
      case 'sidecar_locale_set':
        fake.setLocale(String(payload.locale));
        return null;
      case 'sidecar_rpc':
        return fake.rpc(String(payload.method), asRecord(payload.params));
      default:
        if (typeof cmd === 'string' && cmd.startsWith('plugin:event|')) {
          // Event listen/unlisten invocations resolve without pushing frames;
          // the initial sidecar_status invoke already reports "connected".
          return cmd.endsWith('listen') ? 0 : null;
        }
        return rpcReject('METHOD_UNSUPPORTED', `fixture: ${String(cmd)}`);
    }
  });

  (window as unknown as Record<string, unknown>).__LMPS_E2E_FAKE__ = fake;
}