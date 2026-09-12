/**
 * Windows-safe liveness probe for activation-lock lease owners (M6-003). The
 * owner label is a numeric pid; a still-valid lease whose owner is gone is
 * crash residue and is reclaimed on acquire instead of blocking a restart for
 * the rest of the lease window.
 *
 * Fail-closed by design: any UNKNOWN outcome is treated as "assume alive" so a
 * live peer's lease is never stolen. On Windows `process.kill(pid, 0)` would
 * terminate the target (signals are not supported), so liveness goes through
 * `tasklist` and only a positive row proves the process exists. On POSIX the
 * zero signal checks existence without delivering anything: ESRCH means no such
 * process (reclaimable), EPERM means the process exists (keep blocking).
 */
import { spawnSync } from 'node:child_process';

export function isOwnerAlive(ownerLabel: string): boolean {
  const pid = Number(ownerLabel);
  if (!Number.isInteger(pid) || pid <= 0) return true; // unknown owner → never steal
  try {
    if (process.platform === 'win32') {
      const probe = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], {
        encoding: 'utf8',
        windowsHide: true,
      });
      // Only a positive match proves liveness; a probe failure is treated as
      // "assume alive" so a live peer's lease is never stolen.
      if (probe.status !== 0) return true;
      return (probe.stdout ?? '').includes(String(pid));
    }
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // POSIX: ESRCH means no such process (crash residue → reclaimable); any
    // other error (e.g. EPERM for an existing process) keeps blocking.
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}
