/**
 * BenchmarkResult construction (M2-003). Assembles the provenance + metrics
 * record and runs it through the strict schema so a malformed result can never
 * reach the audit log or a validation stamp.
 */
import { DomainError, SCHEMA_VERSION, StrictBenchmarkResultSchema, type BenchmarkConfig, type BenchmarkResult, type CompositeProfile } from '@lmps/domain';

export interface BuildBenchmarkResultInput {
  id: string;
  modelKey: string;
  quantization: string | null;
  taskType: string;
  status: 'completed' | 'failed' | 'canceled';
  metrics: BenchmarkResult['metrics'];
  hardwareFingerprint: string | null;
  lmStudioVersion: string | null;
  runtimeVersion: string | null;
  adapterCapabilityVersion: string | null;
  startedAt: string;
  finishedAt: string | null;
  errorCode: string | null;
  modelFileHash: string | null;
  promptSuiteId: string | null;
  promptSuiteVersion: string | null;
  /** Measured configuration snapshot (measured-feedback loop); null when unknown. */
  config?: BenchmarkConfig | null;
}

export function buildBenchmarkResult(input: BuildBenchmarkResultInput): BenchmarkResult {
  const result: BenchmarkResult = {
    schemaVersion: SCHEMA_VERSION,
    id: input.id,
    modelKey: input.modelKey,
    quantization: input.quantization,
    taskType: input.taskType,
    status: input.status,
    metrics: input.metrics,
    config: input.config ?? null,
    hardwareFingerprint: input.hardwareFingerprint,
    lmStudioVersion: input.lmStudioVersion,
    runtimeVersion: input.runtimeVersion,
    adapterCapabilityVersion: input.adapterCapabilityVersion,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    errorCode: input.errorCode,
    modelFileHash: input.modelFileHash,
    promptSuiteId: input.promptSuiteId,
    promptSuiteVersion: input.promptSuiteVersion,
  };
  const parsed = StrictBenchmarkResultSchema.safeParse(result);
  if (!parsed.success) {
    throw new DomainError('DOMAIN_VALIDATION_FAILED', 'benchmark result failed strict validation', {
      detail: parsed.error.issues[0]?.path.join('.') ?? 'unknown',
      cause: parsed.error,
    });
  }
  return result;
}

/**
 * Pure projection of the profile parameters a benchmark run exercised
 * (measured-feedback loop): exactly the fields the optimizer's evidence matcher
 * compares candidates against. Fields the profile defers to LM Studio defaults
 * on stay `null` so a match never invents a value that was not measured.
 */
export function configSnapshotOf(profile: CompositeProfile): BenchmarkConfig {
  return {
    profileId: profile.id,
    gpuOffload: profile.runtime.gpuOffload ?? null,
    contextLength: profile.runtime.contextLength ?? null,
    evalBatchSize: profile.runtime.evalBatchSize ?? null,
    flashAttention: profile.runtime.flashAttention ?? null,
    temperature: profile.generation.temperature ?? null,
    topP: profile.generation.topP ?? null,
  };
}