// Orchestrator tests: probeHardware with an injected ProbeEnv must never crash
// on partial failure and must always return a contract-valid HardwareProfile.
import { HardwareProfileSchema, StrictHardwareProfileSchema } from '@lmps/domain';
import { probeHardware } from '@lmps/hardware';
import { describe, expect, it } from 'vitest';

import {
  FAKE_FREE_MEM,
  FAKE_NOW,
  FAKE_TOTAL_MEM,
  FAIL,
  TIMED_OUT,
  batteryJsonAc,
  batteryJsonDischarging,
  coresJson,
  diskDrivesJson,
  diskToPartitionJson,
  logicalDisksJson,
  logicalToPartitionJson,
  makeFakeProbeEnv,
  nvidiaSmiPartialVram,
  nvidiaSmiTwoGpus,
  okResult,
  registryNamesJson,
  statfsSnapshot,
  volumeJsonArray,
  volumeJsonSingle,
  volumeJsonMalformed,
} from './fixtures.js';

const MIB = 1048576;

const VERSIONS_NULL = {
  lmStudio: null,
  daemon: null,
  server: null,
  runtime: null,
  api: null,
} as const;

describe('probeHardware happy path', () => {
  it('assembles a complete profile from reliable NVIDIA + WMI sources', async () => {
    const profile = await probeHardware(
      makeFakeProbeEnv({
        nvidiaSmi: okResult(nvidiaSmiTwoGpus),
        cores: okResult(coresJson),
        volumes: okResult(volumeJsonArray),
        battery: okResult(batteryJsonAc),
      }),
    );

    expect(profile).toEqual({
      schemaVersion: 2,
      os: 'Windows 11 Pro (x64)',
      cpu: { model: 'Physon X9 990', cores: 8, threads: 3 },
      memory: { totalBytes: FAKE_TOTAL_MEM, availableBytes: FAKE_FREE_MEM },
      gpus: [
        { name: 'Synthetic RTX 9000', driverVersion: '610.11', vramTotalBytes: 24576 * MIB, vramAvailableBytes: 20000 * MIB },
        { name: 'Synthetic RTX 9001', driverVersion: '610.11', vramTotalBytes: 4096 * MIB, vramAvailableBytes: 3000 * MIB },
      ],
      volumes: [
        { mount: 'X:\\', totalBytes: 1099511627776, availableBytes: 549755813888, driveType: null, bus: null, external: null, model: null },
        { mount: 'Y:\\', totalBytes: 2199023255552, availableBytes: 1099511627776, driveType: null, bus: null, external: null, model: null },
      ],
      power: { onBattery: false },
      versions: VERSIONS_NULL,
      hardwareFingerprint: expect.stringMatching(/^fake:/),
      probedAt: FAKE_NOW,
    });

    expect(HardwareProfileSchema.safeParse(profile).success).toBe(true);
    expect(StrictHardwareProfileSchema.safeParse(profile).success).toBe(true);
  });

  it('produces a deterministic fingerprint for identical hardware', async () => {
    const env = makeFakeProbeEnv({ nvidiaSmi: okResult(nvidiaSmiTwoGpus), cores: okResult(coresJson), volumes: okResult(volumeJsonArray) });
    const a = await probeHardware(env);
    const b = await probeHardware(env);
    expect(a.hardwareFingerprint).toBe(b.hardwareFingerprint);
    expect(a.hardwareFingerprint).toBeDefined();
  });

  it('reports a discharging battery as onBattery true', async () => {
    const profile = await probeHardware(
      makeFakeProbeEnv({ battery: okResult(batteryJsonDischarging) }),
    );
    expect(profile.power).toEqual({ onBattery: true });
  });

  it('classifies external disks from the four joined WMI tables', async () => {
    const profile = await probeHardware(
      makeFakeProbeEnv({
        volumes: okResult(logicalDisksJson),
        diskDrives: okResult(diskDrivesJson),
        diskToPartition: okResult(diskToPartitionJson),
        logicalToPartition: okResult(logicalToPartitionJson),
      }),
    );
    expect(profile.volumes).toEqual([
      {
        mount: 'X:\\',
        totalBytes: 1099511627776,
        availableBytes: 549755813888,
        driveType: 3,
        bus: 'NVMe',
        external: false,
        model: 'Synthetic NVMe',
      },
      {
        mount: 'Y:\\',
        totalBytes: 2199023255552,
        availableBytes: 1099511627776,
        driveType: 2,
        bus: 'USB',
        external: true,
        model: 'Synthetic USB SSD',
      },
    ]);
  });

  it('keeps volumes enumerated (columns null) when only the disk tables fail', async () => {
    const profile = await probeHardware(makeFakeProbeEnv({ volumes: okResult(logicalDisksJson) }));
    expect(profile.volumes).toEqual([
      {
        mount: 'X:\\',
        totalBytes: 1099511627776,
        availableBytes: 549755813888,
        driveType: 3,
        bus: null,
        external: null,
        model: null,
      },
      {
        mount: 'Y:\\',
        totalBytes: 2199023255552,
        availableBytes: 1099511627776,
        driveType: 2,
        bus: null,
        external: true,
        model: null,
      },
    ]);
    expect(HardwareProfileSchema.safeParse(profile).success).toBe(true);
  });
});

describe('probeHardware partial failure', () => {
  it('falls back to gpus null when nvidia-smi fails, keeping generic names in the fingerprint', async () => {
    const profile = await probeHardware(
      makeFakeProbeEnv({ nvidiaSmi: FAIL, registry: okResult(registryNamesJson) }),
    );
    expect(profile.gpus).toBeNull();
    expect(profile.hardwareFingerprint).toMatch(/^fake:/);
    expect(HardwareProfileSchema.safeParse(profile).success).toBe(true);
  });

  it('treats an nvidia-smi timeout as Unknown, not a crash', async () => {
    const profile = await probeHardware(makeFakeProbeEnv({ nvidiaSmi: TIMED_OUT }));
    expect(profile.gpus).toBeNull();
    expect(profile.os).toBe('Windows 11 Pro (x64)');
  });

  it('keeps only GPU rows whose VRAM is fully known', async () => {
    const profile = await probeHardware(
      makeFakeProbeEnv({ nvidiaSmi: okResult(nvidiaSmiPartialVram) }),
    );
    expect(profile.gpus).toBeNull();
  });

  it('leaves cores null when the physical-core probe fails instead of faking it', async () => {
    const profile = await probeHardware(
      makeFakeProbeEnv({ nvidiaSmi: okResult(nvidiaSmiTwoGpus), cores: FAIL }),
    );
    expect(profile.cpu).toEqual({ model: 'Physon X9 990', cores: null, threads: 3 });
  });

  it('falls back to statfs of the home root when the volume probe fails', async () => {
    const profile = await probeHardware(
      makeFakeProbeEnv({ volumes: okResult(volumeJsonMalformed), volumeFallback: statfsSnapshot }),
    );
    expect(profile.volumes).toEqual([
      { mount: 'C:/', totalBytes: statfsSnapshot.blocks * statfsSnapshot.bsize, availableBytes: statfsSnapshot.bavail * statfsSnapshot.bsize },
    ]);
  });

  it('returns volumes null when both volume probes fail', async () => {
    const profile = await probeHardware(makeFakeProbeEnv({ volumes: FAIL }));
    expect(profile.volumes).toBeNull();
  });

  it('returns power null when the battery probe fails', async () => {
    const profile = await probeHardware(makeFakeProbeEnv({ battery: FAIL }));
    expect(profile.power).toBeNull();
  });

  it('keeps the volume list for a single-object ConvertTo-Json result', async () => {
    const profile = await probeHardware(makeFakeProbeEnv({ volumes: okResult(volumeJsonSingle) }));
    expect(profile.volumes).toEqual([
      { mount: 'Z:\\', totalBytes: 536870912000, availableBytes: 268435456000, driveType: null, bus: null, external: null, model: null },
    ]);
  });
});

describe('probeHardware total failure of external probes', () => {
  it('keeps node:os-backed sections and marks everything else Unknown', async () => {
    const profile = await probeHardware(makeFakeProbeEnv());
    expect(profile.schemaVersion).toBe(2);
    expect(profile.probedAt).toBe(FAKE_NOW);
    expect(profile.versions).toEqual(VERSIONS_NULL);
    // os/cpu/memory come from node:os and remain present even if every external probe fails.
    expect(profile.os).toBe('Windows 11 Pro (x64)');
    expect(profile.cpu).toEqual({ model: 'Physon X9 990', cores: null, threads: 3 });
    expect(profile.memory).toEqual({ totalBytes: FAKE_TOTAL_MEM, availableBytes: FAKE_FREE_MEM });
    expect(profile.gpus).toBeNull();
    expect(profile.volumes).toBeNull();
    expect(profile.power).toBeNull();
    expect(typeof profile.hardwareFingerprint).toBe('string');
    const result = HardwareProfileSchema.safeParse(profile);
    expect(result.success).toBe(true);
  });
});