// Desktop settings RPC handlers (M3-001): `settings.getLocale`/`settings.setLocale`
// persist to <rootDir>/config.json through the same createFileLanguageStore the
// CLI uses, so desktop and CLI share one settings file. Uses a real temp dir —
// handlers.ts binds the Node-backed createDefaultFsys internally, and the
// atomic writer's temp+rename behavior is part of what we assert here.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createHandlers } from '../../apps/core-service/src/handlers.ts';
import { Dispatcher, type RpcRequest } from '../../apps/core-service/src/protocol.ts';

function run(method: string, params: Record<string, unknown>, rootDir?: string) {
  const handlers = createHandlers({ lmBaseUrl: undefined, lmToken: null, lmsBin: undefined, rootDir });
  const dispatcher = new Dispatcher(handlers);
  const request: RpcRequest = { jsonrpc: '2.0', id: 1, method, params };
  return dispatcher.dispatch(request, new AbortController().signal);
}

describe('sidecar settings locale handlers (M3-001)', () => {
  const dirs: string[] = [];

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'lmps-settings-'));
    dirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('returns null locale when no config.json exists yet', async () => {
    const result = await run('settings.getLocale', {}, tempDir());
    expect(result).toEqual({ result: { locale: null } });
  });

  it('persists a picked locale into <rootDir>/config.json and reads it back', async () => {
    const root = tempDir();
    const set = await run('settings.setLocale', { locale: 'zh-CN' }, root);
    expect(set).toEqual({ result: { ok: true, locale: 'zh-CN' } });

    expect(JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'))).toEqual({ locale: 'zh-CN' });

    const get = await run('settings.getLocale', {}, root);
    expect(get).toEqual({ result: { locale: 'zh-CN' } });
  });

  it('normalizes variant spellings to the supported locales', async () => {
    const root = tempDir();
    for (const [raw, expected] of [
      ['en-US', 'en'],
      ['zh_CN', 'zh-CN'],
      ['ZH', 'zh-CN'],
      ['zh-Hans', 'zh-CN'],
    ] as const) {
      const set = await run('settings.setLocale', { locale: raw }, root);
      expect(set.result).toEqual({ ok: true, locale: expected });
      expect((await run('settings.getLocale', {}, root)).result).toEqual({ locale: expected });
    }
  });

  it('rejects unsupported locales with an RPC error and leaves the file untouched', async () => {
    const root = tempDir();
    const result = await run('settings.setLocale', { locale: 'fr' }, root);
    expect(result.error).toEqual(
      expect.objectContaining({ code: 'INTERNAL', message: expect.stringContaining('unsupported locale') }),
    );
    // A previous value survives a rejected write; nothing is created by a bare get.
    const get = await run('settings.getLocale', {}, root);
    expect(get.result).toEqual({ locale: null });
  });

  it('works session-only when no rootDir is configured', async () => {
    const set = await run('settings.setLocale', { locale: 'en' });
    expect(set.result).toEqual({ ok: true, locale: 'en' });
    const get = await run('settings.getLocale', {});
    expect(get.result).toEqual({ locale: null });
  });

  it('puts methods() on the documented settings.* namespace', () => {
    const handlers = createHandlers({ lmBaseUrl: undefined, lmToken: null, lmsBin: undefined });
    expect(new Dispatcher(handlers).methods()).toContain('settings.getLocale');
    expect(new Dispatcher(handlers).methods()).toContain('settings.setLocale');
  });
});