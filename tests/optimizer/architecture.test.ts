// Architecture guard for packages/optimizer (M2-001): the rule catalog layer is
// pure — no Node built-ins, no process/console access, no LM Studio coupling,
// no CJK in code. Rationale text lives in `presets.ts` (a DATA_MODULES file: a
// declared data module), so the bilingual seed data is exempt from the CJK scan
// while code stays readable. Its only allowed dependency is @lmps/domain.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WORKSPACE = fileURLToPath(new URL('../../', import.meta.url));
const SRC_DIR = join(WORKSPACE, 'packages', 'optimizer', 'src');

const ALLOWED_PACKAGES = ['@lmps/domain'];
/** Source modules that deliberately carry user-facing data (bilingual rationale). */
const DATA_MODULES = new Set(['notes.ts', 'presets.ts']);
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

describe('optimizer architecture guard (M2-001 → M2-002)', () => {
  it('ships exactly the expected source modules', () => {
    const names = srcFiles().map((p) => relative(SRC_DIR, p)).sort();
    expect(names).toEqual([
      'calibration.ts',
      'candidate.ts',
      'catalog.ts',
      'feedback.ts',
      'index.ts',
      'notes.ts',
      'offload-ladder.ts',
      'presets.ts',
      'recommendation.ts',
      'resource-fit.ts',
      'safe-margin.ts',
      'scoring.ts',
    ]);
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
      readFileSync(join(WORKSPACE, 'packages', 'optimizer', 'package.json'), 'utf8'),
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

  it('keeps code free of CJK; data modules carry the bilingual rationale', () => {
    const offenders: string[] = [];
    for (const path of srcFiles()) {
      const name = relative(SRC_DIR, path);
      if (DATA_MODULES.has(name)) continue;
      const source = readFileSync(path, 'utf8');
      if (CJK_RE.test(source)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the seed self-validating at module load', () => {
    const presets = readFileSync(join(SRC_DIR, 'presets.ts'), 'utf8');
    expect(presets).toContain('StrictRulesDocumentSchema.safeParse');
    expect(presets).toContain('throw new Error');
  });

  it('exports the catalog and candidate pipeline from index', () => {
    const index = readFileSync(join(SRC_DIR, 'index.ts'), 'utf8');
    for (const symbol of [
      'loadRuleCatalog',
      'validateRuleCatalog',
      'RuleCatalog',
      'RuleCatalogValidation',
      'SEED_RULE_CATALOG',
      'generateCandidateDrafts',
      'filterByHardConstraints',
      'toCapabilityPath',
      'CandidateDraft',
      'CandidateRejection',
      'HardConstraintFilter',
      'computeSafetyMargin',
      'SafetyMargin',
      'classifyResourceFit',
      'gpuReserveBytes',
      'ramReserveBytes',
      'DEFAULT_GPU_RESERVE_MIN_BYTES',
      'DEFAULT_GPU_RESERVE_FRACTION',
      'DEFAULT_RAM_RESERVE_MIN_BYTES',
      'DEFAULT_RAM_RESERVE_FRACTION',
      'ResourceFitVerdict',
      'scoreCandidate',
      'diffAgainst',
      'buildRationale',
      'generateRecommendation',
      'RATIONALE_NOTE',
    ]) {
      expect(index).toContain(symbol);
    }
    for (const module of ['catalog', 'presets', 'candidate', 'safe-margin', 'resource-fit', 'offload-ladder', 'calibration', 'scoring', 'recommendation', 'notes']) {
      expect(index).toContain(`./${module}.js`);
    }
  });
});