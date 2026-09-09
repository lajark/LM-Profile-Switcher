// M3-004: policy/secret scanner — the first-push gate required by
// PROJECT_DISTRIBUTION_POLICY.md §4.2. Checks tracked + untracked files
// (workspace mode) or a staged release directory (--release mode) against
// the high-signal rules in lib/policy-scan-rules.mjs.
//
// Contract:
//   * findings are {path, line, ruleId, severity, message} only — matched
//     values are NEVER echoed to stdout or written to the report;
//   * explicit exemptions live in lib/policy-scan-exemptions.json (path +
//     ruleIds + rationale); inline sentinels (`// policy-scan:fixture`,
//     `// policy-scan:exempt <ruleId>`) declare fixtures but still require a
//     registry entry under --strict;
//   * exit 1 when any error-severity finding survives exemption (or any
//     warning under --strict).
//
// Usage:
//   node scripts/policy-scan.mjs [--strict] [--release <dir>] [--large-file-bytes N]

import { spawnSync } from 'node:child_process';
import {
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getContentRules, getPathRules, isRegistryExempt } from './lib/policy-scan-rules.mjs';

const __root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXEMPTIONS_PATH = join(__root, 'scripts', 'lib', 'policy-scan-exemptions.json');
const REPORT_PATH = process.env.POLICY_SCAN_REPORT
  ? resolve(process.env.POLICY_SCAN_REPORT)
  : join(__root, 'reports', 'security-scan.json');
const CONTENT_SCAN_SIZE_LIMIT = 5 * 1024 * 1024; // bytes; larger files only get path/size rules
const SENTINEL_FIXTURE = 'policy-scan:fixture';
const SENTINEL_EXEMPT = 'policy-scan:exempt';

function parseArgs(argv) {
  const opts = { strict: false, releaseDir: null, largeFileBytes: 8 * 1024 * 1024 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--strict') opts.strict = true;
    else if (a === '--release') opts.releaseDir = resolve(__root, argv[i + 1]);
    else if (a === '--large-file-bytes') opts.largeFileBytes = Number(argv[i + 1]) || opts.largeFileBytes;
  }
  return opts;
}

/** Enumerate workspace files via git (zero shell, respects .gitignore). */
function gitFiles() {
  const res = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: __root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (res.status !== 0) {
    throw new Error(`git ls-files failed: ${res.stderr?.trim() || `exit ${res.status}`}`);
  }
  const files = res.stdout ? res.stdout.split('\0').filter(Boolean) : [];
  const tracked = new Set();
  const untracked = [];
  // Re-run to split tracked vs untracked (definitive without shell flags plumbing).
  const trackedRes = spawnSync('git', ['ls-files', '-z'], { cwd: __root, encoding: 'utf8' });
  for (const f of trackedRes.stdout ? trackedRes.stdout.split('\0').filter(Boolean) : []) {
    tracked.add(f);
  }
  for (const f of files) {
    if (tracked.has(f)) continue;
    const abs = join(__root, f);
    if (statSyncSafe(abs)?.isDirectory()) continue;
    untracked.push(f);
  }
  return { files, tracked, untracked };
}

/** Recursively list a staged release directory (pure fs, no git). */
function listTree(dir) {
  const out = [];
  const walk = (d) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const abs = join(d, ent.name);
      if (ent.isDirectory()) {
        walk(abs);
      } else {
        out.push(relative(__root, abs).replace(/\\/g, '/'));
      }
    }
  };
  walk(dir);
  return out.sort();
}

function statSyncSafe(p) {
  try {
    return statSync(p, { bigint: false });
  } catch {
    return null;
  }
}

/** Read enough of a file to detect binary content (NUL in the head). */
function looksBinary(p) {
  try {
    const fd = openSync(p, 'r');
    try {
      const buf = new Uint8Array(8192);
      const n = readSync(fd, buf, 0, buf.length, 0);
      return n > 0 && buf.subarray(0, n).includes(0);
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
}

function loadExemptions() {
  try {
    return JSON.parse(readFileSync(EXEMPTIONS_PATH, 'utf8'));
  } catch (err) {
    throw new Error(`cannot read exemptions registry ${EXEMPTIONS_PATH}: ${err.message}`, { cause: err });
  }
}

function hasFixtureSentinel(lines) {
  return lines.slice(0, 3).some((l) => l.includes(SENTINEL_FIXTURE));
}

function hasLineSentinel(lines, index, ruleId) {
  const scan = (l) => l.includes(SENTINEL_EXEMPT) && l.includes(ruleId);
  return scan(lines[index] ?? '') || (index > 0 && scan(lines[index - 1] ?? ''));
}

/**
 * Scan one file. Returns findings; severity strings carry `error`/`warning`/`info`.
 */
function scanFile(relPath, opts) {
  // `--release` staging may live outside the workspace (even on another drive);
  // path.relative then yields an absolute path that must be used as-is.
  const abs = isAbsolute(relPath) ? relPath : join(__root, relPath);
  const stat = statSyncSafe(abs);
  if (!stat) return [];
  const findings = [];
  const pathOpts = { ...opts, size: stat.size };

  for (const rule of getPathRules()) {
    if (rule.id === 'machine-output') continue; // wired from the untracked list
    if (rule.check(relPath, pathOpts)) {
      findings.push({ path: relPath, line: null, ruleId: rule.id, severity: rule.severity, message: rule.message });
    }
  }

  if (stat.size <= CONTENT_SCAN_SIZE_LIMIT && !looksBinary(abs)) {
    const text = readFileSync(abs, 'utf8');
    const lines = text.split(/\r?\n/);
    const fixtureFile = hasFixtureSentinel(lines);
    for (let i = 0; i < lines.length; i += 1) {
      for (const rule of getContentRules()) {
        if (rule.check(lines[i], relPath)) {
          findings.push({
            path: relPath,
            line: i + 1,
            ruleId: rule.id,
            severity: rule.severity,
            message: rule.message,
            fixtureFile: fixtureFile || hasLineSentinel(lines, i, rule.id),
          });
        }
      }
    }
  }

  return findings;
}

/** Classify findings against the exemptions + sentinels. Returns violations vs exempted. */
function classify(findings, registry, opts) {
  const violations = [];
  const exempted = [];
  for (const f of findings) {
    const registered = isRegistryExempt(f.path, f.ruleId, registry);
    const sentinelled = f.fixtureFile === true;
    if (registered) {
      exempted.push({ path: f.path, line: f.line, ruleId: f.ruleId });
    } else if (sentinelled) {
      if (opts.strict) {
        violations.push({ ...f, message: `${f.message}; fixture sentinel present but no registry entry (add one under --strict)` });
      } else {
        exempted.push({ path: f.path, line: f.line, ruleId: f.ruleId, sentinel: true });
      }
    } else {
      violations.push(f);
    }
  }
  return { violations, exempted };
}

function run() {
  const opts = parseArgs(process.argv.slice(2));
  const registry = loadExemptions();
  const startedAt = new Date().toISOString();
  const scanOpts = {
    strict: opts.strict,
    releaseMode: Boolean(opts.releaseDir),
    largeFileBytes: opts.largeFileBytes,
  };

  let files;
  let untracked = [];
  const findings = [];
  if (opts.releaseDir) {
    if (!statSyncSafe(opts.releaseDir)) {
      throw new Error(`release staging dir not found: ${opts.releaseDir}`);
    }
    files = listTree(opts.releaseDir);
    for (const f of files) findings.push(...scanFile(f, scanOpts));
  } else {
    const { files: all, untracked: uni } = gitFiles();
    files = all;
    untracked = uni;
    for (const f of files) findings.push(...scanFile(f, scanOpts));
    for (const f of untracked) {
      findings.push({
        path: f,
        line: null,
        ruleId: 'machine-output',
        severity: opts.strict ? 'error' : 'info',
        message: 'untracked non-ignored file present',
      });
    }
  }

  const { violations, exempted } = classify(findings, registry, opts);
  const blocked = opts.strict ? violations.filter((v) => v.severity !== 'info') : violations.filter((v) => v.severity === 'error');
  const passed = blocked.length === 0;

  const report = {
    schemaVersion: 1,
    tool: 'policy-scan',
    mode: opts.releaseDir ? `release:${relative(__root, opts.releaseDir)}` : opts.strict ? 'workspace-strict' : 'workspace',
    scannedAt: startedAt,
    root: relative(process.cwd(), __root) || '.',
    summary: {
      files: files.length,
      untrackedNonIgnored: untracked.length,
      findings: findings.length,
      exempted: exempted.length,
      violations: violations.length,
      blockers: blocked.length,
    },
    violations: violations.map((v) => ({ path: v.path, line: v.line, ruleId: v.ruleId, severity: v.severity, message: v.message })),
    exempted: exempted.map((e) => ({ path: e.path, line: e.line, ruleId: e.ruleId, sentinel: Boolean(e.sentinel) })),
    passed,
  };

  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  // Human summary — values stay redacted by construction.
  console.log(`policy-scan [${report.mode}] — ${report.summary.files} files, ${report.summary.findings} findings, ${report.summary.blockers} blockers → ${passed ? 'PASS' : 'FAIL'}`);
  for (const v of report.violations) {
    console.log(`  ${v.severity}  ${v.path}${v.line ? `:${v.line}` : ''}  [${v.ruleId}] ${v.message}`);
  }
  console.log(`report: ${relative(process.cwd(), REPORT_PATH) || REPORT_PATH}`);
  process.exitCode = passed ? 0 : 1;
}

try {
  run();
} catch (err) {
  console.error(`policy-scan failed: ${err.message}`);
  process.exitCode = 1;
}