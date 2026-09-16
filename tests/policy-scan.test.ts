// policy-scan:fixture — this test file deliberately constructs every content-rule shape under test
// (all fake, none real); exemption registered in scripts/lib/policy-scan-exemptions.json.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getContentRules, getPathRules, globMatch, isRegistryExempt } from '../scripts/lib/policy-scan-rules.mjs';

const workspaceRoot = resolve(import.meta.dirname, '..');
const scanner = join(workspaceRoot, 'scripts', 'policy-scan.mjs');

const fire = (ruleId: string, line: string): boolean =>
  getContentRules().find((r) => r.id === ruleId)!.check(line, 'x.ts');
const pathFire = (ruleId: string, relPath: string, opts?: Record<string, unknown>): boolean =>
  getPathRules().find((r) => r.id === ruleId)!.check(relPath, opts);

// Fixture shapes — concatenated so the source itself stays scanner-clean.
const ghp = 'ghp_' + 'A'.repeat(24);
const sk = 'sk-' + 'live-fixture-0000';
const secretNameValue = 'Sh0rkEy-2026';

describe('content rules — positives', () => {
  it('detects high-signal prefix tokens', () => {
    expect(fire('raw-prefix-token', `const t = "${ghp}";`)).toBe(true);
    expect(fire('raw-prefix-token', `apiKey: '${sk}'`)).toBe(true);
    expect(fire('raw-prefix-token', 'xoxb-' + '1234-abcdef-abcdef')).toBe(true);
    expect(fire('raw-prefix-token', 'AKIA' + 'ABCDEF0123456789')).toBe(true);
    expect(fire('raw-prefix-token', `token ${'eyJ' + 'aXZhbGlk' + '.' + 'c2VjcmV0' + '.' + 'signature' + '-part-1'}`)).toBe(true);
  });

  it('detects private key blocks', () => {
    expect(fire('private-key-block', '-----BEGIN ' + 'PRIVATE KEY-----')).toBe(true);
    expect(fire('private-key-block', '-----BEGIN ' + 'OPENSSH PRIVATE KEY-----')).toBe(true);
  });

  it('detects credential-in-assignment', () => {
    expect(
      fire('assignment-secret', `const apiKey = "${secretNameValue}"`),
    ).toBe(true);
    expect(fire('assignment-secret', 'password: ' + '"hunter2x9!"')).toBe(true);
    expect(fire('assignment-secret', `token was set to '${sk}'`)).toBe(false); // key-word without =/: is prose
  });

  it('detects mixed-class Bearer values', () => {
    expect(fire('bearer-token', 'Bearer aB3' + '.xY~zwE1q2r3s4t5')).toBe(true);
  });

  it('detects seed phrases', () => {
    expect(fire('seed-phrase', `mnemonic = "abandon ability able about above absent absorb abstract absurd abuse access accident"`)).toBe(true);
  });
});

describe('content rules — negatives', () => {
  it('ignores regex literals used by redact/sanitize code', () => {
    expect(fire('raw-prefix-token', `/\\bsk-[A-Za-z0-9_-]{8,}.../`)).toBe(false);
    expect(fire('assignment-secret', `/(?:\\bpassword\\b|\\bpasswd\\b)/`)).toBe(false);
    expect(fire('bearer-token', `\\bBearer\\s+.../`)).toBe(false);
  });

  it('ignores template/placeholder values', () => {
    expect(fire('assignment-secret', 'token: ' + '"<env:LMPS_TOKEN>"')).toBe(false);
    expect(fire('assignment-secret', 'password: ' + '"change_me"')).toBe(false);
    expect(fire('assignment-secret', 'apiKey: ' + '"example-abc"')).toBe(false);
    expect(fire('bearer-token', '`Bearer ${' + 'token}' )).toBe(false);
    expect(fire('bearer-token', 'Bearer supertoken')).toBe(false); // lowercase-only = prose shape
    expect(fire('raw-prefix-token', 'sk-small')).toBe(false); // stem too short
  });

  it('ignores isolated key words that are not assignments', () => {
    expect(fire('assignment-secret', 'if (token.includes("x")) break;')).toBe(false);
    expect(fire('assignment-secret', 'const secret = secretValue(key);')).toBe(false);
  });
});

describe('path rules', () => {
  it('flags forbidden locations', () => {
    expect(pathFire('forbidden-path', '.ssh/authorized_keys')).toBe(true);
    expect(pathFire('forbidden-path', 'config/secrets/creds.json')).toBe(true);
    expect(pathFire('forbidden-path', 'id_rsa')).toBe(true);
    expect(pathFire('forbidden-path', 'deploy/.env.production')).toBe(true);
  });

  it('allows documented exemplars and homegrown dirs', () => {
    expect(pathFire('forbidden-path', '.env.example')).toBe(false);
    expect(pathFire('forbidden-path', 'env/dev.json')).toBe(false);
    expect(pathFire('forbidden-path', 'docs/.ssh-notes.md')).toBe(false);
  });

  it('flags cert/private-key extensions, releasing packaged installers in release mode', () => {
    expect(pathFire('cert-ext', 'tools/cert.pem')).toBe(true);
    expect(pathFire('cert-ext', 'keystore/key.p12')).toBe(true);
    expect(pathFire('cert-ext', 'installer.exe')).toBe(false);
    expect(pathFire('cert-ext', 'installer.exe', { releaseMode: true })).toBe(false);
  });

  it('applies the size threshold', () => {
    expect(pathFire('large-file', 'big.bin', { size: 9 * 1024 * 1024, largeFileBytes: 8 * 1024 * 1024 })).toBe(true);
    expect(pathFire('large-file', 'small.bin', { size: 1024, largeFileBytes: 8 * 1024 * 1024 })).toBe(false);
  });
});

describe('glob matching and registry exemption', () => {
  const registry = {
    entries: [
      { path: 'tests/fixture-a.test.ts', ruleIds: ['raw-prefix-token'] },
      { path: 'fixtures/**', ruleIds: ['assignment-secret'] },
      { path: 'special-*.ts', ruleIds: ['*'] },
    ],
  };

  it('normalizes slashes and leading ./', () => {
    expect(globMatch('./a/b.ts', 'a/b.ts')).toBe(true);
    expect(globMatch('a\\b.ts', 'a/b.ts')).toBe(true);
  });

  it('matches exact, directory-glob and basename-wildcard patterns', () => {
    expect(globMatch('dir/**', 'dir/a/b.ts')).toBe(true);
    expect(globMatch('dir/**', 'dir2/a.ts')).toBe(false);
    expect(globMatch('special-*.ts', 'special-x.ts')).toBe(true);
    expect(globMatch('special-*.ts', 'special-another.ts')).toBe(true);
    expect(globMatch('special-*.ts', 'specialx.ts')).toBe(false);
    expect(globMatch('special-*.ts', 'regular.ts')).toBe(false);
  });

  it('applies ruleIds precisely, with * meaning all rules', () => {
    expect(isRegistryExempt('tests/fixture-a.test.ts', 'raw-prefix-token', registry)).toBe(true);
    expect(isRegistryExempt('tests/fixture-a.test.ts', 'assignment-secret', registry)).toBe(false);
    expect(isRegistryExempt('fixtures/seed.json', 'assignment-secret', registry)).toBe(true);
    expect(isRegistryExempt('special-x.ts', 'bearer-token', registry)).toBe(true);
    expect(isRegistryExempt('unrelated.ts', 'raw-prefix-token', registry)).toBe(false);
  });
});

describe('policy-scan CLI', () => {
  function run(args: string[]) {
    const reportPath = join(mkdtempSync(join(tmpdir(), 'lmps-policyscan-')), 'security-scan.json');
    const res = spawnSync(process.execPath, [scanner, ...args], {
      cwd: workspaceRoot,
      encoding: 'utf8',
      env: { ...process.env, POLICY_SCAN_REPORT: reportPath },
    });
    const report = res.status === 0 || !res.stderr ? safeReadReport(reportPath) : null;
    return { code: res.status, stdout: res.stdout ?? '', report };
  }

  function safeReadReport(p: string): unknown {
    try {
      return JSON.parse(readFileSync(p, 'utf8'));
    } catch {
      return null;
    }
  }

  it('passes on the live workspace (no error-level findings)', () => {
    const { code, report } = run([]);
    expect(code).toBe(0);
    const summary = (report as { summary: { blockers: number } })?.summary;
    expect(summary?.blockers).toBe(0);
  }, 15_000);

  it('fails a staged release dir containing a secret-shaped token, without echoing the value', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'lmps-polydir-')), 'release');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'credentials.txt'), `api_key = "${ghp}"\n`, 'utf8');
    const { code, stdout, report } = run(['--release', dir, '--strict']);
    expect(code).toBe(1);
    expect(stdout).not.toContain(ghp);
    expect(JSON.stringify(report)).not.toContain(ghp);
    const blocked = (report as { summary: { blockers: number } })?.summary?.blockers;
    expect(blocked).toBeGreaterThan(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it('fails a staged release dir containing a private key block', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'lmps-polydir-')), 'release');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'cert.pem'), '-----BEGIN ' + 'PRIVATE KEY-----' + '\nAAAAAAAA\n' + '-----END PRIVATE KEY-----' + '\n', 'utf8');
    const { code } = run(['--release', dir, '--strict']);
    expect(code).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('passes a clean staged release dir in a package-shaped tree', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'lmps-polydir-')), 'release');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'installer.exe'), 'MZ fake', 'utf8'); // packaged artifact, not a cert
    writeFileSync(join(dir, 'LICENSE'), 'MIT', 'utf8');
    const { code } = run(['--release', dir, '--strict']);
    expect(code).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it('lets an unregistered fixture sentinel pass by default but blocks under --strict', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'lmps-polydir-')), 'release');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'fixture.txt'), `// policy-scan:fixture\napi_key = "${sk}"\n`, 'utf8');
    const lax = run(['--release', dir]);
    expect(lax.code).toBe(0);
    const strict = run(['--release', dir, '--strict']);
    expect(strict.code).toBe(1);
    expect(strict.report).toSatisfy((r) => {
      const s = (r as { summary?: { blockers?: unknown } } | null)?.summary;
      return typeof s?.blockers === 'number' && s.blockers >= 1;
    });
    rmSync(dir, { recursive: true, force: true });
  });
});