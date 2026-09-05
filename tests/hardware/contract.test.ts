// Contract lock: everything probeHardware emits must satisfy the published
// HardwareProfile contract, and the contract itself behaves as the layer
// expects (Unknown expressed via null, strict mode rejects passthrough extras).
import { HardwareProfileSchema, StrictHardwareProfileSchema } from '@lmps/domain';
import { describe, expect, it } from 'vitest';

const minimalProfile = {
  schemaVersion: 2,
  probedAt: '2026-08-22T01:02:03.000Z',
};

const fullProfile = {
  schemaVersion: 2,
  os: 'Windows 11 Pro (x64)',
  cpu: { model: 'Physon X9 990', cores: 8, threads: 8 },
  memory: { totalBytes: 34_359_738_368, availableBytes: 17_179_869_184 },
  gpus: [{ name: 'Synthetic RTX 9000', driverVersion: null, vramTotalBytes: 25_769_070_592, vramAvailableBytes: 20_971_520_000 }],
  volumes: [{ mount: 'X:\\', totalBytes: 1_099_511_627_776, availableBytes: 549_755_813_888 }],
  power: { onBattery: false },
  versions: { lmStudio: null, daemon: null, server: null, runtime: null, api: null },
  hardwareFingerprint: 'fp-123abc',
  probedAt: '2026-08-22T01:02:03.000Z',
};

describe('HardwareProfile contract', () => {
  it('accepts a minimal all-Unknown profile', () => {
    expect(HardwareProfileSchema.safeParse(minimalProfile).success).toBe(true);
    expect(StrictHardwareProfileSchema.safeParse(minimalProfile).success).toBe(true);
  });

  it('accepts a fully populated profile with null driver/versions', () => {
    const result = HardwareProfileSchema.safeParse(fullProfile);
    expect(result.success).toBe(true);
    expect(StrictHardwareProfileSchema.safeParse(fullProfile).success).toBe(true);
  });

  it('keeps unknown fields by default and rejects them in strict mode', () => {
    const withExtra = { ...fullProfile, diagnosticTag: 'extra' };
    expect(HardwareProfileSchema.safeParse(withExtra).success).toBe(true);
    const strict = StrictHardwareProfileSchema.safeParse(withExtra);
    expect(strict.success).toBe(false);
  });

  it('accepts zero-VRAM GPU entries (Unknown expressed as 0)', () => {
    const profile = {
      ...minimalProfile,
      gpus: [{ name: 'Synthetic iGPU 2000', vramTotalBytes: 0, vramAvailableBytes: 0 }],
    };
    expect(HardwareProfileSchema.safeParse(profile).success).toBe(true);
  });

  it('rejects negative byte counts and empty GPU names', () => {
    expect(HardwareProfileSchema.safeParse({ ...minimalProfile, memory: { totalBytes: -1 } }).success).toBe(false);
    expect(
      HardwareProfileSchema.safeParse({
        ...minimalProfile,
        gpus: [{ name: '', vramTotalBytes: 0, vramAvailableBytes: 0 }],
      }).success,
    ).toBe(false);
  });

  it('rejects a malformed probedAt timestamp', () => {
    expect(HardwareProfileSchema.safeParse({ ...minimalProfile, probedAt: 'yesterday' }).success).toBe(false);
  });
});