/**
 * Coarse fallback estimate (M1-006). When the official `lms load --estimate-only`
 * answer cannot be trusted (server off, timeout, unpauseable daemon, output
 * drift), this expresses exactly what the caller still knows — the model key,
 * its inferred quantization and the requested context / offload policy — with
 * `provider: 'rough'` and measured memory figures left null. It is an honest
 * "no number" instead of a fabricated one: high-risk profiles must never be
 * silently approved on the strength of an unmeasured estimate.
 */
import { SCHEMA_VERSION, type CompositeProfile, type LoadEstimate } from '@lmps/domain';

import { parseModelIdentity } from '../model-names.js';

export const ROUGH_ESTIMATE_WARNING =
  'Official estimate unavailable (server offline or unparseable); VRAM and system RAM are not measured. Do not treat this as approval for a high-VRAM profile.';

export function roughEstimateFor(profile: CompositeProfile, estimatedAt: string): LoadEstimate {
  const identity = parseModelIdentity(profile.model.modelKey);
  const gpuOffload = profile.runtime.gpuOffload;
  return {
    schemaVersion: SCHEMA_VERSION,
    provider: 'rough',
    modelKey: profile.model.modelKey,
    quantization: identity.quantization,
    contextLength: profile.runtime.contextLength ?? null,
    gpuOffload: typeof gpuOffload === 'number' ? gpuOffload : null,
    vramTotalBytes: null,
    systemRamBytes: null,
    hardwareFingerprint: null,
    estimatedAt,
    warnings: [ROUGH_ESTIMATE_WARNING],
  };
}