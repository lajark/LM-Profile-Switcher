// Real-filesystem regression tests (M3-002): the in-memory FakeFs used across
// the other suites auto-creates parent directories on write and tolerates
// missing directories on readdir, which masked two real-host bugs — the first
// update of a fresh profile crashed with `ENOENT: scandir backups/<id>` because
// the per-profile backup directory did not exist yet. These tests run against
// the Node-backed Fsys in a temp root so the documented Fsys contract
// ("missing directory → []", parents created on demand) is verified for real.
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDefaultProfileStore } from '@lmps/profile-store';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'lmps-real-fs-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const BASE = {
  schemaVersion: 2,
  description: { en: 'real-fs regression' },
  model: { modelKey: 'synthetic/test-model', family: 'gpt-test', quantization: 'q4_k_m' },
  task: { type: 'quick-chat', kind: 'quick-chat', typicalInputTokens: 1000 },
  runtime: { contextLength: 8192, gpuOffload: 'max' },
  generation: { temperature: 0.7 },
  behavior: { mode: 'exclusive', rollback: 'best-effort' },
  validation: { source: 'manual' },
  metadata: {
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    tags: ['regression'],
  },
} as const;

describe('createDefaultProfileStore on the real filesystem', () => {
  it('first update of a fresh profile succeeds and lays down a write-ahead backup', () => {
    const root = tempRoot();
    const store = createDefaultProfileStore(root);
    store.create({ ...BASE, id: 'alpha', displayName: { 'zh-CN': '阿尔法', en: 'Alpha' } });

    // Regression: before the fix this threw ENOENT scanning `backups/alpha`.
    expect(() => store.update('alpha', { runtime: { contextLength: 16384 } })).not.toThrow();
    expect(store.get('alpha').runtime.contextLength).toBe(16384);

    const backupDir = join(root, 'backups', 'alpha');
    expect(existsSync(backupDir)).toBe(true);
    const files = readdirSync(backupDir);
    expect(files).toHaveLength(1);
    // Deterministic timestamp filename from `backupFileNameFor`: digits + T + ms.
    expect(files[0]).toMatch(/^\d+T\d+\.json$/);
  });

  it('subsequent updates rotate history but keep the newest backup', () => {
    const root = tempRoot();
    const store = createDefaultProfileStore(root, { backupCount: 2 });
    store.create({ ...BASE, id: 'alpha', displayName: { 'zh-CN': '阿尔法', en: 'Alpha' } });
    store.update('alpha', { runtime: { contextLength: 1000 } });
    store.update('alpha', { runtime: { contextLength: 2000 } });
    store.update('alpha', { runtime: { contextLength: 3000 } });
    const files = readdirSync(join(root, 'backups', 'alpha'));
    expect(files).toHaveLength(2);
    expect(store.get('alpha').runtime.contextLength).toBe(3000);
  });

  it('createDefaultProfileStore tolerates a truly empty root dir', () => {
    expect(() => createDefaultProfileStore(tempRoot())).not.toThrow();
  });
});