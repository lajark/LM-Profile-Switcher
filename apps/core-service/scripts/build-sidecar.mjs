// M0-006 spike: bundle the sidecar source into one self-contained CJS file.
// Bundling from `src/*.ts` (not the tsc `dist/`) makes the SEA build
// self-contained and immune to stale build artifacts; the root `pnpm build`
// (tsc -b) still type-checks the same sources. Everything except node:
// builtins is inlined — including @lmstudio/sdk and the @lmps workspace
// packages — so the Node SEA can run with `import()` only loading builtins.
import { build } from 'esbuild';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'src');
const outDir = resolve(root, 'dist-bundle');
const outFile = resolve(outDir, 'sidecar.cjs');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [resolve(dist, 'index.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  outfile: outFile,
  logLevel: 'info',
  minify: true,
});

console.log(`bundle ok: ${outFile}`);