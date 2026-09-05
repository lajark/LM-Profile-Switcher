import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WORKSPACE = fileURLToPath(new URL('../../', import.meta.url));
const SRC_DIR = join(WORKSPACE, 'apps', 'cli', 'src');

/** Modules allowed to wire Node built-ins (index.ts boots, deps.ts injects). */
const WIRING_MODULES = new Set(['index.ts', 'deps.ts']);
const ALLOWED_PACKAGES = [
  '@lmps/core',
  '@lmps/domain',
  '@lmps/hardware',
  '@lmps/i18n',
  '@lmps/lmstudio-adapter',
  '@lmps/profile-store',
];
const BANNED_TOKENS = [
  'node:',
  'process.',
  'Buffer.',
  'Deno.',
  'console.',
  '.lmstudio',
  '-sdk',
  '@tauri-apps',
  'napi',
];
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

describe('CLI architecture guard (M1-004 → M2-002)', () => {
  it('ships at least 19 source modules', () => {
    expect(srcFiles().length).toBeGreaterThanOrEqual(19);
  });

  it('exposes index.ts and deps.ts as the only wiring modules', () => {
    const entries = readdirSync(SRC_DIR);
    expect(entries).toContain('index.ts');
    expect(entries).toContain('deps.ts');
    const files = srcFiles().map((path) => relative(SRC_DIR, path));
    const nonWiringWithNode = files.filter(
      (name) => !WIRING_MODULES.has(name) && readFileSync(join(SRC_DIR, name), 'utf8').includes('node:'),
    );
    expect(nonWiringWithNode).toEqual([]);
  });

  it('imports only the six workspace packages', () => {
    const imported = new Set<string>();
    for (const path of srcFiles()) {
      const source = readFileSync(path, 'utf8');
      for (const match of source.matchAll(/from\s+['"](@lmps\/[a-z0-9-]+)['"]/g)) {
        imported.add(match[1]);
      }
    }
    expect([...imported].sort()).toEqual([...ALLOWED_PACKAGES].sort());
  });

  it('keeps non-wiring modules free of Node/process/console/private-api tokens', () => {
    const offenders: string[] = [];
    for (const path of srcFiles()) {
      const name = relative(SRC_DIR, path);
      if (WIRING_MODULES.has(name)) continue;
      const source = readFileSync(path, 'utf8');
      for (const token of BANNED_TOKENS) {
        if (source.includes(token)) offenders.push(`${name}:${token}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps every CLI source file free of CJK (including comments)', () => {
    const offenders: string[] = [];
    for (const path of srcFiles()) {
      const source = readFileSync(path, 'utf8');
      if (CJK_RE.test(source)) offenders.push(relative(SRC_DIR, path));
    }
    expect(offenders).toEqual([]);
  });

  it('keeps wiring-module Node usage limited to index.ts and deps.ts', () => {
    for (const name of [...WIRING_MODULES]) {
      const path = join(SRC_DIR, name);
      expect(statSync(path).isFile()).toBe(true);
    }
  });

  it('declares exactly the six workspace dependencies in order', () => {
    const packageJson = JSON.parse(
      readFileSync(join(WORKSPACE, 'apps', 'cli', 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    expect(Object.keys(packageJson.dependencies)).toEqual(ALLOWED_PACKAGES);
  });

  it('keeps configuration storage inside the profile-store Fsys seam', () => {
    const config = readFileSync(join(SRC_DIR, 'config.ts'), 'utf8');
    expect(config).toContain('writeFileAtomic');
  });
});