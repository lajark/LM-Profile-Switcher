/**
 * Volume section: fixed-drive enumeration via WMI `Win32_LogicalDisk`
 * (DriveType=3), falling back to a single root volume from `statfs` when the
 * probe fails or reports nothing. Drive letters are normalized to a trailing
 * backslash (`C:\`), matching the domain `VolumeInfo.mount` contract.
 */
import type { VolumeInfo } from '@lmps/domain';

import { powerShellArgs } from './exec.js';
import { parseCimJson, toVolumeFromCim } from './parse.js';
import type { ProbeEnv, RunOptions } from './probe.js';

const LOGICAL_DISK_SCRIPT = [
  'Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3"',
  '| Select-Object DeviceID, Size, FreeSpace',
  '| ConvertTo-Json -Compress',
].join(' ');

const PROBE_OPTS: RunOptions = { timeoutMs: 5000, maxBuffer: 1024 * 1024 };

/** Fixed volumes, or null when neither CIM nor the statfs fallback yields data. */
export async function probeVolumes(env: ProbeEnv): Promise<VolumeInfo[] | null> {
  const result = await env.run('powershell.exe', powerShellArgs(LOGICAL_DISK_SCRIPT), PROBE_OPTS);
  if (result?.ok) {
    const rows = parseCimJson(result.stdout, toVolumeFromCim);
    if (rows && rows.length > 0) return rows;
  }

  const root = env.os.homeRoot();
  if (root === null) return null;
  const statfs = env.statfs(root);
  if (statfs === null) return null;
  return [
    {
      mount: root.endsWith('/') || root.endsWith('\\') ? root : `${root}\\`,
      totalBytes: statfs.blocks * statfs.bsize,
      availableBytes: statfs.bavail * statfs.bsize,
    },
  ];
}