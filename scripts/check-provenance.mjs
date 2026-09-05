import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function findFiles(directory) {
  if (!existsSync(directory)) {
    return [];
  }

  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...findFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

export function validateProvenanceRoot(workspaceRoot) {
  const root = resolve(workspaceRoot);
  const registryPath = resolve(root, 'docs', 'PROVENANCE.yml');
  const errors = [];

  if (!existsSync(registryPath)) {
    errors.push('docs/PROVENANCE.yml is missing');
    return errors;
  }

  const registry = readFileSync(registryPath, 'utf8');
  if (!/^schemaVersion:\s*1\s*$/m.test(registry)) {
    errors.push('docs/PROVENANCE.yml must declare schemaVersion: 1');
  }
  if (!/^components:\s*(\[\])?\s*$/m.test(registry)) {
    errors.push('docs/PROVENANCE.yml must declare a components collection');
  }

  const importedFiles = findFiles(resolve(root, 'vendor')).filter(
    (filePath) => !filePath.endsWith('README.md'),
  );
  const hasEmptyComponents = /^components:\s*\[\]\s*$/m.test(registry);
  if (importedFiles.length > 0 && hasEmptyComponents) {
    errors.push('vendored files exist but docs/PROVENANCE.yml has no component entries');
  }

  if (!hasEmptyComponents) {
    const componentCount = (registry.match(/^\s*- id:/gm) ?? []).length;
    if (componentCount === 0) {
      errors.push('non-empty provenance registry has no component ids');
    }
    for (const field of ['upstream:', 'local:', 'governance:']) {
      const fieldCount = (registry.match(new RegExp(`^\\s+${field}`, 'gm')) ?? []).length;
      if (fieldCount < componentCount) {
        errors.push(`every provenance component must include ${field}`);
      }
    }
  }

  return errors;
}

const workspaceRoot = resolve(import.meta.dirname, '..');
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = validateProvenanceRoot(workspaceRoot);
  if (errors.length > 0) {
    console.error('Provenance validation failed:');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
  } else {
    console.log('Provenance validation passed.');
  }
}
