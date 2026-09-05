import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { collectInstalledPackages } from './lib/package-inventory.mjs';

const workspaceRoot = resolve(import.meta.dirname, '..');
const reportsDirectory = resolve(workspaceRoot, 'reports');
const outputPath = resolve(reportsDirectory, 'sbom.cdx.json');
const packages = collectInstalledPackages(workspaceRoot);

function licenseDescriptor(license) {
  if (!license || license.startsWith('SEE LICENSE IN')) {
    return { license: { name: license ?? 'UNKNOWN' } };
  }
  return { license: { id: license } };
}

const components = packages.map((item) => ({
  type: 'library',
  bomRef: item.purl,
  name: item.name,
  version: item.version,
  purl: item.purl,
  licenses: [licenseDescriptor(item.license)],
}));

const bom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: 'urn:uuid:00000000-0000-4000-8000-000000000001',
  version: 1,
  metadata: {
    component: {
      type: 'application',
      name: 'lm-profile-switcher',
      version: '0.1.0',
    },
    tools: [{ vendor: 'LM Profile Switcher', name: 'scripts/sbom.mjs', version: '1' }],
  },
  components,
};

mkdirSync(reportsDirectory, { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(bom, null, 2)}\n`, 'utf8');
console.log(`Wrote CycloneDX ${bom.specVersion} SBOM with ${components.length} components to reports/sbom.cdx.json`);
