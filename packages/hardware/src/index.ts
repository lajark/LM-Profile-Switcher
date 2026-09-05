/**
 * Public entry point: real platform wiring via `createDefaultProbeEnv()` plus
 * re-exports of every pure probe/redact/fingerprint/error function. Consumers
 * should call `probeHardware(createDefaultProbeEnv())`; tests inject their own
 * `ProbeEnv` with synthetic fixtures.
 */
import { createHash } from 'node:crypto';
import { statfsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createExecFileRunner } from './exec.js';
import type { ProbeEnv, ProbeOs } from './probe.js';

export { HardwareError, HARDWARE_ERROR_CODES, isHardwareError } from './errors.js';
export {
  createExecFileRunner,
  encodeEncodedCommand,
  powerShellArgs,
} from './exec.js';
export type { ExecFileDefaults } from './exec.js';
export {
  computeHardwareFingerprint,
  canonicalFingerprintJson,
} from './fingerprint.js';
export type { FingerprintInput } from './fingerprint.js';
export { probeGpus } from './gpu.js';
export type { GpuProbeResult } from './gpu.js';
export { probeOsInfo, probePhysicalCores } from './os-info.js';
export type { OsSection } from './os-info.js';
export {
  describeOs,
  joinVolumeDetails,
  parseBatteryStatus,
  parseCimJson,
  parseNvidiaSmiCsv,
  parseRegistryNames,
  parseStatfs,
  parseWmiRef,
  toDiskDriveFromCim,
  toVolumeFromCim,
  toWmiRefPair,
} from './parse.js';
export type {
  DiskDriveRecord,
  VolumeEnrichmentSource,
  VolumeRecord,
  WmiRefPair,
  WmiRefTarget,
} from './parse.js';
export { probePower } from './power.js';
export { probeVolumes } from './volumes.js';
export { probeHardware } from './probe.js';
export type { ProbeEnv, ProbeOs, RunOptions, RunResult } from './probe.js';
export { hasRedactionPlaceholders, redactDiagnostics } from './redact.js';
export type { RedactContext } from './redact.js';

const WINDOWS_HOME_ROOT_FALLBACK = 'C:\\';

/** Real platform seam built on node:os/node:fs/node:crypto and execFile. */
export function createDefaultProbeEnv(): ProbeEnv {
  const probeOs = buildProbeOs();
  return {
    os: probeOs,
    run: createExecFileRunner(),
    statfs: (root) => {
      try {
        const s = statfsSync(root);
        return { blocks: s.blocks, bavail: s.bavail, bsize: s.bsize };
      } catch {
        return null;
      }
    },
    digest: (data) => createHash('sha256').update(data).digest('hex'),
    now: () => new Date().toISOString(),
  };
}

function buildProbeOs(): ProbeOs {
  return {
    platform: () => os.platform(),
    release: () => os.release(),
    arch: () => os.arch(),
    version: () => os.version(),
    cpus: () => os.cpus(),
    totalmem: () => os.totalmem(),
    freemem: () => os.freemem(),
    homeRoot: () => {
      const home = os.homedir();
      if (!home) return null;
      return path.parse(home).root || WINDOWS_HOME_ROOT_FALLBACK;
    },
  };
}