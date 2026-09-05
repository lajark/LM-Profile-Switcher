/**
 * Shared fixtures for the domain contract suite. The composite mirrors the
 * published v1 sample shape (`schemas/profile.schema.json`, unchanged) so the
 * migration tests validate against the real baseline.
 */
import type { CompositeProfile } from '@lmps/domain';

export const v1SampleComposite: CompositeProfile = {
  schemaVersion: 1,
  id: 'code-chat-moe',
  displayName: { 'zh-CN': '代码对话', en: 'Code Chat' },
  description: { 'zh-CN': '面向代码任务的 MoE 对话', en: 'MoE chat tuned for code tasks' },
  model: {
    modelKey: 'qwen2.5-coder-32b-instruct',
    fileHash: 'sha256:0123456789abcdef',
    family: 'Qwen2.5',
    architecture: 'moe',
    quantization: 'q4_k_m',
  },
  task: {
    type: 'code-chat',
    typicalInputTokens: 4000,
    expectedOutputTokens: 2000,
    structuredOutput: false,
    toolUse: true,
    concurrency: 4,
  },
  runtime: {
    contextLength: 32768,
    gpuOffload: 0.8,
    evalBatchSize: 32,
    flashAttention: true,
    offloadKvCacheToGpu: false,
    kCacheQuantization: 'q8_0',
    vCacheQuantization: 'q8_0',
    ropeFrequencyBase: 1000000,
    ropeFrequencyScale: 0.5,
    tryMmap: false,
    keepModelInMemory: true,
    numExperts: 8,
    parallelSlots: 2,
  },
  generation: {
    temperature: 0.3,
    topP: 0.95,
    topK: 40,
    minP: 0.05,
    repeatPenalty: 1.1,
    frequencyPenalty: 0,
    presencePenalty: 0,
    maxTokens: 8192,
    seed: 42,
    reasoning: null,
    structuredOutputSchema: null,
    systemPrompt: 'You are a code assistant.',
    presetReference: null,
  },
  behavior: {
    identifier: 'code-chat-default',
    ttlSeconds: 0,
    mode: 'exclusive',
    autoStartServer: true,
    healthCheck: 'model-status',
    rollback: 'always',
  },
  validation: {
    source: 'manual',
    hardwareFingerprint: null,
    lmStudioVersion: null,
    runtimeVersion: null,
    adapterCapabilityVersion: null,
    testedAt: null,
    benchmarkId: null,
  },
  metadata: {
    createdAt: '2026-08-21T10:00:00Z',
    updatedAt: '2026-08-21T10:30:00Z',
    tags: ['code', 'moe'],
  },
};

/**
 * Minimal but valid instances of the non-composite contracts, re-used by the
 * serialization round-trip tests.
 */
export const minimalLoadEstimate = {
  schemaVersion: 1,
  provider: 'exact',
  modelKey: 'qwen2.5-coder-32b-instruct',
  vramTotalBytes: 24576000,
  systemRamBytes: 4096000,
  estimatedAt: '2026-08-21T11:00:00Z',
} as const;

export const minimalBenchmarkResult = {
  schemaVersion: 1,
  id: 'bench-001',
  modelKey: 'qwen2.5-coder-32b-instruct',
  taskType: 'code-chat',
  status: 'completed',
  metrics: {
    tokensPerSecond: 42.5,
    latencyP50Ms: 180,
    memoryPeakBytes: 24576000,
    samples: 5,
  },
  startedAt: '2026-08-21T11:05:00Z',
  finishedAt: '2026-08-21T11:10:00Z',
} as const;

export const minimalActivationTransaction = {
  schemaVersion: 1,
  id: 'txn-001',
  targetProfileId: 'code-chat-moe',
  previousProfileId: 'general-chat',
  status: 'active',
  policy: { mode: 'exclusive', rollback: 'always' },
  stages: [
    { name: 'validating', startedAt: '2026-08-21T12:00:00Z', endedAt: '2026-08-21T12:00:01Z', outcome: 'completed' },
    { name: 'loading', startedAt: '2026-08-21T12:00:02Z', endedAt: '2026-08-21T12:00:20Z', outcome: 'completed' },
  ],
  startedAt: '2026-08-21T12:00:00Z',
  finishedAt: '2026-08-21T12:00:21Z',
} as const;

export const minimalCapabilityMatrix = {
  schemaVersion: 1,
  adapter: 'sdk',
  apiVersion: 'v1',
  lmStudioVersion: '0.3.0',
  probedAt: '2026-08-21T13:00:00Z',
  cacheTtlSeconds: 3600,
  capabilities: [{ field: 'runtime.flashAttention', support: 'exact' }],
} as const;

export const minimalHardwareProfile = {
  schemaVersion: 1,
  os: 'Windows 11',
  cpu: { model: 'Ryzen 9', cores: 16, threads: 32 },
  memory: { totalBytes: 68720000000, availableBytes: 34360000000 },
  gpus: [{ name: 'RTX 4090', vramTotalBytes: 25769070592, vramAvailableBytes: 24576000000 }],
  power: { onBattery: false },
  probedAt: '2026-08-21T14:00:00Z',
} as const;