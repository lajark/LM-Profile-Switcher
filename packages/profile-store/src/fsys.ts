/**
 * File-system seam for the profile store (M1-002).
 *
 * Pure modules (that is, everything except `index.ts`) never import Node
 * built-ins: every I/O capability the store needs flows in through this
 * interface, so tests can run against an in-memory implementation with
 * per-operation fault injection. `index.ts` provides the Node-backed
 * implementation (`createDefaultFsys`).
 */
export interface Fsys {
  exists(path: string): boolean;
  /** Reads a UTF-8 file; throws when missing or not UTF-8. */
  readFileUtf8(path: string): string;
  writeFileUtf8(path: string, data: string): void;
  mkdirRecursive(path: string): void;
  /** Entry names one level deep; missing directory → []. */
  readdirNames(path: string): string[];
  /** Atomic replace of the target when both paths are on one volume. */
  rename(from: string, to: string): void;
  unlink(path: string): void;
  /** open + fsync + close; throws when the file does not exist. */
  fsyncFile(path: string): void;
}