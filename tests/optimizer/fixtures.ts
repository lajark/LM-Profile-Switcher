// Synthetic fixtures for the M2-002 optimizer suites: a RAG baseline, an exact
// LoadEstimate, a 12 GiB-free GPU hardware profile and a capability matrix with
// the seed rule's required fields. No I/O — everything is plain data.
import type {
  CapabilityMatrix,
  CompositeProfile,
  HardwareProfile,
  LoadEstimate,
} from '@lmps/domain';

export const NOW = '2026-08-22T01:02:03.000Z';
export const RULE_VERSION = '2026.09.1';

export const GIB = 1024 ** 3;

/** RAG baseline: kind='rag' (seed rule present), dense architecture. */
export function makeRagBaseline(overrides: Partial<CompositeProfile> = {}): CompositeProfile {
  return {
    schemaVersion: 2,
    id: 'rag-prime',
    displayName: { 'zh-CN': 'RAG 基准', en: 'RAG baseline' },
    description: { en: 'synthetic RAG baseline' },
    model: { modelKey: 'synthetic/rag-model', family: 'synthetic', architecture: 'dense' },
    task: { type: 'RAG assistant', kind: 'rag', concurrency: 1 },
    runtime: { contextLength: 8192, gpuOffload: 'max' },
    generation: { temperature: 0.3 },
    behavior: { mode: 'exclusive' },
    metadata: { createdAt: NOW, updatedAt: NOW },
    ...overrides,
  };
}

export function makeExactEstimate(overrides: Partial<LoadEstimate> = {}): LoadEstimate {
  return {
    schemaVersion: 2,
    provider: 'exact',
    modelKey: 'synthetic/rag-model',
    vramTotalBytes: 6 * GIB,
    systemRamBytes: 2 * GIB,
    estimatedAt: NOW,
    warnings: [],
    ...overrides,
  };
}

/** One 16 GiB GPU with 12 GiB free and a 32 GiB host with 28 GiB free. */
export function makeHardware(overrides: Partial<HardwareProfile> = {}): HardwareProfile {
  return {
    schemaVersion: 2,
    os: 'Windows 11',
    memory: { totalBytes: 32 * GIB, availableBytes: 28 * GIB },
    gpus: [{ name: 'RTX 5060 Ti', vramTotalBytes: 16 * GIB, vramAvailableBytes: 12 * GIB }],
    probedAt: NOW,
    ...overrides,
  };
}

/** Capability matrix exposing the rag rule's required fields as exact. */
export function makeCapability(overrides: Partial<CapabilityMatrix> = {}): CapabilityMatrix {
  return {
    schemaVersion: 2,
    adapter: 'rest',
    probedAt: NOW,
    cacheTtlSeconds: 300,
    capabilities: [
      { field: 'runtime.contextLength', support: 'exact' },
      { field: 'runtime.flashAttention', support: 'exact' },
    ],
    ...overrides,
  };
}