// Fingerprint tests: the digest must be deterministic, order-insensitive, and
// built only from stable, non-identifying hardware fields.
import { computeHardwareFingerprint, type FingerprintInput } from '@lmps/hardware';
import { describe, expect, it } from 'vitest';

const BASE: FingerprintInput = {
  os: 'Windows 11 Pro (x64)',
  arch: 'x64',
  cpuModel: 'Physon X9 990',
  cores: 8,
  threads: 8,
  totalMemoryBytes: 34_359_738_368,
  gpuNames: ['Synthetic RTX 9000', 'Synthetic iGPU 2000'],
  volumeTotalBytes: [1_099_511_627_776, 2_199_023_255_552],
};

const identity = (data: string): string => data;

describe('computeHardwareFingerprint', () => {
  it('is deterministic for identical input', () => {
    expect(computeHardwareFingerprint(BASE, identity)).toBe(computeHardwareFingerprint(BASE, identity));
  });

  it('is insensitive to the order of the gpuNames and volume lists', () => {
    const shuffled: FingerprintInput = {
      ...BASE,
      gpuNames: ['Synthetic iGPU 2000', 'Synthetic RTX 9000'],
      volumeTotalBytes: [2_199_023_255_552, 1_099_511_627_776],
    };
    expect(computeHardwareFingerprint(shuffled, identity)).toBe(computeHardwareFingerprint(BASE, identity));
  });

  it('canonical payload contains exactly the stable fields, in stable order', () => {
    const payload = computeHardwareFingerprint(BASE, identity);
    expect(JSON.parse(payload)).toEqual({
      os: 'Windows 11 Pro (x64)',
      arch: 'x64',
      cpuModel: 'Physon X9 990',
      cores: 8,
      threads: 8,
      totalMemoryBytes: 34_359_738_368,
      gpuNames: ['Synthetic iGPU 2000', 'Synthetic RTX 9000'],
      volumeTotalBytes: [1_099_511_627_776, 2_199_023_255_552],
    });
    // Stable serialization: nothing host/user/serial-ish may leak in.
    expect(payload).not.toMatch(/host|user|serial|lajar/i);
    expect(Object.keys(JSON.parse(payload)).join(',')).toBe(
      'os,arch,cpuModel,cores,threads,totalMemoryBytes,gpuNames,volumeTotalBytes',
    );
  });

  it('changes when the CPU changes', () => {
    const other: FingerprintInput = { ...BASE, cpuModel: 'Other CPU 1' };
    expect(computeHardwareFingerprint(other, identity)).not.toBe(computeHardwareFingerprint(BASE, identity));
  });

  it('changes when the RAM or arch changes', () => {
    const otherRam: FingerprintInput = { ...BASE, totalMemoryBytes: (BASE.totalMemoryBytes ?? 0) * 2 };
    const otherArch: FingerprintInput = { ...BASE, arch: 'arm64' };
    expect(computeHardwareFingerprint(otherRam, identity)).not.toBe(computeHardwareFingerprint(BASE, identity));
    expect(computeHardwareFingerprint(otherArch, identity)).not.toBe(computeHardwareFingerprint(BASE, identity));
  });

  it('keeps working with null hw values (partial-failure profile)', () => {
    const minimal: FingerprintInput = {
      os: 'Windows 11 Pro (x64)',
      arch: 'x64',
      cpuModel: null,
      cores: null,
      threads: 4,
      totalMemoryBytes: null,
      gpuNames: [],
      volumeTotalBytes: [],
    };
    const a = computeHardwareFingerprint(minimal, identity);
    expect(JSON.parse(a)).toEqual({
      os: 'Windows 11 Pro (x64)',
      arch: 'x64',
      cpuModel: null,
      cores: null,
      threads: 4,
      totalMemoryBytes: null,
      gpuNames: [],
      volumeTotalBytes: [],
    });
  });
});