/**
 * Dependency governance audit (M5-004, deliverable #3). Reads every workspace
 * manifest (root + apps + packages), classifies each direct dependency spec
 * (workspace / pinned-registry / range-registry / wildcard / local), and cross
 * checks the installed tree for version duplicates. Outputs a JSON + text report.
 *
 * `--strict` fails (exit 1) when any *direct registry* dependency is unpinned
 * (range or wildcard) — production pinning is a hard requirement; dev-dependency
 * ranges are reported but do not fail by default.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { URL, fileURLToPath } from 'node:url';

import { collectInstalledPackages } from './lib/package-inventory.mjs';
import { classifyDependencySpec, isWorkspaceSpec } from './lib/dependency-spec.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OWN_DIRS = ['apps', 'packages'];
const DIRECT_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'];

function manifests() {
  const files = [resolve(ROOT, 'package.json')];
  for (const dir of OWN_DIRS) {
    const base = resolve(ROOT, dir);
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = resolve(base, entry.name, 'package.json');
      try {
        JSON.parse(readFileSync(manifest, 'utf8'));
        files.push(manifest);
      } catch {
        /* not a manifest directory */
      }
    }
  }
  return files;
}

function directDependencies() {
  const direct = [];
  for (const manifestPath of manifests()) {
    const pkg = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const scope = relative(ROOT, manifestPath).replaceAll('\\', '/').replace(/package\.json$/, '').replace(/\/$/, '') || '(root)';
    for (const section of DIRECT_SECTIONS) {
      for (const [name, spec] of Object.entries(pkg[section] ?? {})) {
        const context = section === 'devDependencies' ? 'dev' : section === 'optionalDependencies' ? 'optional' : 'prod';
        direct.push({ manifest: scope, section, context, name, spec: String(spec), classification: classifyDependencySpec(String(spec)) });
      }
    }
  }
  return direct;
}

function installedDuplicates() {
  const counts = new Map();
  try {
    for (const pkg of collectInstalledPackages(ROOT)) {
      if (!counts.has(pkg.name)) counts.set(pkg.name, new Set());
      counts.get(pkg.name).add(pkg.version);
    }
  } catch {
    return [];
  }
  return [...counts.entries()]
    .filter(([, versions]) => versions.size > 1)
    .map(([name, versions]) => ({ name, versions: [...versions].sort() }));
}

function buildReport(strict) {
  const direct = directDependencies();
  const duplicates = installedDuplicates();
  const unpinnedProd = direct.filter(
    (d) => d.context === 'prod' && !isWorkspaceSpec(d.spec) && d.classification !== 'pinned-registry',
  );
  const violation = strict ? unpinnedProd : [];

  const report = {
    schema_version: 1,
    scope: 'workspace direct dependencies + installed tree',
    pinned: direct.filter((d) => d.classification === 'pinned-registry').length,
    workspace: direct.filter((d) => d.classification === 'workspace').length,
    range_registry: direct.filter((d) => d.classification === 'range-registry').map((d) => `${d.name}@${d.spec} (${d.manifest}, ${d.context})`),
    wildcard_registry: direct.filter((d) => d.classification === 'wildcard-registry').map((d) => `${d.name}@${d.spec} (${d.manifest}, ${d.context})`),
    duplicates_in_tree: duplicates,
    violations: violation.map((d) => `${d.name}@${d.spec} (${d.manifest}, ${d.context})`),
    strict_mode: strict,
  };
  return { report, violation };
}

const strict = process.argv.includes('--strict');
const { report, violation } = buildReport(strict);

const text = [
  `Dependency audit (M5-004)`,
  `  direct: ${report.pinned + report.workspace + report.range_registry.length + report.wildcard_registry.length} specs (${report.pinned} pinned, ${report.workspace} workspace, ${report.range_registry.length} range, ${report.wildcard_registry.length} wildcard)`,
  `  duplicates in installed tree: ${report.duplicates_in_tree.length}`,
  ...(report.range_registry.length ? [`  range (direct):`] : []),
  ...report.range_registry.map((l) => `    - ${l}`),
  ...(report.duplicates_in_tree.length ? ['  duplicate versions:'] : []),
  ...report.duplicates_in_tree.map((d) => `    - ${d.name} (${d.versions.join(', ')})`),
  ...(violation.length ? [`  strict violations: ${violation.length}`] : []),
  ...violation.map((l) => `    - ${l}`),
].join('\n');

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(text);
}
process.exitCode = violation.length > 0 ? 1 : 0;