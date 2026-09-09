// Presentation-boundary guard for apps/desktop TypeScript (M3-001).
// The desktop TS layer talks only to Tauri (@tauri-apps/api), the shared i18n
// package (user-approved M3-001 bridge @lmps/i18n) and the React webview stack
// — never directly to LM Studio packages or Node built-ins. Business logic
// stays out of the UI layer (ADR-0001). Rust in src-tauri is out of scope for
// this TS guard; apps/desktop/frontend is covered by i18n:check + lint.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WORKSPACE = fileURLToPath(new URL('../..', import.meta.url));
const SRC_DIR = join(WORKSPACE, 'apps', 'desktop', 'src');

/** Workspace and engine packages the desktop TS layer may import (and subpaths, e.g. @lmps/i18n/browser). */
const ALLOWED_LAYER_PACKAGES = ['@tauri-apps/api', 'react', 'react-dom', '@lmps/i18n'];
const BANNED_PACKAGE_PREFIXES = ['@lmstudio/'];
const BANNED_TOKENS = ['node:', 'process.', 'Buffer.', 'Deno.', '.lmstudio', '.internal', 'napi'];
const CJK_RE = /[㐀-䶿一-鿿豈-﫿぀-ヿ가-힯]/;

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) tsFiles(path, out);
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(path);
  }
  return out;
}

function isAllowedPackageSpecifier(specifier: string): boolean {
  return ALLOWED_LAYER_PACKAGES.some((pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`));
}

describe('desktop presentation boundary (M3-001)', () => {
  const files = tsFiles(SRC_DIR);

  it('ships at least the bootstrap entry', () => {
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files.map((f) => f.split(/[\\/]/).pop())).toContain('index.ts');
  });

  it('declares only the webview-stack packages as runtime dependencies', () => {
    const packageJson = JSON.parse(
      readFileSync(join(WORKSPACE, 'apps', 'desktop', 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    expect(Object.keys(packageJson.dependencies).sort()).toEqual([
      '@lmps/i18n',
      '@tauri-apps/api',
      'react',
      'react-dom',
    ]);
  });

  it('never imports LM Studio packages or unapproved workspace packages from TS', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const from of source.matchAll(/from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        const specifier = (from[1] ?? from[2] ?? '').trim();
        if (BANNED_PACKAGE_PREFIXES.some((p) => specifier.startsWith(p))) {
          offenders.push(`${file}:${specifier}`);
        }
        if (specifier.startsWith('@lmps/') && !isAllowedPackageSpecifier(specifier)) {
          offenders.push(`${file}:${specifier}`);
        }
        if (specifier === 'node' || specifier.startsWith('node:')) {
          offenders.push(`${file}:${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps every TS file free of Node/private-path tokens and CJK', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const token of BANNED_TOKENS) {
        if (source.includes(token)) offenders.push(`${file}:${token}`);
      }
      if (CJK_RE.test(source)) offenders.push(`${file}:CJK`);
    }
    expect(offenders).toEqual([]);
  });
});