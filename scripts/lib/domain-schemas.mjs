// Shared helpers for the domain JSON Schema generation and its CI gate.
// The generated artifacts are byte-deterministic: any source or generator change
// produces a different file, so the gate can compare content exactly (no manual
// edits allowed — the `__CHECKSUM__` in each file's `$comment` mirrors the i18n
// generated-key pattern).

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DOMAIN_OUT_REL = 'packages/domain/schemas';
const DOMAIN_SRC_REL = 'packages/domain/src';
const DIST_ENTRY_REL = 'packages/domain/dist/index.js';

function collectTsFiles(directory, output) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      collectTsFiles(entryPath, output);
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      output.push(entryPath);
    }
  }
}

/**
 * SHA-256 over all domain sources (paths + raw bytes). This is the "source of
 * truth" side of the freshness gate, mirroring `computeLocalesDigest`.
 */
export function schemaSourceDigest(workspaceRoot) {
  const srcRoot = resolve(workspaceRoot, DOMAIN_SRC_REL);
  if (!existsSync(srcRoot)) {
    throw new Error(`missing domain source root: ${srcRoot}`);
  }
  const files = [];
  collectTsFiles(srcRoot, files);
  files.sort((a, b) => relative(workspaceRoot, a).localeCompare(relative(workspaceRoot, b)));

  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(relative(workspaceRoot, file));
    hash.update('\0');
    hash.update(readFileSync(file));
  }
  return hash.digest('hex');
}

/** Loads the contract registry from the built package (run `build` first). */
export async function loadDomainSchemas(workspaceRoot) {
  const entryPath = resolve(workspaceRoot, DIST_ENTRY_REL);
  if (!existsSync(entryPath)) {
    throw new Error(
      `missing built domain package (${relative(
        workspaceRoot,
        entryPath,
      )}); run corepack pnpm run build before generating schemas`,
    );
  }
  const module = await import(pathToFileURL(entryPath).href);
  if (!module || !Array.isArray(module.DOMAIN_SCHEMAS)) {
    throw new Error(`@lmps/domain does not export DOMAIN_SCHEMAS from ${relative(workspaceRoot, entryPath)}`);
  }
  return module.DOMAIN_SCHEMAS;
}

/** Renders one deterministic schema artifact (trailing newline, 2-space indent). */
export function renderSchemaFile(entry, digest) {
  if (!entry || typeof entry.jsonSchema !== 'function') {
    throw new Error(`invalid domain schema entry: ${JSON.stringify(entry && entry.name)}`);
  }
  const json = entry.jsonSchema();
  if (json === null || typeof json !== 'object') {
    throw new Error(`schema entry ${entry.name} produced a non-object JSON Schema`);
  }
  const doc = {
    ...json,
    title: entry.title,
    description: entry.description,
    $comment: `GENERATED FILE - do not edit manually. __CHECKSUM__: ${digest}`,
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export function schemaArtifactPath(workspaceRoot, name) {
  return resolve(workspaceRoot, DOMAIN_OUT_REL, `${name}.schema.json`);
}