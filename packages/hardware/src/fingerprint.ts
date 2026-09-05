/**
 * Hardware fingerprint (FR-02, HardwareProfile.hardwareFingerprint).
 *
 * Only stable, non-identifying fields (OS label, arch, CPU model/counts, RAM,
 * sorted GPU names and volume byte totals) participate. Hostname, username,
 * serial numbers and paths must never enter the input — the digest is a pure
 * injected function so this module needs no Node platform access.
 */
export interface FingerprintInput {
  os: string;
  arch: string;
  cpuModel: string | null;
  cores: number | null;
  threads: number | null;
  totalMemoryBytes: number | null;
  gpuNames: string[];
  volumeTotalBytes: number[];
}

/**
 * Deterministic canonical payload. Key order is fixed and list values are
 * sorted, so the same hardware always yields the same string regardless of the
 * order probes reported the GPU/volume lists.
 */
export function canonicalFingerprintJson(input: FingerprintInput): string {
  const payload = {
    os: input.os,
    arch: input.arch,
    cpuModel: input.cpuModel,
    cores: input.cores,
    threads: input.threads,
    totalMemoryBytes: input.totalMemoryBytes,
    gpuNames: [...input.gpuNames].sort(compareNames),
    volumeTotalBytes: [...input.volumeTotalBytes].sort((a, b) => a - b),
  };
  return JSON.stringify(payload);
}

export function computeHardwareFingerprint(input: FingerprintInput, digest: (data: string) => string): string {
  return digest(canonicalFingerprintJson(input));
}

/** Case-insensitive, deterministic (no locale/ICU dependence) name sort. */
function compareNames(a: string, b: string): number {
  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();
  if (lowerA !== lowerB) return lowerA < lowerB ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}