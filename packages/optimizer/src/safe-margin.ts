/**
 * VRAM safety margin (PRD FR-07 step 4, M2-002) + resource-fit verdict
 * (M5-001). The legacy half is unchanged: a candidate is `safe` when the exact
 * estimate reports its predicted VRAM use and that stays within the available
 * VRAM of the probed hardware; a `rough` estimate cannot prove safety and
 * always fails closed. The M5-001 half adds the RAM-aware classification —
 * `resourceFit` / `recommendable` / budget fields — so "larger than VRAM" no
 * longer reads as "not runnable" (see `resource-fit.ts`). Old consumers keep
 * reading `safe`/`reason`/`headroomBytes` unchanged.
 *
 * `reason` carries a stable code (not prose) so the display layer localizes the
 * short vocabulary instead of parsing free text.
 */
import type { HardwareProfile, LoadEstimate, ResourceFit, Rule } from '@lmps/domain';

import { classifyResourceFit } from './resource-fit.js';

export interface SafetyMargin {
  /** @deprecated M5-001: VRAM-only verdict; use `resourceFit`/`recommendable` for the RAM-aware judgment. */
  safe: boolean;
  /** Stable reason code when unsafe; null when safe. */
  reason: string | null;
  vramUsedBytes: number | null;
  vramAvailableBytes: number | null;
  /** @deprecated M5-001: VRAM-only headroom; the RAM budget trio below is the M5-001 contract. */
  headroomBytes: number | null;
  /** M5-001 resource-fit class (GPU-resident / Hybrid-memory / Host-memory / unknown / insufficient). */
  resourceFit: ResourceFit;
  /** M5-001: may be recommended under the resource contract (fit class is resident/hybrid/host). */
  recommendable: boolean;
  /** M5-001 reserved VRAM headroom (max(512 MiB, 5% total VRAM)). */
  vramReserveBytes: number | null;
  /** M5-001 predicted system RAM usage; null when unknown. */
  ramUsedBytes: number | null;
  /** M5-001 available system RAM; null when unknown. */
  ramAvailableBytes: number | null;
  /** M5-001 reserved RAM headroom (max(2 GiB, 10% total RAM)). */
  ramReserveBytes: number | null;
  /** M5-001 RAM headroom = available - reserve - usage; null unless all known. */
  ramHeadroomBytes: number | null;
}

function availableVramBytes(hardware: HardwareProfile): number | null {
  const gpus = hardware.gpus;
  if (gpus === null || gpus === undefined || gpus.length === 0) return null;
  let total = 0;
  for (const gpu of gpus) {
    const free = gpu.vramAvailableBytes;
    if (free === null || free === undefined || free < 0) return null;
    total += free;
  }
  return total;
}

function ruleFloorBytes(rule: Rule | undefined): number | null {
  const floor = rule?.constraints?.minVramBytes;
  return floor === undefined ? null : floor;
}

/** Compute whether the estimate fits the hardware, for one candidate. */
export function computeSafetyMargin(
  estimate: LoadEstimate,
  hardware: HardwareProfile,
  rule?: Rule,
): SafetyMargin {
  const used = estimate.vramTotalBytes;
  const available = availableVramBytes(hardware);
  const fit = classifyResourceFit(estimate, hardware);

  const floor = ruleFloorBytes(rule);
  if (floor !== null && (available === null || available < floor)) {
    return { safe: false, reason: 'under-min-vram', vramUsedBytes: used, vramAvailableBytes: available, headroomBytes: null, ...fit };
  }

  if (estimate.provider !== 'exact' || used === null) {
    return { safe: false, reason: 'rough-estimate', vramUsedBytes: used, vramAvailableBytes: available, headroomBytes: null, ...fit };
  }
  if (available === null) {
    return { safe: false, reason: 'no-gpu-vram', vramUsedBytes: used, vramAvailableBytes: null, headroomBytes: null, ...fit };
  }

  const headroomBytes = available - used;
  if (headroomBytes < 0) {
    return { safe: false, reason: 'over-vram', vramUsedBytes: used, vramAvailableBytes: available, headroomBytes, ...fit };
  }

  return {
    safe: true,
    reason: null,
    vramUsedBytes: used,
    vramAvailableBytes: available,
    headroomBytes,
    ...fit,
  };
}