import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const workspaceRoot = resolve(import.meta.dirname, '..');
mkdirSync(resolve(workspaceRoot, 'reports'), { recursive: true });

const commands = [
  ['scripts/check-provenance.mjs'],
  ['scripts/license-report.mjs', '--check', '--write'],
  ['scripts/sbom.mjs'],
  ['scripts/notices.mjs'],
];

for (const args of commands) {
  const result = spawnSync(process.execPath, args, {
    cwd: workspaceRoot,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
