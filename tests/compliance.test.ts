import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateProvenanceRoot } from '../scripts/check-provenance.mjs';
import { collectInstalledPackages } from '../scripts/lib/package-inventory.mjs';

const workspaceRoot = resolve(import.meta.dirname, '..');

describe('license and provenance controls', () => {
  it('inventories installed packages with a license', () => {
    const packages = collectInstalledPackages(workspaceRoot);

    expect(packages.length).toBeGreaterThan(0);
    expect(packages.every((item) => item.license)).toBe(true);
    expect(packages.some((item) => item.name === 'eslint')).toBe(true);
  });

  it('rejects an unregistered vendored file', () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'lmps-provenance-'));
    const docsDirectory = join(temporaryRoot, 'docs');
    const vendorDirectory = join(temporaryRoot, 'vendor');
    mkdirSync(docsDirectory, { recursive: true });
    mkdirSync(vendorDirectory, { recursive: true });
    writeFileSync(
      join(docsDirectory, 'PROVENANCE.yml'),
      'schemaVersion: 1\ncomponents: []\n',
      'utf8',
    );
    writeFileSync(join(vendorDirectory, 'ported.ts'), 'export {};\n', 'utf8');

    try {
      expect(validateProvenanceRoot(temporaryRoot)).toContain(
        'vendored files exist but docs/PROVENANCE.yml has no component entries',
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
