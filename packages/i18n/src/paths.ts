/** Node-only path helpers for locating workspace resources. Not used by the WebView runtime. */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Walks upward from this module's location until a `pnpm-workspace.yaml` is found.
 * Works identically from `src/` (tests, vitest) and `dist/` (built CLI/service).
 */
export function findWorkspaceRoot(): string {
  let directory = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(directory, 'pnpm-workspace.yaml'))) {
      return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      return directory;
    }
    directory = parent;
  }
}