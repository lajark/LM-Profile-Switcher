import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { collectInstalledPackages } from './lib/package-inventory.mjs';

const workspaceRoot = resolve(import.meta.dirname, '..');
const reportsDirectory = resolve(workspaceRoot, 'reports');
const outputPath = resolve(reportsDirectory, 'THIRD_PARTY_NOTICES.generated.md');
const packages = collectInstalledPackages(workspaceRoot);

const lines = [
  '# Generated Third-Party Dependency Notices',
  '',
  '> Generated from the installed pnpm dependency graph. Do not edit manually; regenerate with `corepack pnpm run notices`.',
  '',
  `Package count: ${packages.length}`,
  '',
  '| Package | Version | License |',
  '|---|---:|---|',
];

for (const item of packages) {
  lines.push(`| \`${item.name}\` | ${item.version} | ${item.license ?? 'UNKNOWN'} |`);
}

mkdirSync(reportsDirectory, { recursive: true });
writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
console.log(`Wrote generated dependency notices to reports/THIRD_PARTY_NOTICES.generated.md`);
