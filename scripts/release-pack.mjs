// M3-004: release assembler — the only write path into artifacts/releases/<version>/.
// Governed by PROJECT_DISTRIBUTION_POLICY.md §5: copies an explicit allowlist of
// artifacts + documents, writes `release-manifest.json` (§5.2 fields), computes
// `checksums.sha256` from the FINAL file set, then post-scans the staging tree with
// `policy-scan --release --strict`.
//
// Contract:
//   * version is read from apps/desktop/src-tauri/tauri.conf.json (single source)
//     unless --version overrides it (test seam);
//   * an existing staging dir is refused unless --force wipes it;
//   * every file in staging must be produced by an allowlist entry (no strays);
//   * exit 1 on any failure — no success state is written on error.
//
// Usage:
//   node scripts/release-pack.mjs [--version <ver>] [--allowlist <path>]
//     [--staging <dir>] [--force]

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globMatch } from './lib/policy-scan-rules.mjs';

const __root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_ALLOWLIST = join(__root, 'release-allowlist.json');
const DEFAULT_STAGING_ROOT = join(__root, 'artifacts', 'releases');

function parseArgs(argv) {
  const opts = { force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--version') opts.version = argv[i + 1];
    else if (a === '--allowlist') opts.allowlist = argv[i + 1];
    else if (a === '--staging') opts.staging = argv[i + 1];
    else if (a === '--force') opts.force = true;
  }
  return opts;
}

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

function statSyncSafe(p) {
  try {
    return statSync(p);
  } catch {
    return null;
  }
}

function readVersion() {
  const conf = readJson(join(__root, 'apps', 'desktop', 'src-tauri', 'tauri.conf.json'));
  if (!conf.version) throw new Error('tauri.conf.json has no version (single source of truth)');
  return String(conf.version);
}

function readDomainSchemaVersion() {
  const src = readFileSync(join(__root, 'packages', 'domain', 'src', 'version.ts'), 'utf8');
  const m = src.match(/SCHEMA_VERSION\s*=\s*(\d+)\s*as const/);
  return m ? Number(m[1]) : null;
}

function sha256Hex(absPath) {
  return createHash('sha256').update(readFileSync(absPath)).digest('hex');
}

function listFilesRecursive(dir, base) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listFilesRecursive(abs, base));
    else out.push(relative(base, abs).replace(/\\/g, '/'));
  }
  return out;
}

/** Expand an allowlist source pattern (exact path or glob) into existing files below baseDir. */
function resolveSources(pattern, baseDir) {
  const norm = pattern.replace(/\\/g, '/');
  const firstWildcard = norm.search(/[*?]/);
  if (firstWildcard < 0) {
    if (!statSyncSafe(join(baseDir, norm))) throw new Error(`allowlist source missing: ${norm}`);
    return [norm];
  }
  const prefixEnd = norm.lastIndexOf('/', firstWildcard);
  const staticDir = prefixEnd < 0 ? '' : norm.slice(0, prefixEnd);
  const base = staticDir === '' ? baseDir : join(baseDir, staticDir);
  if (!statSyncSafe(base)) throw new Error(`allowlist source dir missing: ${staticDir}`);
  const candidates = [];
  for (const rel of listFilesRecursive(base, base)) {
    const full = staticDir === '' ? rel : `${staticDir}/${rel}`;
    if (globMatch(norm, full)) candidates.push(full);
  }
  if (candidates.length === 0) throw new Error(`allowlist glob matched nothing: ${pattern}`);
  return candidates;
}

/**
 * Version-uniqueness gate. A source glob may match stale outputs from other
 * versions (e.g. a leftover *setup.exe from an upgrade test); require exactly
 * one candidate whose basename encodes the declared version, else refuse.
 */
function resolveVersionedSources(pattern, version, baseDir) {
  const matched = resolveSources(pattern, baseDir);
  if (matched.length <= 1) return matched;
  const versioned = matched.filter((c) => c.split('/').pop().includes(version));
  if (versioned.length === 1) return versioned;
  if (versioned.length === 0) {
    throw new Error(
      `allowlist artifact glob "${pattern}" matched ${matched.length} files but none encode version ${version}: ${matched.join(', ')}`,
    );
  }
  throw new Error(
    `allowlist artifact glob "${pattern}" matched ${versioned.length} files encoding version ${version} ` +
      `(${versioned.join(', ')}) — pin the allowlist source for a single deterministic artifact`,
  );
}

function copyToStaging(sourceRel, destPattern, staging, baseDir) {
  const fileName = sourceRel.split('/').pop();
  const destRel = destPattern.endsWith('/') ? `${destPattern}${fileName}` : destPattern;
  const abs = join(staging, destRel);
  mkdirSync(dirname(abs), { recursive: true });
  copyFileSync(join(baseDir, sourceRel), abs);
  return destRel;
}

function gitCommit() {
  const res = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: __root, encoding: 'utf8' });
  if (res.status !== 0) throw new Error('cannot resolve HEAD commit');
  const full = res.stdout.trim();
  return { full, short: full.slice(0, 8) };
}

function loadSbomInfo() {
  try {
    const bom = readJson(join(__root, 'reports', 'sbom.cdx.json'));
    return { specVersion: bom.specVersion ?? null, components: bom.components?.length ?? 0 };
  } catch {
    return { specVersion: null, components: 0 };
  }
}

function loadDepReportVersion() {
  try {
    const report = readJson(join(__root, 'reports', 'dependency-licenses.json'));
    return report.version ?? null;
  } catch {
    return null;
  }
}

function run() {
  const opts = parseArgs(process.argv.slice(2));
  const version = opts.version ?? readVersion();
  const allowlist = readJson(opts.allowlist ?? DEFAULT_ALLOWLIST);
  const staging = opts.staging
    ? resolve(__root, opts.staging)
    : join(DEFAULT_STAGING_ROOT, version);

  if (statSyncSafe(staging)) {
    if (!opts.force) {
      throw new Error(`staging already exists: ${staging} (re-run with --force to rebuild)`);
    }
    rmSync(staging, { recursive: true, force: true });
  }
  mkdirSync(staging, { recursive: true });

  const base = allowlist.base ? resolve(__root, allowlist.base) : __root;
  const copied = new Set();
  const installed = [];
  for (const a of allowlist.artifacts ?? []) {
    for (const sourceRel of resolveVersionedSources(a.source, version, base)) {
      const destRel = copyToStaging(sourceRel, a.dest, staging, base);
      if (copied.has(destRel)) throw new Error(`duplicate staging dest: ${destRel}`);
      copied.add(destRel);
      installed.push({
        path: destRel,
        role: a.role,
        size: statSyncSafe(join(staging, destRel)).size,
        sha256: sha256Hex(join(staging, destRel)),
      });
    }
  }
  for (const d of allowlist.documents ?? []) {
    for (const sourceRel of resolveSources(d.source, base)) {
      const destRel = copyToStaging(sourceRel, d.dest, staging, base);
      if (copied.has(destRel)) throw new Error(`duplicate staging dest: ${destRel}`);
      copied.add(destRel);
    }
  }

  // Guard against strays: every staged file must be produced by the allowlist.
  const strays = listFilesRecursive(staging, staging).filter((p) => !copied.has(p));
  if (strays.length > 0) {
    throw new Error(`staging contains files outside the allowlist: ${strays.join(', ')}`);
  }

  const commit = gitCommit();
  const sbom = loadSbomInfo();
  const nsisInstaller = installed.find((a) => a.role === 'windows-installer-nsis');
  const depReportVersion = loadDepReportVersion();

  const manifest = {
    product: allowlist.product,
    version,
    versionSource: 'apps/desktop/src-tauri/tauri.conf.json',
    allowlistVersion: allowlist.allowlistVersion,
    sourceCommit: commit,
    buildTime: new Date().toISOString(),
    packagingHost: { os: process.platform, arch: process.arch, node: process.version },
    targets: Object.entries(allowlist.targetMatrix).map(([os, t]) => ({
      os,
      job: t.job,
      arch: t.arch,
      variant: t.variant,
      signed: t.signed,
      notarized: t.notarized,
      note: t.note ?? t.reason ?? null,
      ...(os === 'windows'
        ? { installer: nsisInstaller?.path ?? null, installerSha256: nsisInstaller?.sha256 ?? null }
        : {}),
    })),
    schemas: {
      domain: readDomainSchemaVersion(),
      sbom: sbom.specVersion,
      sbomComponents: sbom.components,
      dependencyLicenseReport: depReportVersion,
    },
    languageSupport: ['zh-CN', 'en'],
    signingNotarization:
      'Windows installer is UNSIGNED (no code-signing certificate); macOS distribution blocked (no hardware/credentials). Development/pre-release only per PROJECT_DISTRIBUTION_POLICY.md §5.3.',
    artifactFiles: installed,
  };

  // checksums.sha256 is generated from the FINAL file set (manifest included) and
  // never hand-maintained (§5.2).
  const manifestRel = 'release-manifest.json';
  writeFileSync(join(staging, manifestRel), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  copied.add(manifestRel);

  const checksumRel = 'checksums.sha256';
  const addresses = listFilesRecursive(staging, staging)
    .filter((p) => p !== checksumRel)
    .sort()
    .map((p) => `${sha256Hex(join(staging, p))}  ${p}`);
  writeFileSync(join(staging, checksumRel), `${addresses.join('\n')}\n`, 'utf8');

  const scan = spawnSync(
    process.execPath,
    [join(__root, 'scripts', 'policy-scan.mjs'), '--release', staging, '--strict'],
    { cwd: __root, encoding: 'utf8' },
  );
  if (scan.status !== 0) {
    throw new Error(`post-scan failed for ${staging}:\n${scan.stdout}`);
  }

  const installerMiB = installed.reduce((n, a) => n + a.size, 0) / 1024 / 1024;
  console.log(
    `release-pack: ${allowlist.product} v${version} → ${relative(process.cwd(), staging)}; ` +
      `${installed.length} artifact(s), ${installerMiB.toFixed(1)} MiB installer; manifest + checksums written; policy-scan --strict PASS`,
  );
}

try {
  run();
} catch (err) {
  console.error(`release-pack failed: ${err.message}`);
  process.exitCode = 1;
}