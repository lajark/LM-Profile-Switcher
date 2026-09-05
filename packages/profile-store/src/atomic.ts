/**
 * Durable single-file write (PRD FR-05): temp sibling + fsync + atomic rename.
 *
 * The temp file lives in the same directory as the target so `rename` is
 * atomic on the volume. Ordering matters:
 *   1. write the data to `<target>.tmp-<seq>`,
 *   2. fsync the temp file,
 *   3. directory fsync (best-effort — flaky on Windows, never fatal),
 *   4. rename over the target (atomic; a failure leaves the original intact).
 *
 * Any failure before the rename keeps the previous target byte-for-byte and
 * surfaces as `STORE_IO_FAILED` (stable machine code); the original OS error is
 * preserved as `cause` for diagnostics.
 */
import { ProfileStoreError } from './errors.js';
import type { Fsys } from './fsys.js';

/** Same-directory temp path for `seq`-th write attempt against `targetPath`. */
export function tempPathFor(targetPath: string, seq: number): string {
  return `${targetPath}.tmp-${seq}`;
}

function parentDir(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return index <= 0 ? '.' : path.slice(0, index);
}

export function writeFileAtomic(fsys: Fsys, targetPath: string, data: string, seq = 1): void {
  const tempPath = tempPathFor(targetPath, seq);
  try {
    fsys.writeFileUtf8(tempPath, data);
    fsys.fsyncFile(tempPath);
  } catch (error) {
    try {
      fsys.unlink(tempPath);
    } catch {
      // best-effort: a leftover temp is harmless and cleaned on recovery
    }
    throw new ProfileStoreError('STORE_IO_FAILED', 'durably writing the temp file failed', {
      detail: 'temp write or fsync failed before the atomic rename; the target is unchanged',
      cause: error,
    });
  }
  try {
    // Directory fsync is best-effort: it is unsupported or flaky on some
    // platforms/volumes, but a rename already gives us atomicity for reads.
    fsys.fsyncFile(parentDir(targetPath));
  } catch {
    // best-effort
  }
  try {
    fsys.rename(tempPath, targetPath);
  } catch (error) {
    try {
      fsys.unlink(tempPath);
    } catch {
      // best-effort
    }
    throw new ProfileStoreError('STORE_IO_FAILED', 'atomically replacing the target failed', {
      detail: 'final rename was rejected; the previous file and its backup are intact',
      cause: error,
    });
  }
}