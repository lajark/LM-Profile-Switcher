/**
 * Deterministic presentational helpers. Values are never localized (units are
 * the same across locales); null-or-unknown rendering owns its own i18n keys.
 */
const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'] as const;

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text = value >= 100 ? String(Math.round(value)) : String(Math.round(value * 10) / 10);
  return `${text} ${BYTE_UNITS[unit]}`;
}

/** Joins non-empty presentational fragments; empty parts drop out cleanly. */
export function joinFragments(fragments: readonly (string | null | undefined)[]): string {
  return fragments.filter((fragment): fragment is string => Boolean(fragment)).join(' · ');
}