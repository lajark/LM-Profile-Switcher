// M0-006 spike: build the Node Single Executable Application and postject it
// into a Tauri sidecar binary named <cmd>-<target-triple>.exe under
// apps/desktop/src-tauri/binaries/ (the bundle.externalBin convention).
//
// Usage: node scripts/build-sea.mjs [x86_64-pc-windows-msvc]
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, renameSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const postjectCli = require.resolve('postject/dist/cli.js');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const seaDir = resolve(root, 'sea');
const target = process.argv[2] ?? 'x86_64-pc-windows-msvc';

mkdirSync(seaDir, { recursive: true });

const blob = resolve(seaDir, 'blob.blob');
execFileSync(process.execPath, ['--experimental-sea-config', resolve(root, 'sea-config.json')], {
  stdio: 'inherit',
  cwd: root,
});

const nodePath = process.execPath;
const tmpExe = resolve(seaDir, 'lmps-sidecar-tmp.exe');
copyFileSync(nodePath, tmpExe);

execFileSync(process.execPath, [postjectCli, tmpExe, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'], {
  stdio: 'inherit',
  cwd: root,
});

const binariesDir = resolve(root, '..', 'desktop', 'src-tauri', 'binaries');
mkdirSync(binariesDir, { recursive: true });
const title = `lmps-sidecar-${target}.exe`;
const outExe = resolve(binariesDir, title);
renameSync(tmpExe, outExe);

console.log(`SEA sidecar ok: ${outExe}`);