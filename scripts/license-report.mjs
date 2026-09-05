import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { collectInstalledPackages } from './lib/package-inventory.mjs';

const workspaceRoot = resolve(import.meta.dirname, '..');
const reportsDirectory = resolve(workspaceRoot, 'reports');
const outputPath = resolve(reportsDirectory, 'dependency-licenses.json');
const packages = collectInstalledPackages(workspaceRoot);
const missing = packages.filter((item) => !item.license || item.license.toUpperCase() === 'UNLICENSED');
const report = {
  format: 'lmps-dependency-license-report',
  version: 1,
  generatedBy: 'scripts/license-report.mjs',
  packageManager: 'pnpm',
  packageCount: packages.length,
  missingLicenseCount: missing.length,
  packages,
};

if (process.argv.includes('--write')) {
  mkdirSync(reportsDirectory, { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${report.packageCount} dependency license entries to reports/dependency-licenses.json`);
}

if (missing.length > 0) {
  console.error('Dependency license scan failed; missing or unlicensed packages:');
  for (const item of missing) {
    console.error(`- ${item.name}@${item.version}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Dependency license scan passed for ${report.packageCount} packages.`);
}
