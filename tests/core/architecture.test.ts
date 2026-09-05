// Architecture guard for packages/core (M1-005): the activation state machine is
// a pure module — no Node built-ins, no process/console access, no LM Studio
// coupling. Its only allowed dependency is @lmps/domain (types + validation), so
// the whole transaction logic stays executable in tests and portable to the
// future sidecar and desktop WebView.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WORKSPACE = fileURLToPath(new URL('../../', import.meta.url));
const SRC_DIR = join(WORKSPACE, 'packages', 'core', 'src');

const ALLOWED_PACKAGES = ['@lmps/domain'];
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

describe('core architecture guard (M1-005)', () => {
  it('ships at least 8 source modules', () => {
    expect(srcFiles().length).toBeGreaterThanOrEqual(8);
  });

  it('imports only the domain package', () => {
    const imported = new Set<string>();
    for (const path of srcFiles()) {
      const source = readFileSync(path, 'utf8');
      for (const match of source.matchAll(/from\s+['"](@lmps\/[a-z0-9-]+)['"]/g)) {
        imported.add(match[1]);
      }
    }
    expect([...imported]).toEqual(ALLOWED_PACKAGES);
  });

  it('declares exactly the domain workspace dependency', () => {
    const packageJson = JSON.parse(
      readFileSync(join(WORKSPACE, 'packages', 'core', 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    expect(Object.keys(packageJson.dependencies)).toEqual(ALLOWED_PACKAGES);
  });

  it('keeps every source file free of Node/process/console/private-api tokens', () => {
    const offenders: string[] = [];
    for (const path of srcFiles()) {
      const name = relative(SRC_DIR, path);
      const source = readFileSync(path, 'utf8');
      for (const token of BANNED_TOKENS) {
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

  it('exports the activation surface from index', () => {
    const index = readFileSync(join(SRC_DIR, 'index.ts'), 'utf8');
    for (const module of ['errors', 'lock', 'ports', 'redact', 'runner', 'snapshot', 'transaction']) {
      expect(index).toContain(`./${module}.js`);
    }
  });
});