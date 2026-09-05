/**
 * Pure parsers and normalizers: raw probe text → structured values.
 *
 * These functions are platform-independent (no Node imports) and deterministic,
 * so the whole probe pipeline can be fixture-tested with synthetic inputs.
 * Convention throughout: a parseable-but-empty result is `[]`/appropriate value,
 * while unparseable garbage is `null` so callers can fall back to Unknown.
 */
import type { VolumeInfo } from '@lmps/domain';

export interface NvidiaGpuRow {
  name: string | null;
  driverVersion: string | null;
  vramTotalBytes: number | null;
  vramAvailableBytes: number | null;
}

const MIB = 1048576;
const NA_TOKEN = '[N/A]';

function normPart(part: string | undefined): string | null {
  const value = part?.trim();
  if (value === undefined || value === '' || value === NA_TOKEN) return null;
  return value;
}

function parseMiB(part: string | undefined): number | null {
  const value = normPart(part);
  if (value === null) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.floor(num * MIB);
}

/** Parses `nvidia-smi --format=csv,noheader,nounits` output. */
export function parseNvidiaSmiCsv(text: string): NvidiaGpuRow[] {
  const rows: NvidiaGpuRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const parts = line.split(',');
    rows.push({
      name: normPart(parts[0]),
      driverVersion: normPart(parts[1]),
      vramTotalBytes: parseMiB(parts[2]),
      vramAvailableBytes: parseMiB(parts[3]),
    });
  }
  return rows;
}

/**
 * Parses a ConvertTo-Json blob (a single object or an array) and maps each row
 * with `pick`. Blank output → `[]`; malformed JSON → `null`.
 */
export function parseCimJson<T>(text: string, pick: (raw: unknown) => T | null): T[] | null {
  const trimmed = text.trim();
  if (trimmed === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (parsed === null) return [];
  const list = Array.isArray(parsed) ? parsed : [parsed];
  const out: T[] = [];
  for (const item of list) {
    const picked = pick(item);
    if (picked !== null) out.push(picked);
  }
  return out;
}

/**
 * Win32_Battery BatteryStatus: 1 = discharging, anything else present = on AC.
 * Blank output (no battery) → false; unusable shape → null (Unknown).
 */
export function parseBatteryStatus(text: string): boolean | null {
  const trimmed = text.trim();
  if (trimmed === '') return false;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  let value = parsed;
  if (Array.isArray(value)) {
    if (value.length === 0) return false;
    value = value[0];
  }
  if (value === null || value === undefined) return null;

  if (typeof value === 'number') return value === 1;
  if (typeof value === 'object') {
    const status = (value as Record<string, unknown>).BatteryStatus;
    if (typeof status === 'number') return status === 1;
  }
  return null;
}

/** Converts a `fs.statfsSync` snapshot into byte counts. */
export function parseStatfs(
  stat: { blocks: number; bavail: number; bsize: number } | null,
): { totalBytes: number; availableBytes: number } | null {
  if (!stat) return null;
  const { blocks, bavail, bsize } = stat;
  if (
    !Number.isFinite(blocks) ||
    !Number.isFinite(bavail) ||
    !Number.isFinite(bsize) ||
    blocks < 0 ||
    bavail < 0 ||
    bsize <= 0
  ) {
    return null;
  }
  return { totalBytes: blocks * bsize, availableBytes: bavail * bsize };
}

/** Base volume identity + the Win32_LogicalDisk DriveType (2 = removable, 3 = fixed). */
export interface VolumeRecord {
  mount: string;
  totalBytes: number;
  availableBytes: number;
  driveType: number | null;
}

/** Maps a Win32_LogicalDisk row to the base VolumeInfo shape + its DriveType. */
export function toVolumeFromCim(
  raw: unknown,
): VolumeRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const deviceId = record.DeviceID;
  const size = record.Size;
  const free = record.FreeSpace;
  if (typeof deviceId !== 'string' || deviceId.length === 0) return null;
  if (typeof size !== 'number' || typeof free !== 'number') return null;
  if (!Number.isFinite(size) || !Number.isFinite(free) || size < 0 || free < 0) return null;
  const mount = deviceId.replace(/[\\/]+$/, '') + '\\';
  const driveType = record.DriveType;
  const driveTypeUsable =
    typeof driveType === 'number' && Number.isInteger(driveType) && (driveType === 2 || driveType === 3);
  return { mount, totalBytes: size, availableBytes: free, driveType: driveTypeUsable ? driveType : null };
}

/** Physical-disk identity from `Win32_DiskDrive`, keyed by DeviceID. */
export interface DiskDriveRecord {
  deviceId: string;
  model: string | null;
  interfaceType: string | null;
  pnpDeviceId: string | null;
  /** Win32_DiskDrive.MediaType (`Fixed hard disk media` / `External hard disk media`). */
  mediaType: string | null;
}

/** Maps a Win32_DiskDrive row to the physical-disk identity used by the join. */
export function toDiskDriveFromCim(raw: unknown): DiskDriveRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const deviceId = record.DeviceID;
  if (typeof deviceId !== 'string' || deviceId.length === 0) return null;
  const text = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  return {
    deviceId,
    model: text(record.Model),
    interfaceType: text(record.InterfaceType),
    pnpDeviceId: text(record.PNPDeviceID),
    mediaType: text(record.MediaType),
  };
}

/** A parsed `ClassName.Key="value"` WMI reference (dotted or parenthesized form). */
export interface WmiRefTarget {
  className: string;
  deviceId: string;
}

/**
 * Accepts both documented WMI reference forms: `Win32_DiskDrive.DeviceID="…"`
 * and the `ToString()` form PowerShell emits for CIM references,
 * `Win32_DiskDrive (DeviceID = "…")`. The class name is kept so the join can
 * orient rows without assuming which endpoint is listed first.
 */
const WMI_REF_RE = /^\s*([A-Za-z0-9_]+)\s*[.(]\s*[A-Za-z0-9_]+\s*=\s*"([^"]*)"\s*\)?\s*$/;

export function parseWmiRef(ref: unknown): WmiRefTarget | null {
  if (typeof ref !== 'string') return null;
  const match = ref.match(WMI_REF_RE);
  if (match === null) return null;
  return { className: match[1] ?? '', deviceId: match[2] ?? '' };
}

/** One WMI association row: the Antecedent and Dependent reference strings. */
export interface WmiRefPair {
  antecedent: WmiRefTarget | null;
  dependent: WmiRefTarget | null;
}

/** Maps an association row to its two endpoint refs, degrading to null on malformed rows. */
export function toWmiRefPair(raw: unknown): WmiRefPair | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  return { antecedent: parseWmiRef(record.Antecedent), dependent: parseWmiRef(record.Dependent) };
}

/** Joined tables for {@link joinVolumeDetails}; tables may be absent entirely. */
export interface VolumeEnrichmentSource {
  logicalDisks: VolumeRecord[];
  diskDrives: DiskDriveRecord[] | null;
  /** Win32_DiskDriveToDiskPartition rows. */
  diskToPartition: WmiRefPair[] | null;
  /** Win32_LogicalDiskToLogicalPartition rows. */
  logicalToPartition: WmiRefPair[] | null;
}

/** Reads the target of one endpoint in an association row, by endpoint class. */
function endpoint(
  pair: WmiRefPair,
  side: 'antecedent' | 'dependent',
  className: string,
): string | null {
  const target = pair[side];
  return target !== null && target.className === className ? target.deviceId : null;
}

/**
 * Joins the four probe tables into fully annotated VolumeInfo rows: a logical
 * disk is routed to its partition through `Win32_LogicalDiskToPartition` and to
 * the physical drive through `Win32_DiskDriveToDiskPartition`. Association
 * rows are read class-first, so either side may carry the error-prone endpoint
 * orientation a real CIM query returns. The disk/association tables are
 * optional: when none is available the volumes still enumerate and the
 * enrichment columns degrade to `null` — enrichment never drops a volume the
 * logical-disk query could already report.
 */
export function joinVolumeDetails(source: VolumeEnrichmentSource): VolumeInfo[] {
  const drivesByDeviceId = new Map<string, DiskDriveRecord>();
  for (const drive of source.diskDrives ?? []) drivesByDeviceId.set(drive.deviceId, drive);

  const partitionToDisk = new Map<string, string>();
  for (const pair of source.diskToPartition ?? []) {
    const disk =
      endpoint(pair, 'antecedent', 'Win32_DiskDrive') ?? endpoint(pair, 'dependent', 'Win32_DiskDrive');
    const partition =
      endpoint(pair, 'dependent', 'Win32_DiskPartition') ?? endpoint(pair, 'antecedent', 'Win32_DiskPartition');
    if (disk !== null && partition !== null) partitionToDisk.set(partition, disk);
  }
  const logicalToPartition = new Map<string, string>();
  for (const pair of source.logicalToPartition ?? []) {
    const logical =
      endpoint(pair, 'dependent', 'Win32_LogicalDisk') ?? endpoint(pair, 'antecedent', 'Win32_LogicalDisk');
    const partition =
      endpoint(pair, 'antecedent', 'Win32_DiskPartition') ?? endpoint(pair, 'dependent', 'Win32_DiskPartition');
    if (logical !== null && partition !== null) logicalToPartition.set(logical, partition);
  }

  return source.logicalDisks.map((volume) => {
    const partitionId = logicalToPartition.get(volume.mount.slice(0, -1));
    const diskId = partitionId === undefined ? undefined : partitionToDisk.get(partitionId);
    const drive = diskId === undefined ? undefined : drivesByDeviceId.get(diskId);
    return {
      mount: volume.mount,
      totalBytes: volume.totalBytes,
      availableBytes: volume.availableBytes,
      driveType: volume.driveType,
      bus: drive?.interfaceType ?? null,
      external: classifyExternal(volume.driveType, drive),
      model: drive?.model ?? null,
    };
  });
}

/**
 * External-volume classification: DriveType=2 (removable) is always external;
 * DriveType=3 (fixed) is external when the physical disk is USB-attached —
 * evidenced by the interface (`USB`), the PNP id (`USBSTOR\…`) or the disk
 * media label (`External hard disk media`, the label Windows gives to
 * USB-bridge enclosures that expose the disk as SCSI). A non-USB
 * interface/pnp/media label marks a built-in disk; missing evidence stays
 * `null` (unknown) rather than guessing.
 */
function classifyExternal(driveType: number | null, drive: DiskDriveRecord | undefined): boolean | null {
  if (driveType === 2) return true;
  if (driveType !== 3) return null;
  if (drive === undefined) return null;
  const interfaceType = drive.interfaceType?.trim().toUpperCase();
  const pnpDeviceId = drive.pnpDeviceId?.trim().toUpperCase();
  const mediaType = drive.mediaType?.trim().toUpperCase();
  if (interfaceType === 'USB' || pnpDeviceId?.startsWith('USBSTOR') === true) return true;
  if (mediaType !== null && mediaType !== undefined) {
    if (mediaType.includes('EXTERNAL') || mediaType.includes('REMOVABLE')) return true;
    if (mediaType !== 'UNKNOWN') return false;
  }
  if ((interfaceType ?? '') !== '' && interfaceType !== 'UNKNOWN') return false;
  if ((pnpDeviceId ?? '') !== '') return false;
  return null;
}

/** Extracts display-adapter names from the registry-snapshot JSON blob. */
export function parseRegistryNames(text: string): string[] {
  return (
    parseCimJson(text, (raw) => (typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null)) ?? []
  );
}

/**
 * Stable, human-meaningful OS label. Prefers the Windows edition reported by
 * `os.version()`; falls back to `platform + release` for generic labels.
 */
export function describeOs(
  versionLabel: string,
  platform: string,
  release: string,
  arch: string,
): string {
  const label = versionLabel.trim();
  // `Windows_NT` is the generic `os.version()` label — not a real edition, so
  // it joins the `platform release (arch)` fallback like an empty label does.
  if (label !== '' && label !== 'Windows_NT') return `${label} (${arch})`;
  const base = label === '' ? platform : label;
  return `${base} ${release} (${arch})`;
}