/**
 * Computes conservative resource deltas from synchronized host snapshots.
 * The first snapshot is the pre-load baseline; every later snapshot is a
 * post-load or post-inference observation. Missing baseline/components remain
 * unknown rather than being inferred, and counter noise is clamped to zero.
 */
import type { HardwareProfile, ResourceUsageEvidence } from '@lmps/domain';

interface ResourcePoint {
  vramBytes: number | null;
  systemRamBytes: number | null;
}

function gpuUsedBytes(profile: HardwareProfile | null): number | null {
  const gpus = profile?.gpus;
  if (gpus === null || gpus === undefined || gpus.length === 0) return null;
  let used = 0;
  for (const gpu of gpus) {
    if (!Number.isFinite(gpu.vramTotalBytes) || !Number.isFinite(gpu.vramAvailableBytes)) return null;
    used += Math.max(0, gpu.vramTotalBytes - gpu.vramAvailableBytes);
  }
  return used;
}

function systemRamUsedBytes(profile: HardwareProfile | null): number | null {
  const memory = profile?.memory;
  if (memory === null || memory === undefined) return null;
  if (typeof memory.totalBytes !== 'number' || typeof memory.availableBytes !== 'number') return null;
  if (!Number.isFinite(memory.totalBytes) || !Number.isFinite(memory.availableBytes)) return null;
  return Math.max(0, memory.totalBytes - memory.availableBytes);
}

function point(profile: HardwareProfile | null): ResourcePoint {
  return { vramBytes: gpuUsedBytes(profile), systemRamBytes: systemRamUsedBytes(profile) };
}

function delta(current: number | null, baseline: number | null): number | null {
  if (current === null || baseline === null) return null;
  return Math.max(0, current - baseline);
}

/**
 * Builds the public v1 evidence object. `sampleCount` is the number of
 * successfully measured inference samples; the load observation is included
 * in the peak but does not inflate that count.
 */
export function buildResourceUsageEvidence(
  baseline: HardwareProfile | null,
  observations: readonly HardwareProfile[],
  sampleCount: number,
): ResourceUsageEvidence {
  const base = point(baseline);
  const deltas = observations.map((observation) => {
    const current = point(observation);
    return {
      vramBytes: delta(current.vramBytes, base.vramBytes),
      systemRamBytes: delta(current.systemRamBytes, base.systemRamBytes),
    };
  });
  const vramValues = deltas.flatMap((value) => (value.vramBytes === null ? [] : [value.vramBytes]));
  const ramValues = deltas.flatMap((value) => (value.systemRamBytes === null ? [] : [value.systemRamBytes]));
  const totalValues = deltas.flatMap((value) =>
    value.vramBytes === null || value.systemRamBytes === null ? [] : [value.vramBytes + value.systemRamBytes],
  );
  const vramBytes = vramValues.length === 0 ? null : Math.max(...vramValues);
  const systemRamBytes = ramValues.length === 0 ? null : Math.max(...ramValues);
  const totalBytes = totalValues.length === 0 ? null : Math.max(...totalValues);
  const completeness = totalBytes !== null ? 'complete' : vramBytes !== null || systemRamBytes !== null ? 'partial' : 'unavailable';

  const normalizedSampleCount = Number.isFinite(sampleCount) ? Math.max(0, Math.trunc(sampleCount)) : 0;
  return {
    schemaVersion: 1,
    method: 'host-snapshot-delta',
    sampleCount: normalizedSampleCount,
    completeness,
    peakDelta: { vramBytes, systemRamBytes, totalBytes },
  };
}
