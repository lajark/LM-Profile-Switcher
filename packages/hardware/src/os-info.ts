/**
 * OS / CPU / memory section: values from the injected os view plus a Windows
 * WMI physical-core probe. Everything reaches the host through the injected
 * ProbeEnv so collectors stay pure and fixture-testable.
 */
import { powerShellArgs } from './exec.js';
import { describeOs, parseCimJson } from './parse.js';
import type { ProbeEnv, RunOptions } from './probe.js';

const PROCESSOR_SCRIPT =
  '$sum = (Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfCores -Sum).Sum; ' +
  '[PSCustomObject]@{ NumberOfCores = $sum } | ConvertTo-Json -Compress';

const PROBE_OPTS: RunOptions = { timeoutMs: 5000, maxBuffer: 1024 * 1024 };

export interface OsSection {
  os: string;
  cpuModel: string | null;
  threads: number | null;
}

/** OS label, CPU model and thread count — all from the injected os view, never throwing probes. */
export function probeOsInfo(env: ProbeEnv): OsSection {
  const label = describeOs(env.os.version(), env.os.platform(), env.os.release(), env.os.arch());
  const cpus = env.os.cpus();
  return {
    os: label,
    cpuModel: cpus[0]?.model ?? null,
    threads: cpus.length > 0 ? cpus.length : null,
  };
}

/**
 * Physical core count via Win32_Processor. Returns null when the probe fails
 * rather than disguising logical threads as physical cores.
 */
export async function probePhysicalCores(env: ProbeEnv): Promise<number | null> {
  const result = await env.run('powershell.exe', powerShellArgs(PROCESSOR_SCRIPT), PROBE_OPTS);
  if (!result?.ok) return null;
  const rows = parseCimJson(result.stdout, (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const cores = (raw as Record<string, unknown>).NumberOfCores;
    return typeof cores === 'number' && Number.isInteger(cores) && cores > 0 ? cores : null;
  });
  return rows?.[0] ?? null;
}