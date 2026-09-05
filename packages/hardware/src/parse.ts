/**
 * Pure parsers and normalizers: raw probe text → structured values.
 *
 * These functions are platform-independent (no Node imports) and deterministic,
 * so the whole probe pipeline can be fixture-tested with synthetic inputs.
 * Convention throughout: a parseable-but-empty result is `[]`/appropriate value,
 * while unparseable garbage is `null` so callers can fall back to Unknown.
 */
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

/** Maps a Win32_LogicalDisk row to the VolumeInfo shape. */
export function toVolumeFromCim(
  raw: unknown,
): { mount: string; totalBytes: number; availableBytes: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const deviceId = record.DeviceID;
  const size = record.Size;
  const free = record.FreeSpace;
  if (typeof deviceId !== 'string' || deviceId.length === 0) return null;
  if (typeof size !== 'number' || typeof free !== 'number') return null;
  if (!Number.isFinite(size) || !Number.isFinite(free) || size < 0 || free < 0) return null;
  const mount = deviceId.replace(/[\\/]+$/, '') + '\\';
  return { mount, totalBytes: size, availableBytes: free };
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