/**
 * Probe orchestration. `probeHardware(env)` composes every collector behind the
 * injected `ProbeEnv`, so the module itself is platform-agnostic and fixture
 * testable. Each section is individually guarded: a failing or malformed probe
 * contributes `null` for that section and never aborts the overall probe.
 */
import { HardwareProfileSchema } from '@lmps/domain';
import type { HardwareProfile, VolumeInfo } from '@lmps/domain';

import { HardwareError } from './errors.js';
import { computeHardwareFingerprint } from './fingerprint.js';
import type { FingerprintInput } from './fingerprint.js';
import { probeGpus } from './gpu.js';
import { probeOsInfo, probePhysicalCores } from './os-info.js';
import { probePower } from './power.js';
import { probeVolumes } from './volumes.js';

/** Minimal view over the OS that collectors are allowed to use. */
export interface ProbeOs {
  platform(): string;
  release(): string;
  arch(): string;
  version(): string;
  cpus(): Array<{ model: string }>;
  totalmem(): number;
  freemem(): number;
  /** Root of the drive holding the home directory (e.g. `C:/`). */
  homeRoot(): string | null;
}

export interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

export interface RunOptions {
  timeoutMs?: number;
  maxBuffer?: number;
}

/** All platform capability enters collectors through this seam. */
export interface ProbeEnv {
  os: ProbeOs;
  run(cmd: string, args: readonly string[], opts?: RunOptions): Promise<RunResult | null>;
  statfs(root: string): { blocks: number; bavail: number; bsize: number } | null;
  digest(data: string): string;
  now(): string;
}

function catchNull<T>(promise: Promise<T | null>): Promise<T | null> {
  return promise.catch(() => null);
}

/**
 * Full hardware probe. Never throws for individual probe failures — the worst
 * case returns a profile carrying at least `schemaVersion` and `probedAt`.
 */
export async function probeHardware(env: ProbeEnv): Promise<HardwareProfile> {
  const [osInfo, cores, gpuResult, volumes, power] = await Promise.all([
    Promise.resolve(probeOsInfo(env)),
    catchNull(probePhysicalCores(env)),
    catchNull(probeGpus(env)),
    catchNull(probeVolumes(env)),
    catchNull(probePower(env)),
  ]);

  const totalMemoryBytes = env.os.totalmem();
  const profile: HardwareProfile = {
    schemaVersion: 1,
    os: osInfo.os,
    cpu: {
      model: osInfo.cpuModel,
      cores,
      threads: osInfo.threads,
    },
    memory:
      totalMemoryBytes > 0
        ? { totalBytes: totalMemoryBytes, availableBytes: env.os.freemem() }
        : null,
    gpus: gpuResult?.gpus ?? null,
    volumes,
    power,
    versions: {
      lmStudio: null,
      daemon: null,
      server: null,
      runtime: null,
      api: null,
    },
    hardwareFingerprint: buildFingerprint(
      env,
      osInfo.os,
      osInfo.cpuModel,
      cores,
      osInfo.threads,
      totalMemoryBytes,
      gpuResult?.gpuNames,
      volumes,
    ),
    probedAt: env.now(),
  };

  const parsed = HardwareProfileSchema.safeParse(profile);
  if (!parsed.success) {
    throw new HardwareError('HARDWARE_PROBE_FAILED', 'Probed profile failed schema validation', {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

function buildFingerprint(
  env: ProbeEnv,
  os: string,
  cpuModel: string | null,
  cores: number | null,
  threads: number | null,
  totalMemoryBytes: number,
  gpuNames: string[] | undefined,
  volumes: VolumeInfo[] | null,
): string | null {
  const input: FingerprintInput = {
    os,
    arch: env.os.arch(),
    cpuModel,
    cores,
    threads,
    totalMemoryBytes: totalMemoryBytes > 0 ? totalMemoryBytes : null,
    gpuNames: gpuNames ?? [],
    volumeTotalBytes: (volumes ?? []).map((v) => v.totalBytes),
  };
  return computeHardwareFingerprint(input, env.digest);
}