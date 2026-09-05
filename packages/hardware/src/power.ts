/**
 * Power section: battery state via WMI `Win32_Battery`. Only `BatteryStatus`
 * is selected — the default object carries the host's SystemName and must
 * never reach our output. A successful probe with no battery present reports
 * `onBattery: false`; a failed probe reports `power: null`.
 */
import { powerShellArgs } from './exec.js';
import { parseBatteryStatus } from './parse.js';
import type { ProbeEnv, RunOptions } from './probe.js';

const BATTERY_SCRIPT =
  'Get-CimInstance Win32_Battery | Select-Object -ExpandProperty BatteryStatus | ConvertTo-Json -Compress';

const PROBE_OPTS: RunOptions = { timeoutMs: 5000, maxBuffer: 1024 * 1024 };

/** PowerInfo contract shape (inline; domain defines it via schema, not a name). */
export interface PowerSection {
  onBattery: boolean;
}

export async function probePower(env: ProbeEnv): Promise<PowerSection | null> {
  const result = await env.run('powershell.exe', powerShellArgs(BATTERY_SCRIPT), PROBE_OPTS);
  if (!result?.ok) return null;
  const onBattery = parseBatteryStatus(result.stdout);
  if (onBattery === null) return null;
  return { onBattery };
}