// M5-001 resource-fit classification seam (PRD FR-07, CONTEXT.md): a candidate
// whose VRAM estimate exceeds the card is NOT automatically
// Resource-insufficient — when the host memory can carry the whole footprint
// it is Hybrid-memory or Host-memory. These tests lock the five classes and the
// PRD default reserves (max(512MiB, 5% total VRAM), max(2GiB, 10% total RAM)).
import { describe, expect, it } from 'vitest';
import {
  classifyResourceFit,
  DEFAULT_GPU_RESERVE_FRACTION,
  DEFAULT_GPU_RESERVE_MIN_BYTES,
  DEFAULT_RAM_RESERVE_FRACTION,
  DEFAULT_RAM_RESERVE_MIN_BYTES,
  gpuReserveBytes,
  ramReserveBytes,
} from '@lmps/optimizer';
import type { HardwareProfile } from '@lmps/domain';

import { GIB, makeExactEstimate, makeHardware } from './fixtures';

/** 16 GiB card with 12 GiB free, 32 GiB host with 28 GiB free (fixtures default). */
const MIB = 1024 ** 2;

describe('reserve defaults (PRD FR-07)', () => {
  it('reserves max(512 MiB, 5% total VRAM)', () => {
    expect(DEFAULT_GPU_RESERVE_MIN_BYTES).toBe(512 * MIB);
    expect(DEFAULT_GPU_RESERVE_FRACTION).toBe(0.05);
    expect(gpuReserveBytes(16 * GIB)).toBe(Math.round(0.8 * GIB));
    expect(gpuReserveBytes(4 * GIB)).toBe(512 * MIB); // floor wins
    expect(gpuReserveBytes(null)).toBe(512 * MIB); // unknown total → floor
  });

  it('reserves max(2 GiB, 10% total RAM)', () => {
    expect(DEFAULT_RAM_RESERVE_MIN_BYTES).toBe(2 * GIB);
    expect(DEFAULT_RAM_RESERVE_FRACTION).toBe(0.1);
    expect(ramReserveBytes(32 * GIB)).toBe(Math.round(3.2 * GIB));
    expect(ramReserveBytes(8 * GIB)).toBe(2 * GIB); // floor wins
    expect(ramReserveBytes(null)).toBe(2 * GIB);
  });
});

describe('classifyResourceFit', () => {
  it('classifies a VRAM-fitting exact estimate as GPU-resident and recommendable', () => {
    const verdict = classifyResourceFit(makeExactEstimate({ vramTotalBytes: 6 * GIB, systemRamBytes: 2 * GIB }), makeHardware());
    expect(verdict).toMatchObject({
      resourceFit: 'gpu-resident',
      recommendable: true,
      vramReserveBytes: Math.round(0.8 * GIB),
      ramUsedBytes: 2 * GIB,
      ramAvailableBytes: 28 * GIB,
      ramReserveBytes: Math.round(3.2 * GIB),
      ramHeadroomBytes: 28 * GIB - Math.round(3.2 * GIB) - 2 * GIB,
    });
  });

  it('never marks an over-VRAM 27B-class estimate Resource-insufficient when RAM can carry it', () => {
    // Regression input from the real machine (README/27B): 15.7 GiB weights,
    // 16 GiB card (12 GiB free) — but 28 GiB host RAM free.
    const verdict = classifyResourceFit(
      makeExactEstimate({ vramTotalBytes: 15.7 * GIB, totalMemoryBytes: 15.7 * GIB, systemRamBytes: null }),
      makeHardware(),
    );
    expect(verdict.resourceFit).toBe('hybrid-memory');
    expect(verdict.recommendable).toBe(true);
  });

  it('classifies a 35B-class over-VRAM footprint that fits host memory as Hybrid-memory', () => {
    const verdict = classifyResourceFit(
      makeExactEstimate({ vramTotalBytes: 19.7 * GIB, totalMemoryBytes: 19.7 * GIB, systemRamBytes: null }),
      makeHardware(),
    );
    expect(verdict.resourceFit).toBe('hybrid-memory');
    expect(verdict.recommendable).toBe(true);
  });

  it('classifies a zero-GPU-offload estimate as Host-memory when RAM fits', () => {
    const verdict = classifyResourceFit(
      makeExactEstimate({ vramTotalBytes: 0, totalMemoryBytes: 15.7 * GIB, systemRamBytes: 15.7 * GIB, gpuOffload: 0 }),
      makeHardware(),
    );
    expect(verdict.resourceFit).toBe('host-memory');
    expect(verdict.recommendable).toBe(true);
  });

  it('marks Resource-insufficient only when BOTH VRAM and host memory are judged too small', () => {
    const tinyHost: HardwareProfile = makeHardware({ memory: { totalBytes: 16 * GIB, availableBytes: 8 * GIB } });
    const verdict = classifyResourceFit(
      makeExactEstimate({ vramTotalBytes: 20 * GIB, totalMemoryBytes: 20 * GIB, systemRamBytes: null }),
      tinyHost,
    );
    expect(verdict.resourceFit).toBe('resource-insufficient');
    expect(verdict.recommendable).toBe(false);
  });

  it('stays Resource-unknown for a rough estimate even when numbers would fit', () => {
    const verdict = classifyResourceFit(makeExactEstimate({ provider: 'rough', vramTotalBytes: 6 * GIB }), makeHardware());
    expect(verdict.resourceFit).toBe('resource-unknown');
    expect(verdict.recommendable).toBe(false);
  });

  it('stays Resource-unknown when the estimate reports no VRAM figure', () => {
    const verdict = classifyResourceFit(makeExactEstimate({ vramTotalBytes: null }), makeHardware());
    expect(verdict.resourceFit).toBe('resource-unknown');
  });

  it('stays Resource-unknown when host feasibility cannot be judged (no total, no RAM figure)', () => {
    const verdict = classifyResourceFit(
      makeExactEstimate({ vramTotalBytes: 15.7 * GIB, totalMemoryBytes: null, systemRamBytes: null }),
      makeHardware(),
    );
    expect(verdict.resourceFit).toBe('resource-unknown');
  });

  it('stays Resource-unknown when host memory was never probed', () => {
    const noRam: HardwareProfile = makeHardware({ memory: null });
    const verdict = classifyResourceFit(
      makeExactEstimate({ vramTotalBytes: 15.7 * GIB, totalMemoryBytes: 15.7 * GIB, systemRamBytes: null }),
      noRam,
    );
    expect(verdict.resourceFit).toBe('resource-unknown');
  });

  it('stays Resource-unknown when GPU availability is unknown and host fits', () => {
    // No probed GPU: the verdict cannot promise hybrid residency, but must not
    // claim insufficiency either.
    const noGpus: HardwareProfile = makeHardware({ gpus: [] });
    const verdict = classifyResourceFit(
      makeExactEstimate({ vramTotalBytes: 8 * GIB, totalMemoryBytes: 8 * GIB, systemRamBytes: null }),
      noGpus,
    );
    expect(verdict.resourceFit).toBe('resource-unknown');
  });

  it('computes RAM headroom from available minus reserve minus usage', () => {
    const verdict = classifyResourceFit(makeExactEstimate({ vramTotalBytes: 6 * GIB, systemRamBytes: 2 * GIB }), makeHardware());
    expect(verdict.ramHeadroomBytes).toBe(28 * GIB - Math.round(3.2 * GIB) - 2 * GIB);
  });
});
