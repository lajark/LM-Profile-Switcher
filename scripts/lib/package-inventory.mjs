import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const IGNORED_DIRECTORIES = new Set(['.bin']);

function walkPackageManifests(directory, result) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const entryPath = resolve(directory, entry.name);
    if (entry.isFile() && entry.name === 'package.json') {
      result.push(entryPath);
      continue;
    }

    if (entry.isDirectory()) {
      walkPackageManifests(entryPath, result);
    }
  }
}

function getLicenseValue(packageJson) {
  const license = packageJson.license ?? packageJson.licenses;
  if (typeof license === 'string') {
    return license.trim() || null;
  }
  if (license && typeof license === 'object' && !Array.isArray(license)) {
    const type = license.type;
    return typeof type === 'string' && type.trim() ? type.trim() : null;
  }
  if (Array.isArray(license)) {
    const values = license
      .map((item) => (typeof item === 'string' ? item : item?.type))
      .filter((item) => typeof item === 'string' && item.trim())
      .map((item) => item.trim());
    return values.length > 0 ? values.join(' OR ') : null;
  }
  return null;
}

export function normalizeLicense(packageJson) {
  return getLicenseValue(packageJson);
}

export function packagePurl(name, version) {
  const encodedName = encodeURIComponent(name).replaceAll('%2F', '/');
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
}

export function collectInstalledPackages(workspaceRoot) {
  const root = resolve(workspaceRoot);
  const pnpmStore = resolve(root, 'node_modules', '.pnpm');
  if (!statSync(pnpmStore, { throwIfNoEntry: false })) {
    throw new Error(`Installed dependency directory not found: ${relative(root, pnpmStore)}`);
  }

  const manifests = [];
  walkPackageManifests(pnpmStore, manifests);
  const packages = new Map();

  for (const manifestPath of manifests) {
    const packageJson = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (typeof packageJson.name !== 'string' || typeof packageJson.version !== 'string') {
      continue;
    }

    const key = `${packageJson.name}@${packageJson.version}`;
    if (!packages.has(key)) {
      packages.set(key, {
        name: packageJson.name,
        version: packageJson.version,
        license: normalizeLicense(packageJson),
        purl: packagePurl(packageJson.name, packageJson.version),
        manifest: relative(root, manifestPath).replaceAll('\\', '/'),
      });
    }
  }

  return [...packages.values()].sort((left, right) =>
    `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`),
  );
}
