// M3-004: release-pack assembly contract tests — allowlist-driven staging,
// release-manifest.md (§5.2 fields), checksums.sha256 over the final set, and
// the post-scan gate. Sources/base point at temp dirs so nothing depends on
// a completed `tauri build`.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = resolve(import.meta.dirname, '..');
const packScript = join(workspaceRoot, 'scripts', 'release-pack.mjs');

function sha256Hex(absPath: string): string {
  return createHash('sha256').update(readFileSync(absPath)).digest('hex');
}

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'lmps-releasepack-'));
  const src = join(base, 'src');
  const out = join(base, 'out'); // NOT pre-created: pack must be the creator
  mkdirSync(join(src, 'nsis'), { recursive: true });
  writeFileSync(join(src, 'nsis', 'LM Profile Switcher_9.9.9_x64-setup.exe'), 'MZ fake installer bytes', 'utf8');
  writeFileSync(join(src, 'LICENSE.txt'), 'MIT fixture license\n', 'utf8');
  writeFileSync(join(src, 'notes.md'), '# Release notes\n', 'utf8');
  writeFileSync(
    join(base, 'allowlist.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        product: 'LM Profile Switcher Test',
        allowlistVersion: 1,
        base: src,
        artifacts: [
          { role: 'windows-installer-nsis', source: 'nsis/*-setup.exe', dest: 'windows-x86_64/' },
        ],
        documents: [
          { role: 'license', source: 'LICENSE.txt', dest: 'LICENSE' },
          { role: 'release-notes', source: 'notes.md', dest: 'RELEASE_NOTES.txt' },
        ],
        excludedByDefault: [],
        targetMatrix: {
          windows: {
            job: 'x86_64-pc-windows-msvc',
            arch: 'x86_64',
            variant: 'nsis',
            signed: false,
            notarized: false,
          },
          macos: { job: 'blocked', arch: 'blocked', variant: 'blocked', signed: false, notarized: false },
        },
      },
      null,
      2,
    ),
    'utf8',
  );
  return { base, src, out };
}

function runPack(args: string[]) {
  return spawnSync(process.execPath, [packScript, ...args], {
    cwd: workspaceRoot,
    encoding: 'utf8',
  });
}

describe('release-pack', () => {
  it('assembles the allowlist into a staging tree with manifest and checksums', () => {
    const { base, out } = fixture();
    const res = runPack(['--version', '9.9.9', '--allowlist', join(base, 'allowlist.json'), '--staging', out]);
    expect(res.status).toBe(0);

    const manifest = JSON.parse(readFileSync(join(out, 'release-manifest.json'), 'utf8'));
    expect(manifest.version).toBe('9.9.9');
    expect(manifest.versionSource).toBe('apps/desktop/src-tauri/tauri.conf.json');
    expect(manifest.sourceCommit.full).toMatch(/^[0-9a-f]{40}$/);
    expect(manifest.targets[0]).toMatchObject({ os: 'windows', variant: 'nsis', signed: false });
    expect(manifest.targets[0].installer).toBe('windows-x86_64/LM Profile Switcher_9.9.9_x64-setup.exe');
    expect(manifest.targets[1]).toMatchObject({ os: 'macos', job: 'blocked' });
    expect(manifest.artifactFiles).toHaveLength(1);
    expect(manifest.artifactFiles[0].sha256).toBe(
      sha256Hex(join(out, 'windows-x86_64', 'LM Profile Switcher_9.9.9_x64-setup.exe')),
    );

    // Staged layout: installer + 3 documents + manifest + checksums.
    const checksums = readFileSync(join(out, 'checksums.sha256'), 'utf8');
    expect(checksums).toContain('windows-x86_64/LM Profile Switcher_9.9.9_x64-setup.exe');
    expect(checksums).toContain('release-manifest.json');
    expect(checksums).toContain(`${sha256Hex(join(out, 'LICENSE'))}  LICENSE`);
    rmSync(base, { recursive: true, force: true });
  });

  it('refuses an existing staging dir unless --force is given', () => {
    const { base, out } = fixture();
    const first = runPack(['--version', '9.9.9', '--allowlist', join(base, 'allowlist.json'), '--staging', out]);
    expect(first.status).toBe(0);
    const second = runPack(['--version', '9.9.9', '--allowlist', join(base, 'allowlist.json'), '--staging', out]);
    expect(second.status).toBe(1);
    expect(second.stderr).toContain('--force');
    rmSync(base, { recursive: true, force: true });
  });

  it('--force rebuilds cleanly and the checksums match re-hashed output', () => {
    const { base, out } = fixture();
    const first = runPack(['--version', '9.9.9', '--allowlist', join(base, 'allowlist.json'), '--staging', out]);
    expect(first.status).toBe(0);
    const rebuilt = runPack(['--version', '9.9.9', '--allowlist', join(base, 'allowlist.json'), '--staging', out, '--force']);
    expect(rebuilt.status).toBe(0);
    const checksums = readFileSync(join(out, 'checksums.sha256'), 'utf8');
    for (const line of checksums.trim().split('\n')) {
      const [expected, rel] = line.split('  ');
      expect(sha256Hex(join(out, rel))).toBe(expected);
    }
    rmSync(base, { recursive: true, force: true });
  });

  it('fails when an allowlist source glob matches nothing', () => {
    const { base, out } = fixture();
    writeFileSync(
      join(base, 'allowlist.json'),
      JSON.stringify({
        schemaVersion: 1,
        product: 'LM Profile Switcher Test',
        allowlistVersion: 1,
        base: join(base, 'src'),
        artifacts: [{ role: 'windows-installer-nsis', source: 'nsis/missing-*.exe', dest: 'windows-x86_64/' }],
        documents: [],
        targetMatrix: {},
      }),
    );
    const res = runPack(['--version', '9.9.9', '--allowlist', join(base, 'allowlist.json'), '--staging', out]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('glob matched nothing');
    rmSync(base, { recursive: true, force: true });
  });
});