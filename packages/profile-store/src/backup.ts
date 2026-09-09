/**
 * Write-ahead backups (PRD FR-05): every update is captured under
 * `backupDir/<id>/` before the atomic replace, and history is rotated down to
 * the newest `backupCount` entries. Restore scans newest → oldest and returns
 * the first document the caller-provided parser accepts, so one corrupted
 * backup never blocks recovery (M1-004 will expose list/restore to the CLI).
 */
import { stringifyJsonDocument, type CompositeProfile } from '@lmps/domain';

import type { Fsys } from './fsys.js';

export const DEFAULT_BACKUP_COUNT = 20;
export const BACKUP_COUNT_MIN = 1;
export const BACKUP_COUNT_MAX = 200;

type BackupParser = (text: string) => CompositeProfile;

/** Deterministic, sortable backup file name (timestamp, then optional suffix). */
export function backupFileNameFor(now: string): string {
  // Strip timezone designators (the 'Z' in ISO) so names are pure digits and
  // sort chronologically; lexicographic order stays equal to time order.
  const stem = now.replace(/[^0-9A-Za-z]/g, '').replace(/Z$/, '');
  return `${stem}.json`;
}

function backupDirFor(backupDir: string, id: string): string {
  return `${backupDir}/${id}`;
}

/** Sorted (oldest → newest) backup file names for `id`. */
export function readBackupNames(fsys: Fsys, backupDir: string, id: string): string[] {
  return fsys.readdirNames(backupDirFor(backupDir, id)).filter((name) => name.endsWith('.json')).sort();
}

/**
 * Captures `profile` as a backup. Same-timestamp collisions get a `-<n>`
 * suffix so simultaneous writes never clobber each other. `backupCount` is a
 * rotation cap (keeps the newest N); pruning failures are best-effort.
 */
export function writeBackup(
  fsys: Fsys,
  backupDir: string,
  id: string,
  now: string,
  profile: CompositeProfile,
  backupCount = DEFAULT_BACKUP_COUNT,
): string {
  const dir = backupDirFor(backupDir, id);
  // First write for a profile creates `backups/<id>/` on the real fs (the
  // documented readdirNames contract already tolerates a missing dir, and the
  // atomic write below can't create its own parent).
  fsys.mkdirRecursive(dir);
  const existing = new Set(readBackupNames(fsys, backupDir, id));
  let file = backupFileNameFor(now);
  for (let suffix = 1; existing.has(file); suffix += 1) {
    // '_' sorts after '.', so suffixed names stay newer than the base file.
    const stem = file.slice(0, file.length - '.json'.length).replace(/_\d+$/, '');
    file = `${stem}_${suffix}.json`;
  }
  fsys.writeFileUtf8(`${dir}/${file}`, stringifyJsonDocument(profile));

  const names = readBackupNames(fsys, backupDir, id);
  const excess = names.length - backupCount;
  for (let i = 0; i < excess; i += 1) {
    try {
      fsys.unlink(`${dir}/${names[i]}`);
    } catch {
      // best-effort: leaving one extra backup is safer than failing the update
    }
  }
  return file;
}

/**
 * Returns the first backup (newest first) that `parse` accepts, or null when
 * none parses successfully.
 */
export function restoreNewestValidBackup(
  fsys: Fsys,
  backupDir: string,
  id: string,
  parse: BackupParser,
): CompositeProfile | null {
  for (const name of readBackupNames(fsys, backupDir, id).reverse()) {
    try {
      return parse(fsys.readFileUtf8(`${backupDirFor(backupDir, id)}/${name}`));
    } catch {
      // continue with the next older backup
    }
  }
  return null;
}