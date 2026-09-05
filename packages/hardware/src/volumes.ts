/**
 * Volume section: volume enumeration with external-disk classification.
 *
 * Four parallel WMI queries are joined together (see `parse.ts`): fixed and
 * removable `Win32_LogicalDisk` rows (DriveType 2/3) are enriched with the
 * physical-disk table (`Win32_DiskDrive`) via the two partition associations,
 * so each volume learns its `driveType`/`bus`/`external`/`model`. Enrichment
 * is best effort — volumes survive even when the disk tables are missing. When
 * even the logical-disk query fails or reports nothing, a single root volume
 * from `statfs` keeps the section from being empty. Drive letters are
 * normalized to a trailing backslash (`C:\`), matching the domain
 * `VolumeInfo.mount` contract.
 */
import type { VolumeInfo } from '@lmps/domain';

import { powerShellArgs } from './exec.js';
import {
  joinVolumeDetails,
  parseCimJson,
  toDiskDriveFromCim,
  toVolumeFromCim,
  toWmiRefPair,
} from './parse.js';
import type { ProbeEnv, RunOptions } from './probe.js';

const LOGICAL_DISK_SCRIPT = [
  'Get-CimInstance Win32_LogicalDisk -Filter "DriveType=2 or DriveType=3"',
  '| Select-Object DeviceID, DriveType, Size, FreeSpace',
  '| ConvertTo-Json -Compress',
].join(' ');

const DISK_DRIVE_SCRIPT = [
  'Get-CimInstance Win32_DiskDrive',
  '| Select-Object DeviceID, Model, InterfaceType, PNPDeviceID, MediaType',
  '| ConvertTo-Json -Compress',
].join(' ');

/**
 * Association rows serialize their CIM references as plain strings via
 * `.ToString()` (raw Antecedent/Dependent would serialize as nested objects and
 * defeat JSON parsing). The resulting `ClassName (DeviceID = "…")` form is what
 * `parseWmiRef` accepts.
 */
const toRefSelect = (prop: string): string => `@{N='${prop}';E={$_.${prop}.ToString()}}`;
const ASSOCIATION_SELECT = `| Select-Object ${toRefSelect('Antecedent')}, ${toRefSelect('Dependent')}`;

const DISK_DRIVE_TO_PARTITION_SCRIPT = [
  'Get-CimInstance Win32_DiskDriveToDiskPartition',
  ASSOCIATION_SELECT,
  '| ConvertTo-Json -Compress',
].join(' ');

// Win32_LogicalDiskToLogicalPartition does not exist on every Windows 11 build;
// Win32_LogicalDiskToPartition is the association class that does.
const LOGICAL_DISK_TO_PARTITION_SCRIPT = [
  'Get-CimInstance Win32_LogicalDiskToPartition',
  ASSOCIATION_SELECT,
  '| ConvertTo-Json -Compress',
].join(' ');

const PROBE_OPTS: RunOptions = { timeoutMs: 5000, maxBuffer: 1024 * 1024 };

type RunOutcome = { ok: boolean; stdout: string; stderr: string };

async function runProbe(env: ProbeEnv, script: string): Promise<RunOutcome> {
  const result = await env.run('powershell.exe', powerShellArgs(script), PROBE_OPTS);
  return result ?? { ok: false, stdout: '', stderr: '' };
}

/** Volumes with best-effort disk attribution, or null on total CIM+statfs failure. */
export async function probeVolumes(env: ProbeEnv): Promise<VolumeInfo[] | null> {
  const [logical, diskDrives, diskToPartition, logicalToPartition] = await Promise.all([
    runProbe(env, LOGICAL_DISK_SCRIPT),
    runProbe(env, DISK_DRIVE_SCRIPT),
    runProbe(env, DISK_DRIVE_TO_PARTITION_SCRIPT),
    runProbe(env, LOGICAL_DISK_TO_PARTITION_SCRIPT),
  ]);

  const rows = logical.ok ? parseCimJson(logical.stdout, toVolumeFromCim) : null;
  if (rows && rows.length > 0) {
    const drivesList = diskDrives.ok ? parseCimJson(diskDrives.stdout, toDiskDriveFromCim) : null;
    const diskAssoc = diskToPartition.ok ? parseCimJson(diskToPartition.stdout, toWmiRefPair) : null;
    const logicalAssoc = logicalToPartition.ok ? parseCimJson(logicalToPartition.stdout, toWmiRefPair) : null;
    return joinVolumeDetails({
      logicalDisks: rows,
      diskDrives: drivesList,
      diskToPartition: diskAssoc,
      logicalToPartition: logicalAssoc,
    });
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