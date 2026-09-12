// Layer-boundary guard for apps/core-service (M0-006 + M3-002):
// protocol.ts, handlers.ts and wiring.ts must stay pure (no node: imports, no
// process/Buffer/console globals) so they deterministically fit the
// esbuild-inlined Node SEA bundle. Only index.ts (wiring) and transports/* are
// allowed to touch Node built-ins. No private LM Studio paths or CJK anywhere.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WORKSPACE = fileURLToPath(new URL('../..', import.meta.url));
const SRC_DIR = join(WORKSPACE, 'apps', 'core-service', 'src');

/** Entry point that wires argv/env (also executes the transport servers). */
const WIRING_MODULE = 'index.ts';
/** Modules allowed to import node: built-ins (their job). */
const NODE_ALLOWED_BASENAMES = new Set([
  'index.ts',
  'process-liveness.ts',
  'stdio-rpc.ts',
  'pipe-rpc.ts',
  'http-rpc.ts',
]);

const ALLOWED_PACKAGES = [
  '@lmps/core',
  '@lmps/domain',
  '@lmps/hardware',
  '@lmps/i18n',
  '@lmps/lmstudio-adapter',
  '@lmps/profile-store',
  '@lmstudio/sdk',
];
const BANNED_TOKENS = ['@tauri-apps', 'napi', '.lmstudio', '.internal'];

const CJK_RE = /[㐀-䶿一-鿿豈-﫿぀-ヿ가-힯]/;

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) tsFiles(path, out);
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(path);
  }
  return out;
}

function isNodeAllowed(file: string): boolean {
  return NODE_ALLOWED_BASENAMES.has(file.split(/[\\/]/).pop() ?? '');
}

function packageDeps(): string[] {
  const packageJson = JSON.parse(
    readFileSync(join(WORKSPACE, 'apps', 'core-service', 'package.json'), 'utf8'),
  ) as { dependencies: Record<string, string> };
  return Object.keys(packageJson.dependencies).sort();
}

describe('core-service architecture guard (M0-006)', () => {
  const files = tsFiles(SRC_DIR);

  it('ships the expected module set', () => {
    const names = files
      .map((file) => relative(SRC_DIR, file))
      .map((name) => name.replace(/\\/g, '/'))
      .sort();
    expect(names).toEqual([
      'handlers.ts',
      'index.ts',
      'process-liveness.ts',
      'protocol.ts',
      'proxy.ts',
      'settings.ts',
      'transports/http-rpc.ts',
      'transports/index.ts',
      'transports/pipe-rpc.ts',
      'transports/stdio-rpc.ts',
      'transports/types.ts',
      'tray-i18n.ts',
      'wiring.ts',
    ]);
  });

  it('declares exactly the sidecar runtime dependencies', () => {
    expect(packageDeps()).toEqual(ALLOWED_PACKAGES);
  });

  it('keeps pure modules free of node:/process/console and private paths', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (isNodeAllowed(file)) continue;
      const source = readFileSync(file, 'utf8');
      for (const token of ['node:', 'process.', 'Buffer.', 'Deno.', 'console.', ...BANNED_TOKENS]) {
        if (source.includes(token)) offenders.push(`${relative(SRC_DIR, file)}:${token}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('limits imports to @lmps/* and @lmstudio/sdk everywhere', () => {
    const imported = new Set<string>();
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/from\s+['"](@lmps\/[a-z0-9-]+)['"]/g)) {
        imported.add(match[1]);
      }
      if (/from\s+['"]@lmstudio\/sdk['"]/.test(source)) imported.add('@lmstudio/sdk');
    }
    expect([...imported].sort()).toEqual(ALLOWED_PACKAGES);
  });

  it('keeps every source file free of CJK (including comments)', () => {
    const offenders = files
      .filter((file) => CJK_RE.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC_DIR, file));
    expect(offenders).toEqual([]);
  });

  it('keeps all transports socket-addressable only on loopback', () => {
    const http = readFileSync(join(SRC_DIR, 'transports', 'http-rpc.ts'), 'utf8');
    expect(http).toContain("'127.0.0.1'");
    expect(http).not.toContain("'0.0.0.0'");
    const pipe = readFileSync(join(SRC_DIR, 'transports', 'pipe-rpc.ts'), 'utf8');
    expect(pipe).toContain('\\\\.\\pipe\\');
  });

  it('exposes the documented index.ts wiring entry', () => {
    expect(statSync(join(SRC_DIR, WIRING_MODULE)).isFile()).toBe(true);
  });

  it('bans private LM Studio database access anywhere in source', () => {
    const source = files.map((file) => readFileSync(file, 'utf8')).join('\n');
    for (const path of ['.lmstudio', '.internal']) {
      expect(source.includes(path)).toBe(false);
    }
  });
});