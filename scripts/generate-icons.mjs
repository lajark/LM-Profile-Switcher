// Uses the existing pinned Tauri CLI; no downloaded renderer or runtime dependency.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const icons = join(root, 'apps/desktop/src-tauri/icons');
const sizes = [16, 20, 24, 32, 48, 64, 128, 256];
const check = process.argv.includes('--check');
if (process.argv.slice(2).some((arg) => arg !== '--check')) {
  throw new Error('Usage: node scripts/generate-icons.mjs [--check]');
}
const tempRoot = join(root, '.workspace/tmp/icon-family');
mkdirSync(tempRoot, { recursive: true });
const temp = mkdtempSync(join(tempRoot, 'render-'));
const source = readFileSync(join(icons, 'icon.svg'), 'utf8');
const cli = join(root, 'apps/desktop/node_modules/@tauri-apps/cli/tauri.js');
const generated = new Map();

for (const [variant, ink] of [['app', null], ['mono-dark', '#171A21'], ['mono-light', '#F3F5F8']]) {
  // Change presentation only. Both monochrome variants retain the same cutouts.
  const svg = ink
    ? source.replaceAll('#B5BFCC', ink).replaceAll('#315EFB', ink)
      .replace(/\s*<use[^>]+data-role="accent-arrow"\s*\/>/, '')
    : source;
  const input = join(temp, variant + '.svg');
  const output = join(temp, variant);
  writeFileSync(input, svg);
  const result = spawnSync(process.execPath,
    [cli, 'icon', input, '--output', output, ...sizes.flatMap((size) => ['--png', String(size)])],
    { cwd: root, encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error('Tauri icon rendering failed: ' + (result.error?.message ?? result.stderr));
  }
  for (const size of sizes) {
    generated.set(variant + '-' + size + '.png', readFileSync(join(output, size + 'x' + size + '.png')));
  }
}

// Windows Vista+ ICO supports PNG-compressed RGBA frames, including 256px.
const directory = Buffer.alloc(6 + sizes.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
// Tauri uses the first ICO entry as its window bitmap; keep the highest resolution first.
const icoSizes = [256, ...sizes.filter((size) => size !== 256)];
const frames = icoSizes.map((size, index) => {
  const png = generated.get('app-' + size + '.png');
  const entry = 6 + index * 16;
  directory[entry] = size % 256;
  directory[entry + 1] = size % 256;
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(png.length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += png.length;
  return png;
});
generated.set('icon.ico', Buffer.concat([directory, ...frames]));

for (const [name, bytes] of generated) {
  const destination = join(icons, name);
  if (check) {
    if (!readFileSync(destination).equals(bytes)) throw new Error('Stale icon resource: ' + name);
  } else {
    writeFileSync(destination, bytes);
  }
}
console.log('Icon family ' + (check ? 'verified' : 'generated') + ': ' + generated.size + ' resources from icon.svg.');
