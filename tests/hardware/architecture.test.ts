// Layer-boundary guard for packages/hardware (M1-001):
// pure modules (parsers, redaction, fingerprint, orchestration) must not import
// Node built-ins — platform access flows through the injected ProbeEnv and the
// two wiring modules (exec.ts, index.ts). No private LM Studio path strings may
// appear anywhere in source.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));
const hardwareRoot = resolve(workspaceRoot, 'packages/hardware');

const NODE_BUILTINS = new Set([
  'child_process',
  'crypto',
  'fs',
  'os',
  'path',
  'process',
  'url',
  'util',
]);

/** Filenames (basename) that are allowed to import Node built-ins. */
const WIRING_MODULES = new Set(['exec.ts', 'index.ts']);

function tsFiles(directory: string, output: string[] = []): string[] {
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

function basename(file: string): string {
  return file.split(/[\\/]/).pop() ?? '';
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const re = /\bimport\b[^;]*?from\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    specifiers.push(match[1] ?? match[2] ?? match[3]);
  }
  return specifiers;
}

const hardwareSrcFiles = tsFiles(resolve(hardwareRoot, 'src'));

describe('hardware layering (platform access is injected)', () => {
  it('finds the expected source files to scan', () => {
    expect(hardwareSrcFiles.length).toBeGreaterThanOrEqual(8);
  });

  it('declares exactly one runtime dependency: @lmps/domain', () => {
    const pkg = JSON.parse(readFileSync(join(hardwareRoot, 'package.json'), 'utf8'));
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual(['@lmps/domain']);
  });

  it.each(hardwareSrcFiles.map((file) => [relative(workspaceRoot, file), file]))(
    '%s imports no Node built-in outside the wiring modules',
    (_label, file) => {
      const source = readFileSync(file, 'utf8');
      const isWiring = WIRING_MODULES.has(basename(file));
      const offenders = importSpecifiers(source)
        .map((specifier) => specifier.trim())
        .filter(
          (specifier) =>
            !isWiring &&
            (specifier === 'node' || specifier.startsWith('node:') || NODE_BUILTINS.has(specifier)),
        );
      expect(offenders).toEqual([]);
    },
  );

  it('pure modules never reference Node globals', () => {
    const pureSource = hardwareSrcFiles
      .filter((file) => !WIRING_MODULES.has(basename(file)))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    for (const forbidden of ['node:', 'process.', 'Buffer.', 'Deno.']) {
      expect(pureSource).not.toContain(forbidden);
    }
  });

  it('contains no private LM Studio path strings anywhere', () => {
    const source = hardwareSrcFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
    for (const forbidden of ['.lmstudio', '.internal']) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('does not import the LM Studio adapter, Tauri or native bindings', () => {
    const source = hardwareSrcFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
    for (const offender of ['@lmps/lmstudio-adapter', '@tauri-apps', 'lmstudio', 'napi']) {
      expect(source).not.toContain(offender);
    }
  });
});