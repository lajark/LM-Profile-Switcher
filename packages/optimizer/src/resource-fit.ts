/**
 * Resource-fit classification seam (M5-001, PRD FR-07 / CONTEXT.md): decides
 * whether one estimate + hardware pair is GPU-resident, Hybrid-memory,
 * Host-memory, Resource-unknown or Resource-insufficient. It is deliberately a
 * *single-estimate* classifier — the offload ladder, candidate search and
 * ranking strategy that use it are M5-002. The key invariant: "larger than
 * VRAM" alone never means Resource-insufficient; when the host memory can
 * carry the whole footprint the estimate is Hybrid-memory or Host-memory.
 *
 * Reserves follow PRD FR-07 step 5: `max(512 MiB, 5% total VRAM)` for GPU and
 * `max(2 GiB, 10% total RAM)` for system memory. Pure module — no Node built-ins.
 */
import type { HardwareProfile, LoadEstimate, ResourceFit } from '@lmps/domain';

export const DEFAULT_GPU_RESERVE_MIN_BYTES = 512 * 1024 ** 2;
export const DEFAULT_GPU_RESERVE_FRACTION = 0.05;
export const DEFAULT_RAM_RESERVE_MIN_BYTES = 2 * 1024 ** 3;
export const DEFAULT_RAM_RESERVE_FRACTION = 0.1;

export interface ResourceFitVerdict {
  resourceFit: ResourceFit;
  recommendable: boolean;
  vramReserveBytes: number | null;
  ramUsedBytes: number | null;
  ramAvailableBytes: number | null;
  ramReserveBytes: number | null;
  ramHeadroomBytes: number | null;
}

/** GPU reserve: max(512 MiB, 5% total VRAM); unknown total → the 512 MiB floor. */
export function gpuReserveBytes(totalVramBytes: number | null): number {
  const fraction = totalVramBytes === null ? 0 : DEFAULT_GPU_RESERVE_FRACTION * totalVramBytes;
  return Math.round(Math.max(DEFAULT_GPU_RESERVE_MIN_BYTES, fraction));
}

/** RAM reserve: max(2 GiB, 10% total RAM); unknown total → the 2 GiB floor. */
export function ramReserveBytes(totalRamBytes: number | null): number {
  const fraction = totalRamBytes === null ? 0 : DEFAULT_RAM_RESERVE_FRACTION * totalRamBytes;
  return Math.round(Math.max(DEFAULT_RAM_RESERVE_MIN_BYTES, fraction));
}

function gpusOf(hardware: HardwareProfile): HardwareProfile['gpus'] {
  return hardware.gpus ?? null;
}

/** Sum of available VRAM across probed GPUs; null when any GPU is unprobed. */
function availableVramBytes(hardware: HardwareProfile): number | null {
  const gpus = gpusOf(hardware);
  if (gpus === null || gpus === undefined || gpus.length === 0) return null;
  let total = 0;
  for (const gpu of gpus) {
    const free = gpu.vramAvailableBytes;
    if (free === null || free === undefined || free < 0) return null;
    total += free;
  }
  return total;
}

/** Sum of total VRAM across probed GPUs; null when unprobed. */
function totalVramBytes(hardware: HardwareProfile): number | null {
  const gpus = gpusOf(hardware);
  if (gpus === null || gpus === undefined || gpus.length === 0) return null;
  let total = 0;
  for (const gpu of gpus) {
    if (gpu.vramTotalBytes === null || gpu.vramTotalBytes === undefined || gpu.vramTotalBytes < 0) return null;
    total += gpu.vramTotalBytes;
  }
  return total;
}

/** Host RAM availability: explicit available figure, else the total figure. */
function ramAvailableBytes(hardware: HardwareProfile): number | null {
  const memory = hardware.memory;
  if (memory === null || memory === undefined) return null;
  return memory.availableBytes ?? memory.totalBytes ?? null;
}

function totalRamBytes(hardware: HardwareProfile): number | null {
  return hardware.memory?.totalBytes ?? null;
}

/** Whole-footprint usage: the engine Total Memory figure, else VRAM + system RAM. */
function totalUsageBytes(estimate: LoadEstimate): number | null {
  if (estimate.totalMemoryBytes !== null && estimate.totalMemoryBytes !== undefined) return estimate.totalMemoryBytes;
  if (estimate.systemRamBytes === null || estimate.vramTotalBytes === null) return null;
  return estimate.vramTotalBytes + estimate.systemRamBytes;
}

const UNKNOWN: ResourceFitVerdict = {
  resourceFit: 'resource-unknown',
  recommendable: false,
  vramReserveBytes: null,
  ramUsedBytes: null,
  ramAvailableBytes: null,
  ramReserveBytes: null,
  ramHeadroomBytes: null,
};

/**
 * Classify one estimate against one hardware snapshot. Fail-closed: any missing
 * evidence that prevents a confident verdict yields `resource-unknown`, never a
 * fabricated fit. `recommendable` is true for GPU-resident / Hybrid-memory /
 * Host-memory (the actual recommendation policy that surfaces warnings is
 * M5-002/003; this seam only marks what the resource contract allows).
 */
export function classifyResourceFit(
  estimate: LoadEstimate,
  hardware: HardwareProfile,
): ResourceFitVerdict {
  if (estimate.provider !== 'exact' || estimate.vramTotalBytes === null) return UNKNOWN;

  const vramUsage = estimate.vramTotalBytes;
  const vramAvailable = availableVramBytes(hardware);
  const vramReserve = gpuReserveBytes(totalVramBytes(hardware));
  const ramUsed = estimate.systemRamBytes;
  const ramAvailable = ramAvailableBytes(hardware);
  const ramReserve = ramReserveBytes(totalRamBytes(hardware));

  const base = {
    vramReserveBytes: vramReserve,
    ramUsedBytes: ramUsed,
    ramAvailableBytes: ramAvailable,
    ramReserveBytes: ramReserve,
    ramHeadroomBytes: ramAvailable !== null && ramUsed !== null ? ramAvailable - ramReserve - ramUsed : null,
  };

  // Host-resident claim: zero GPU offload / zero VRAM usage is Host-memory
  // when RAM fits, Resource-insufficient when even RAM cannot carry it.
  const hostOnly = vramUsage === 0 || estimate.gpuOffload === 0;
  if (hostOnly) {
    const total = totalUsageBytes(estimate);
    if (total === null || ramAvailable === null) return { ...base, resourceFit: 'resource-unknown', recommendable: false };
    if (total + ramReserve <= ramAvailable) {
      return { ...base, resourceFit: 'host-memory', recommendable: true };
    }
    return { ...base, resourceFit: 'resource-insufficient', recommendable: false };
  }

  if (vramAvailable !== null && vramUsage + vramReserve <= vramAvailable) {
    return { ...base, resourceFit: 'gpu-resident', recommendable: true };
  }

  // Does not fit VRAM (or VRAM is unprobed): the host is the deciding factor.
  const total = totalUsageBytes(estimate);
  if (total === null || ramAvailable === null) {
    return { ...base, resourceFit: 'resource-unknown', recommendable: false };
  }
  if (total + ramReserve <= ramAvailable) {
    if (vramAvailable !== null) {
      return { ...base, resourceFit: 'hybrid-memory', recommendable: true };
    }
    return { ...base, resourceFit: 'resource-unknown', recommendable: false };
  }
  if (vramAvailable !== null) {
    return { ...base, resourceFit: 'resource-insufficient', recommendable: false };
  }
  return { ...base, resourceFit: 'resource-unknown', recommendable: false };
}
