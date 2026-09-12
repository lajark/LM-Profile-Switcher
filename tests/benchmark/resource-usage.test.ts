import { describe, expect, it } from 'vitest';
import type { HardwareProfile } from '@lmps/domain';
import { buildResourceUsageEvidence } from '@lmps/benchmark';

const GIB = 1024 ** 3;

function hardware(overrides: Partial<HardwareProfile> = {}): HardwareProfile {
  return {
    schemaVersion: 2,
    gpus: [{ name: 'gpu-0', vramTotalBytes: 16 * GIB, vramAvailableBytes: 14 * GIB }],
    memory: { totalBytes: 32 * GIB, availableBytes: 24 * GIB },
    probedAt: '2026-09-12T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildResourceUsageEvidence', () => {
  it('reports synchronized VRAM and system-RAM deltas and their total', () => {
    const baseline = hardware();
    const afterLoad = hardware({ gpus: [{ name: 'gpu-0', vramTotalBytes: 16 * GIB, vramAvailableBytes: 13 * GIB }], memory: { totalBytes: 32 * GIB, availableBytes: 23 * GIB } });
    const afterSample = hardware({ gpus: [{ name: 'gpu-0', vramTotalBytes: 16 * GIB, vramAvailableBytes: 12 * GIB }], memory: { totalBytes: 32 * GIB, availableBytes: 22 * GIB } });

    expect(buildResourceUsageEvidence(baseline, [afterLoad, afterSample], 2)).toEqual({
      schemaVersion: 1,
      method: 'host-snapshot-delta',
      sampleCount: 2,
      completeness: 'complete',
      peakDelta: { vramBytes: 2 * GIB, systemRamBytes: 2 * GIB, totalBytes: 4 * GIB },
    });
  });

  it('clamps negative noise to zero and sums multiple GPUs', () => {
    const baseline = hardware({
      gpus: [
        { name: 'gpu-0', vramTotalBytes: 8 * GIB, vramAvailableBytes: 7 * GIB },
        { name: 'gpu-1', vramTotalBytes: 8 * GIB, vramAvailableBytes: 6 * GIB },
      ],
      memory: { totalBytes: 32 * GIB, availableBytes: 24 * GIB },
    });
    const sample = hardware({
      gpus: [
        { name: 'gpu-0', vramTotalBytes: 8 * GIB, vramAvailableBytes: 6 * GIB },
        { name: 'gpu-1', vramTotalBytes: 8 * GIB, vramAvailableBytes: 5 * GIB },
      ],
      memory: { totalBytes: 32 * GIB, availableBytes: 25 * GIB },
    });

    const evidence = buildResourceUsageEvidence(baseline, [sample], 1);
    expect(evidence.peakDelta.vramBytes).toBe(2 * GIB); // sum delta, not max GPU
    expect(evidence.peakDelta.systemRamBytes).toBe(0);
    expect(evidence.peakDelta.totalBytes).toBe(2 * GIB);
  });

  it('marks missing components partial and refuses a total', () => {
    const baseline = hardware({ memory: null });
    const sample = hardware({ memory: null, gpus: [{ name: 'gpu-0', vramTotalBytes: 16 * GIB, vramAvailableBytes: 12 * GIB }] });
    expect(buildResourceUsageEvidence(baseline, [sample], 1)).toMatchObject({
      completeness: 'partial',
      peakDelta: { vramBytes: 2 * GIB, systemRamBytes: null, totalBytes: null },
    });
  });

  it('returns unavailable when no synchronized component can be measured', () => {
    const baseline = hardware({ gpus: null, memory: null });
    const sample = hardware({ gpus: null, memory: null });
    expect(buildResourceUsageEvidence(baseline, [sample], 1)).toEqual({
      schemaVersion: 1,
      method: 'host-snapshot-delta',
      sampleCount: 1,
      completeness: 'unavailable',
      peakDelta: { vramBytes: null, systemRamBytes: null, totalBytes: null },
    });
  });

  it('normalizes non-finite sample counts to zero', () => {
    const evidence = buildResourceUsageEvidence(hardware(), [], Number.NaN);
    expect(evidence.sampleCount).toBe(0);
  });
});
