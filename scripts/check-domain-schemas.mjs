// CI gate for the generated domain JSON Schemas.
// Verifies two things (mirroring the i18n gate pattern plus a byte-exact
// re-generation diff):
//   1. every contract in DOMAIN_SCHEMAS has a committed artifact;
//   2. every artifact matches what the current sources + generator produce
//      (any stale or hand-edited file fails).
// Run via `corepack pnpm run domain:schema:check`; wired into the root `check`
// after `build` so the dist import is fresh.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import {
  DOMAIN_OUT_REL,
  loadDomainSchemas,
  renderSchemaFile,
  schemaArtifactPath,
  schemaSourceDigest,
} from './lib/domain-schemas.mjs';

const workspaceRoot = resolve(import.meta.dirname, '..');
const issues = [];

let digest;
let entries;
try {
  digest = schemaSourceDigest(workspaceRoot);
  entries = await loadDomainSchemas(workspaceRoot);
} catch (error) {
  console.error(`domain schema gate failed: ${error.message}`);
  process.exit(1);
}

const known = new Set();
for (const entry of entries) {
  const artifactPath = schemaArtifactPath(workspaceRoot, entry.name);
  const artifactRel = relative(workspaceRoot, artifactPath);
  known.add(artifactRel);
  if (!existsSync(artifactPath)) {
    issues.push(`missing generated schema ${artifactRel}; run corepack pnpm run domain:generate`);
    continue;
  }
  const actual = readFileSync(artifactPath, 'utf8');
  const expected = renderSchemaFile(entry, digest);
  if (actual.length !== expected.length || actual !== expected) {
    issues.push(
      `${artifactRel} is out of date; run corepack pnpm run domain:generate (expected checksum ${digest.slice(0, 12)}…)`,
    );
  }
}

const outDir = resolve(workspaceRoot, DOMAIN_OUT_REL);
if (existsSync(outDir)) {
  for (const file of readdirSync(outDir)) {
    if (file.endsWith('.schema.json')) {
      const artifactRel = relative(workspaceRoot, resolve(outDir, file));
      if (!known.has(artifactRel)) {
        issues.push(`orphaned generated schema ${artifactRel}; remove it or run domain:generate`);
      }
    }
  }
}

if (issues.length > 0) {
  console.error('domain schema gate failed:');
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}
console.log(`domain schema gate passed (${entries.length} artifacts, checksum ${digest.slice(0, 12)}…).`);