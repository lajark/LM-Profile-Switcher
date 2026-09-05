/**
 * VRAM safety margin (PRD FR-07 step 4, M2-002).
 *
 * A candidate is safe when the exact estimate reports its predicted VRAM use
 * (`LoadEstimate.vramTotalBytes`) and that stays within the available VRAM of
 * the probed hardware (`HardwareProfile.gpus[].vramAvailableBytes`, summed). A
 * `rough` estimate cannot prove safety and always fails closed; a machine with
 * no probed GPUs cannot either. The rule's `minVramBytes` constraint is a floor
 * the available VRAM must clear before the model's own footprint is judged.
 *
 * `reason` carries a stable code (not prose) so the display layer localizes the
 * short vocabulary instead of parsing free text.
 */
import type { HardwareProfile, LoadEstimate, Rule } from '@lmps/domain';

export interface SafetyMargin {
  safe: boolean;
  /** Stable reason code when unsafe; null when safe. */
  reason: string | null;
  vramUsedBytes: number | null;
  vramAvailableBytes: number | null;
  headroomBytes: number | null;
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

  const floor = ruleFloorBytes(rule);
  if (floor !== null && (available === null || available < floor)) {
    return { safe: false, reason: 'under-min-vram', vramUsedBytes: used, vramAvailableBytes: available, headroomBytes: null };
  }

  if (estimate.provider !== 'exact' || used === null) {
    return { safe: false, reason: 'rough-estimate', vramUsedBytes: used, vramAvailableBytes: available, headroomBytes: null };
  }
  if (available === null) {
    return { safe: false, reason: 'no-gpu-vram', vramUsedBytes: used, vramAvailableBytes: null, headroomBytes: null };
  }

  const headroomBytes = available - used;
  if (headroomBytes < 0) {
    return { safe: false, reason: 'over-vram', vramUsedBytes: used, vramAvailableBytes: available, headroomBytes };
  }

  return {
    safe: true,
    reason: null,
    vramUsedBytes: used,
    vramAvailableBytes: available,
    headroomBytes,
  };
}