/**
 * Deterministic fixtures for the browser-mode E2E fake sidecar (M6-004).
 * Nothing here ships in release builds: this module is only imported by
 * e2e-main.tsx, which is referenced solely from the non-built e2e.html entry.
 * Chinese copy below is fixture DATA (profile names/rationale), not UI copy,
 * so each CJK line carries the i18n gate's fixture exemption.
 */
import type {
  BenchmarkBody,
  HardwareView,
  OptimizePreviewView,
  ProfileDocument,
} from '../types';

export type E2eScenario = 'happy' | 'list-error' | 'no-safe' | 'benchmark-failed' | 'apply-recovered';

export const FIXTURE_NOW = '2026-09-01T08:00:00.000Z';

export function chatProfile(): ProfileDocument {
  return {
    schemaVersion: 2,
    id: 'chat-9b',
    displayName: {
      'zh-CN': '聊天 9B（测试夹具）', // i18n-ignore
      en: 'Chat 9B (fixture)',
    },
    description: { en: 'Deterministic browser-mode fixture profile.' },
    model: { modelKey: 'vendor/chat-9b-q4_k_m', family: 'chat', quantization: 'Q4_K_M' },
    task: { type: 'quick-chat', kind: 'quick-chat' },
    runtime: { contextLength: 32768, gpuOffload: 'max' },
    generation: { temperature: 0.7 },
    behavior: { mode: 'exclusive' },
    metadata: { createdAt: FIXTURE_NOW, updatedAt: FIXTURE_NOW },
  };
}

export function codeProfile(): ProfileDocument {
  return {
    schemaVersion: 2,
    id: 'code-27b',
    displayName: {
      'zh-CN': '代码 27B（测试夹具）', // i18n-ignore
      en: 'Code 27B (fixture)',
    },
    description: { en: 'Second fixture used for the active-replacement flow.' },
    model: { modelKey: 'vendor/code-27b-q4_k_m', family: 'code', quantization: 'Q4_K_M' },
    task: { type: 'coding-assistant', kind: 'coding' },
    runtime: { contextLength: 16384, gpuOffload: 'auto' },
    generation: { temperature: 0.2 },
    behavior: { mode: 'exclusive' },
    metadata: { createdAt: FIXTURE_NOW, updatedAt: FIXTURE_NOW },
  };
}

export const HARDWARE_FIXTURE: HardwareView = {
  schemaVersion: 1,
  os: 'Windows 11 (fixture)',
  cpu: { model: 'Fixture X1 CPU', cores: 16, threads: 24 },
  memory: { totalBytes: 68_719_476_736, availableBytes: 51_539_607_552 },
  gpus: [
    {
      name: 'Fixture RTX 5060 Ti',
      driverVersion: '0.0.fixture',
      vramTotalBytes: 17_179_869_184,
      vramAvailableBytes: 16_380_317_696,
    },
  ],
  volumes: [
    { mount: 'C:\\', totalBytes: 1_000_000_000_000, availableBytes: 420_000_000_000, driveType: 3 },
  ],
  power: { onBattery: false },
  hardwareFingerprint: 'fp-e2e-fixture',
  probedAt: FIXTURE_NOW,
};

export const SDK_INFO_FIXTURE = {
  name: 'lmps-e2e-mock',
  version: '0.0.0-e2e',
  channel: 'browser-mode',
};

/** Preview returned for `chat-9b`: one high-confidence safe candidate first. */
export function happyPreview(): OptimizePreviewView {
  const recommendation: OptimizePreviewView['recommendation'] = {
    schemaVersion: 2,
    baselineProfileId: 'chat-9b',
    taskKind: 'quick-chat',
    ruleVersion: 'e2e-fixture-rules-v1',
    generatedAt: FIXTURE_NOW,
    selectedIndex: 0,
    warnings: [],
    candidates: [
      {
        id: 'chat-9b-loop-max',
        profile: chatProfile(),
        baselineProfileId: 'chat-9b',
        safety: {
          safe: true,
          reason: null,
          headroomBytes: 2_576_980_992,
          resourceFit: 'gpu-resident',
          vramUsedBytes: 13_803_336_704,
          vramAvailableBytes: 16_380_317_696,
          vramReserveBytes: 1_073_741_824,
        },
        estimate: {
          vramTotalBytes: 13_803_336_704,
          totalMemoryBytes: 14_074_507_264,
          systemRamBytes: 271_170_560,
        },
        score: { total: 0.86, confidence: 'high', measured: false, breakdown: { fit: 0.9 } },
        diff: [
          { path: 'runtime.gpuOffload', baseline: 'max', candidate: 'max' },
          { path: 'runtime.contextLength', baseline: 32768, candidate: 16384 },
        ],
        rationale: {
          'zh-CN': '缩短上下文可保留全部层在显存内（测试夹具）。', // i18n-ignore
          en: 'Shorter context keeps every layer resident (fixture rationale).',
        },
      },
      {
        id: 'chat-9b-loop-min',
        profile: chatProfile(),
        baselineProfileId: 'chat-9b',
        safety: {
          safe: true,
          reason: null,
          headroomBytes: 536_870_912,
          resourceFit: 'hybrid-memory',
        },
        estimate: {
          vramTotalBytes: 15_840_000_000,
          totalMemoryBytes: 16_106_000_000,
          systemRamBytes: 266_000_000,
        },
        score: { total: 0.57, confidence: 'low', measured: false, breakdown: { fit: 0.6 } },
        diff: [{ path: 'runtime.contextLength', baseline: 32768, candidate: 8192 }],
        rationale: {
          'zh-CN': '备选档位（测试夹具）。', // i18n-ignore
          en: 'Fallback tier (fixture rationale).',
        },
      },
    ],
  };
  return {
    recommendation,
    calibration: {
      measuredPeakBytes: null,
      candidates: [
        {
          candidateId: 'chat-9b-loop-max',
          verdict: {
            calibrationVersion: 2,
            evidenceVersion: null,
            evidenceQuality: 'unavailable',
            relation: 'unavailable',
            rebenchmarkRequired: false,
            applied: false,
            comparedPeakBytes: null,
            estimatedTotalBytes: 14_074_507_264,
            ratio: null,
            degraded: false,
            overrunBytes: null,
            confidence: 'estimated',
            note: 'unavailable',
          },
        },
      ],
    },
  };
}

/** No-safe-candidate preview: the save action must stay disabled/refused. */
export function noSafePreview(): OptimizePreviewView {
  const base = happyPreview();
  return {
    ...base,
    recommendation: {
      ...base.recommendation,
      selectedIndex: null,
      candidates: [],
    },
  };
}

export function completedBenchmark(profileId: string): BenchmarkBody {
  const profile = profileId === 'code-27b' ? codeProfile() : chatProfile();
  return {
    validated: true,
    result: {
      id: 'bench-e2e-0001',
      modelKey: profile.model.modelKey,
      quantization: profile.model.quantization ?? null,
      taskType: profile.task.type,
      status: 'completed',
      metrics: {
        tokensPerSecond: 42.5,
        latencyP50Ms: 380,
        loadMs: 4200,
        ttftMs: 410,
        prefillTokensPerSecond: 1200.25,
        decodeTokensPerSecond: 42.5,
        memoryPeakBytes: 13_958_643_712,
        samples: 3,
      },
      hardwareFingerprint: 'fp-e2e-fixture',
      lmStudioVersion: '0.0.0-e2e',
      startedAt: FIXTURE_NOW,
      finishedAt: '2026-09-01T08:01:00.000Z',
    },
  };
}

export function failedBenchmark(profileId: string): BenchmarkBody {
  const body = completedBenchmark(profileId);
  return {
    validated: false,
    result: {
      ...body.result,
      id: 'bench-e2e-failed',
      status: 'failed',
      metrics: {},
      errorCode: 'E2E_FIXTURE_FAILURE',
    },
  };
}
