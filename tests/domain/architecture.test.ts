// Layer-boundary guard (AGENTS "Domain 不得依赖平台"; ARCHITECTURE §9):
// @lmps/domain must stay pure — no Node/Tauri/network/LM Studio imports, and
// its only declared runtime dependencies are the pure zod/yaml libraries.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// fileURLToPath 而非 .pathname:.pathname 在 Windows 上会产生前导斜杠,无法被 node:fs 使用
const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));
const domainRoot = resolve(workspaceRoot, 'packages/domain');

// Node core modules that would pull platform behavior into the domain.
const NODE_BUILTINS = new Set([
  'node',
  'assert',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'domain',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'timers',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
]);

function tsFiles(directory, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      tsFiles(entryPath, output);
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      output.push(entryPath);
    }
  }
  return output;
}

function importSpecifiers(source) {
  const specifiers = [];
  const re = /\bimport\b[^;]*?from\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    specifiers.push(match[1] ?? match[2] ?? match[3]);
  }
  return specifiers;
}

const domainSrcFiles = tsFiles(resolve(domainRoot, 'src'));

describe('domain purity (no platform imports)', () => {
  it('finds the expected source files to scan', () => {
    expect(domainSrcFiles.length).toBeGreaterThanOrEqual(8);
  });

  it('declares only pure runtime dependencies (zod, yaml)', () => {
    const pkg = JSON.parse(readFileSync(join(domainRoot, 'package.json'), 'utf8'));
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual(['yaml', 'zod']);
  });

  it.each(domainSrcFiles.map((file) => [relative(workspaceRoot, file), file]))(
    '%s imports no Node/Tauri/network/LM Studio module',
    (_label, file) => {
      const source = readFileSync(file, 'utf8');
      const offenders = importSpecifiers(source)
        .map(specifier => specifier.trim())
        .filter((specifier) => specifier === 'node' || specifier.startsWith('node:') || NODE_BUILTINS.has(specifier));
      expect(offenders).toEqual([]);
    },
  );

  it('never references Node globals or network APIs', () => {
    const source = domainSrcFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
    for (const forbidden of ['node:', 'process.', 'Buffer.', 'Deno.']) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('does not import Tauri, LM Studio or the file system by name', () => {
    const source = domainSrcFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
    for (const offender of [
      '@tauri-apps',
      '@lmps/lmstudio-adapter',
      './lmstudio',
      'lmstudio',
      'napi',
    ]) {
      expect(source).not.toContain(offender);
    }
  });
});