// Architecture guard for packages/lmstudio-adapter (M0-005): this is the one
// package allowed to own LM Studio integration. It may import only the pure
// workspace packages (@lmps/core, @lmps/domain); all Node bindings (child
// process, perf) live in exactly one module (node-env.ts); and the private
// API tokens (`.lmstudio`, `-sdk`) appear only in the SDK guard module.
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WORKSPACE = fileURLToPath(new URL('../../', import.meta.url));
const SRC_DIR = join(WORKSPACE, 'packages', 'lmstudio-adapter', 'src');

const ALLOWED_PACKAGES = ['@lmps/core', '@lmps/domain'];
const NODE_ONLY_MODULES = new Set(['node-env.ts']);
const SDK_ONLY_MODULES = new Set(['sdk-adapter.ts']);
const PRIVATE_TOKENS = ['.lmstudio', '-sdk'];
const CJK_RE = /[㐀-䶿一-鿿豈-﫿぀-ヿ가-힯]/;

function srcFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(path);
    }
  };
  walk(SRC_DIR);
  return out;
}

describe('lmstudio-adapter architecture guard (M0-005)', () => {
  it('ships at least 10 source modules', () => {
    expect(srcFiles().length).toBeGreaterThanOrEqual(10);
  });

  it('imports only the core and domain workspace packages', () => {
    const imported = new Set<string>();
    for (const path of srcFiles()) {
      const source = readFileSync(path, 'utf8');
      for (const match of source.matchAll(/from\s+['"](@lmps\/[a-z0-9-]+)['"]/g)) {
        imported.add(match[1]);
      }
    }
    expect([...imported].sort()).toEqual([...ALLOWED_PACKAGES].sort());
  });

  it('declares exactly the core and domain workspace dependencies', () => {
    const packageJson = JSON.parse(
      readFileSync(join(WORKSPACE, 'packages', 'lmstudio-adapter', 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    expect(Object.keys(packageJson.dependencies)).toEqual(ALLOWED_PACKAGES);
  });

  it('confines node: imports to node-env.ts', () => {
    const offenders: string[] = [];
    for (const path of srcFiles()) {
      const name = relative(SRC_DIR, path);
      if (NODE_ONLY_MODULES.has(basename(path))) continue;
      if (readFileSync(path, 'utf8').includes('node:')) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });

  it('confines .lmstudio/-sdk tokens to the SDK guard module', () => {
    const offenders: string[] = [];
    for (const path of srcFiles()) {
      const name = relative(SRC_DIR, path);
      if (SDK_ONLY_MODULES.has(basename(path))) continue;
      const source = readFileSync(path, 'utf8');
      for (const token of PRIVATE_TOKENS) {
        if (source.includes(token)) offenders.push(`${name}:${token}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps every source file free of CJK (including comments)', () => {
    const offenders: string[] = [];
    for (const path of srcFiles()) {
      const source = readFileSync(path, 'utf8');
      if (CJK_RE.test(source)) offenders.push(relative(SRC_DIR, path));
    }
    expect(offenders).toEqual([]);
  });

  it('exports the full adapter surface from index', () => {
    const index = readFileSync(join(SRC_DIR, 'index.ts'), 'utf8');
    for (const module of [
      'env',
      'node-env',
      'errors',
      'model-names',
      'rest/chat',
      'rest/v1',
      'rest/rest-v1-adapter',
      'cli/cli-adapter',
      'sdk/sdk-adapter',
      'mock/mock-adapter',
      'capability',
      'router',
    ]) {
      expect(index).toContain(`./${module}.js`);
    }
  });
});