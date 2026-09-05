// Regenerates packages/domain/schemas/*.schema.json from the @lmps/domain
// contract registry (single source of truth). Run after editing any domain
// source or schema:
//   corepack pnpm run build && corepack pnpm run domain:generate
// Generated files are byte-deterministic and must NOT be edited manually.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  DOMAIN_OUT_REL,
  loadDomainSchemas,
  renderSchemaFile,
  schemaArtifactPath,
  schemaSourceDigest,
} from './lib/domain-schemas.mjs';

const workspaceRoot = resolve(import.meta.dirname, '..');
const digest = schemaSourceDigest(workspaceRoot);
const entries = await loadDomainSchemas(workspaceRoot);

mkdirSync(resolve(workspaceRoot, DOMAIN_OUT_REL), { recursive: true });
for (const entry of entries) {
  const content = renderSchemaFile(entry, digest);
  writeFileSync(schemaArtifactPath(workspaceRoot, entry.name), content, 'utf8');
}
console.log(
  `Generated ${entries.length} domain JSON Schemas under ${DOMAIN_OUT_REL}/ (checksum ${digest.slice(0, 12)}…).`,
);