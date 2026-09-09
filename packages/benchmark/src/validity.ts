/**
 * Fingerprint and identity invalidation for benchmark results (M2-003). A past
 * result is only evidence for the current configuration when the hardware
 * fingerprint, LM Studio/runtime versions and model identity it was captured
 * under still match. Returns a stable set of reason slugs so consumers can show
 * an exact invalidation cause instead of an opaque boolean.
 */
import type { BenchmarkResult } from '@lmps/domain';

export interface BenchmarkIdentity {
  modelKey: string;
  quantization: string | null;
  hardwareFingerprint: string | null;
  lmStudioVersion: string | null;
  runtimeVersion: string | null;
}

export interface Validity {
  valid: boolean;
  reasons: string[];
}

export function isBenchmarkValidFor(result: BenchmarkResult, identity: BenchmarkIdentity): Validity {
  const reasons: string[] = [];
  if (result.hardwareFingerprint !== identity.hardwareFingerprint) reasons.push('hardware-fingerprint');
  if (result.lmStudioVersion !== identity.lmStudioVersion) reasons.push('lm-studio-version');
  if (result.runtimeVersion !== identity.runtimeVersion) reasons.push('runtime-version');
  if (result.modelKey !== identity.modelKey) reasons.push('model-key');
  if (result.quantization !== identity.quantization) reasons.push('quantization');
  return { valid: reasons.length === 0, reasons };
}