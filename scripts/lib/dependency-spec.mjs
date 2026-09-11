/**
 * Dependency-spec classification helpers (M5-004). Pure, offline, no I/O.
 * Distinguishes workspace links, exact-pinned registry versions and ranged
 * registry specs so the dependency audit can report version pinning without
 * parsing the lockfile.
 */

/** `workspace:*` or `workspace:^...` pnpm-style link markers. */
export function isWorkspaceSpec(spec) {
  return typeof spec === 'string' && spec.trim().startsWith('workspace:');
}

/** `link:`, `file:`, `portal:`, `catalog:` or a bare local path (never registry). */
export function isLocalSpec(spec) {
  if (typeof spec !== 'string') return true;
  const value = spec.trim().toLowerCase();
  return (
    value.startsWith('link:') ||
    value.startsWith('file:') ||
    value.startsWith('portal:') ||
    value.startsWith('catalog:') ||
    value.startsWith('/') ||
    value.startsWith('.')
  );
}

/**
 * True when a registry spec is pinned to an exact version (no `^`, `~`,
 * `>=`, `<=`, `>`, `<`, `*`, arithmetic, tags, or `:` URL schemes).
 * Handles pre-release/build metadata (e.g. `1.2.3-rc.1+build`).
 */
export function isPinnedSpec(spec) {
  if (typeof spec !== 'string') return false;
  const value = spec.trim();
  if (value.length === 0) return false;
  if (['*', 'latest', 'next'].includes(value)) return false;
  if (/[\s^~><|]/.test(value)) return false;
  return /^\d+(\.\d+){1,2}(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.test(value);
}

/** Registry-range specs that are not exact and not wildcard. */
export function isRangeSpec(spec) {
  if (typeof spec !== 'string') return false;
  return !isWorkspaceSpec(spec) && !isLocalSpec(spec) && !isPinnedSpec(spec) && !['*', 'latest', 'next'].includes(spec.trim());
}

/** Normalised one-word classification for a dependency version spec. */
export function classifyDependencySpec(spec) {
  if (isWorkspaceSpec(spec)) return 'workspace';
  if (isLocalSpec(spec)) return 'local';
  if (isPinnedSpec(spec)) return 'pinned-registry';
  if (['*', 'latest', 'next'].includes(String(spec).trim())) return 'wildcard-registry';
  return 'range-registry';
}