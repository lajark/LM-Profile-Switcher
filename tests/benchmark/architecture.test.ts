// Architecture guard for packages/benchmark (M2-003): the suite + aggregation
// layer is pure — no Node built-ins, no process/console access, no LM Studio
// coupling, no CJK in code. `suites.ts` is a declared DATA_MODULE (deliberate
// seed data, mirroring optimizer/presets.ts); its only dependency is the pure
// @lmps/domain package.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WORKSPACE = fileURLToPath(new URL('../../', import.meta.url));
const SRC_DIR = join(WORKSPACE, 'packages', 'benchmark', 'src');

const ALLOWED_PACKAGES = ['@lmps/domain'];
/** Data module: the deterministic seed prompt suite (model input, not UI text). */
const DATA_MODULES = new Set(['suites.ts']);
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

describe('benchmark architecture guard (M2-003)', () => {
  it('ships exactly the expected source modules', () => {
    const names = srcFiles().map((p) => relative(SRC_DIR, p)).sort();
    expect(names).toEqual(['index.ts', 'metrics.ts', 'result.ts', 'suites.ts', 'validity.ts']);
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
      readFileSync(join(WORKSPACE, 'packages', 'benchmark', 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    expect(Object.keys(packageJson.dependencies)).toEqual(ALLOWED_PACKAGES);
  });

  it('keeps every source file free of Node/process/console/private-api tokens', () => {
    const offenders: string[] = [];
    for (const path of srcFiles()) {
      const source = readFileSync(path, 'utf8');
      for (const token of BANNED_TOKENS) {
        if (source.includes(token)) offenders.push(`${relative(SRC_DIR, path)}:${token}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps code free of CJK; the seed suite carries the allowed data', () => {
    const offenders: string[] = [];
    for (const path of srcFiles()) {
      const name = relative(SRC_DIR, path);
      if (DATA_MODULES.has(name)) continue;
      if (CJK_RE.test(readFileSync(path, 'utf8'))) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });

  it('exports the aggregation/invalidation/result surface from index', () => {
    const index = readFileSync(join(SRC_DIR, 'index.ts'), 'utf8');
    for (const symbol of [
      'SEED_BENCHMARK_SUITE',
      'aggregateSamples',
      'isBenchmarkValidFor',
      'buildBenchmarkResult',
      'BenchmarkPrompt',
      'BenchmarkSuite',
      'SampleMetrics',
      'BenchmarkIdentity',
      'Validity',
      'BuildBenchmarkResultInput',
    ]) {
      expect(index).toContain(symbol);
    }
    for (const module of ['metrics', 'result', 'suites', 'validity']) {
      expect(index).toContain(`./${module}.js`);
    }
  });
});