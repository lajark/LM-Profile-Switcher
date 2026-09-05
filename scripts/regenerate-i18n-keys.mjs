// Regenerates packages/i18n/src/resources.generated.ts from locales/*.json.
// Run after editing any locale file: `corepack pnpm run i18n:generate`.
// The generated file is the single type source for ResourceKey/CommonResources.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RESOURCE_FILE,
  SUPPORTED_LOCALES,
  computeLocalesDigest,
  loadAllLocaleResources,
} from './lib/i18n-locales.mjs';

const GENERATED_PATH = 'packages/i18n/src/resources.generated.ts';

export function resourceKeyDeclaration(workspaceRoot) {
  const resources = loadAllLocaleResources(workspaceRoot);
  const allKeys = [];
  const seen = new Set();
  for (const locale of SUPPORTED_LOCALES) {
    for (const key of Object.keys(resources[locale])) {
      if (!seen.has(key)) {
        seen.add(key);
        allKeys.push(key);
      }
    }
  }
  const digest = computeLocalesDigest(workspaceRoot);

  const lines = [
    '// GENERATED FILE — do not edit manually.',
    `// Source of truth: ${SUPPORTED_LOCALES.map((l) => `locales/${l}/${RESOURCE_FILE}.json`).join(', ')}.`,
    '// Regenerate with `corepack pnpm run i18n:generate`.',
    `// __CHECKSUM__: ${digest}`,
    '',
    `export const DEFAULT_NAMESPACE = '${RESOURCE_FILE}';`,
    '',
    'export const resourceKeys = [',
  ];
  for (const key of allKeys) {
    lines.push(`  '${key}',`);
  }
  lines.push('] as const;', '', 'export type ResourceKey = (typeof resourceKeys)[number];', '');
  lines.push('export interface CommonResources {');
  for (const key of allKeys) {
    lines.push(`  '${key}': string;`);
  }
  lines.push('}');

  return {
    keys: allKeys,
    digest,
    content: `${lines.join('\n')}\n`,
  };
}

export function writeResourceKeyFile(workspaceRoot) {
  const declaration = resourceKeyDeclaration(workspaceRoot);
  const target = resolve(workspaceRoot, GENERATED_PATH);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, declaration.content, 'utf8');
  return { keys: declaration.keys, digest: declaration.digest, target };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const workspaceRoot = resolve(import.meta.dirname, '..');
  const { keys, digest, target } = writeResourceKeyFile(workspaceRoot);
  console.log(`Regenerated ${target} (${keys.length} keys, checksum ${digest.slice(0, 12)}…).`);
}