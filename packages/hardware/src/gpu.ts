/**
 * GPU section: NVIDIA-specialized path (`nvidia-smi`, reliable VRAM/driver)
 * with a generic fallback that enumerates every display adapter by name.
 *
 * VRAM policy (user-confirmed 2026-08-22): `gpus` entries are emitted only
 * when both VRAM totals are reliable (the nvidia-smi path). On the generic
 * fallback the GPU names still flow into the hardware fingerprint, because
 * WMI `AdapterRAM` is a uint32-clamped value and would misreport VRAM.
 */
import type { GpuInfo } from '@lmps/domain';

import { powerShellArgs } from './exec.js';
import { parseCimJson, parseNvidiaSmiCsv, parseRegistryNames } from './parse.js';
import type { ProbeEnv, RunOptions } from './probe.js';

const SMI_ARGS = [
  '--query-gpu=name,driver_version,memory.total,memory.free',
  '--format=csv,noheader,nounits',
];

const VIDEO_CONTROLLER_SCRIPT =
  'Get-CimInstance Win32_VideoController | Select-Object -Property Name | ConvertTo-Json -Compress';

const REGISTRY_VIDEO_SCRIPT = [
  "Get-ChildItem 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}'",
  "-ErrorAction SilentlyContinue | ForEach-Object { $d = $_.GetValue('DriverDesc'); if ($d) { $d } }",
  '| Sort-Object -Unique | ConvertTo-Json -Compress',
].join(' ');

const PROBE_OPTS: RunOptions = { timeoutMs: 5000, maxBuffer: 1024 * 1024 };

export interface GpuProbeResult {
  /** Reliable GPU entries (only the nvidia-smi path today). */
  gpus: GpuInfo[] | null;
  /** Every adapter name observed, used for the fingerprint. */
  gpuNames: string[];
}

export async function probeGpus(env: ProbeEnv): Promise<GpuProbeResult> {
  const smi = await env.run('nvidia-smi', SMI_ARGS, PROBE_OPTS);
  if (smi?.ok) {
    const rows = parseNvidiaSmiCsv(smi.stdout);
    const gpus = rows
      .filter(
        (row) => row.name !== null && row.vramTotalBytes !== null && row.vramAvailableBytes !== null,
      )
      .map((row) => ({
        name: row.name as string,
        driverVersion: row.driverVersion,
        vramTotalBytes: row.vramTotalBytes as number,
        vramAvailableBytes: row.vramAvailableBytes as number,
      }));
    if (gpus.length > 0) {
      return { gpus, gpuNames: gpus.map((gpu) => gpu.name).sort() };
    }
    // nvidia-smi ran but VRAM was not reliable → keep the NVIDIA names for the
    // fingerprint and complement with the generic enumeration.
    const smiNames = rows.filter((row) => row.name !== null).map((row) => row.name as string);
    return { gpus: null, gpuNames: mergeNames(smiNames, await genericGpuNames(env)) };
  }

  const genericNames = await genericGpuNames(env);
  return { gpus: null, gpuNames: genericNames };
}

/** CIM listing (active adapters) plus registry class-key listing (all adapters). */
async function genericGpuNames(env: ProbeEnv): Promise<string[]> {
  const names = new Set<string>();

  const cim = await env.run('powershell.exe', powerShellArgs(VIDEO_CONTROLLER_SCRIPT), PROBE_OPTS);
  const cimRows =
    parseCimJson(cim?.stdout ?? '', (raw) => {
      if (!raw || typeof raw !== 'object') return null;
      const name = (raw as Record<string, unknown>).Name;
      return typeof name === 'string' && name !== '' ? name : null;
    }) ?? [];
  for (const name of cimRows) names.add(name);

  const reg = await env.run('powershell.exe', powerShellArgs(REGISTRY_VIDEO_SCRIPT), PROBE_OPTS);
  for (const name of parseRegistryNames(reg?.stdout ?? '')) names.add(name);

  return [...names].sort();
}

function mergeNames(primary: string[], secondary: string[]): string[] {
  return [...new Set([...primary, ...secondary])].sort();
}