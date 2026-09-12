// M6-003: node-env seam tests. `createNodeLmStudioEnv` is the only module in
// the adapter package that imports `node:`; these tests exercise the REAL
// implementation against a real spawned `lms`-style fixture script and an
// injected fetch, covering process exit/stderr, spawn ENOENT, kill-on-timeout,
// HTTP status/headers, transport errors, internal timeouts and external
// cancellation. The fixture scripts are written to a scratch dir at runtime;
// no real LM Studio token or executable is involved.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createNodeLmStudioEnv, LmStudioError } from '@lmps/lmstudio-adapter';

/** Fixture that exits with argv[2] (default 0) and writes argv[3] to stderr. */
const ECHO_FIXTURE = `process.stderr.write(process.argv[3] ?? '');\nprocess.exit(Number(process.argv[2] ?? '0'));`;
const HANG_FIXTURE = `setInterval(() => {}, 1 << 30);`;

let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'lmps-node-env-'));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function fixtureScript(name: string, source: string): string {
  const path = join(scratch, name);
  writeFileSync(path, source);
  return path;
}

/**
 * Windows cannot exec a bare `.mjs` (spawn EFTYPE), so the "lms executable" is
 * the real `node` binary and the fixture path is its first argument — the same
 * shape as any CLI subprocess the adapter would spawn.
 */
function fixtureArgs(fixture: string, rest: string[]): string[] {
  return [fixture, ...rest];
}

/** Injected fetch: rejects when the request signal aborts (a real client would). */
function abortableFetch(): typeof globalThis.fetch {
  return async (_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }) as Promise<Response>;
}

describe('runLms process seam (node-env, M6-003)', () => {
  it('captures stdout/stderr and the exit code', async () => {
    const fixture = fixtureScript('echo.mjs', ECHO_FIXTURE);
    const env = createNodeLmStudioEnv({ lmsBin: process.execPath });
    const result = await env.runLms(fixtureArgs(fixture, ['7', 'boom']));
    expect(result.exitCode).toBe(7);
    expect(result.stderr).toContain('boom');
    expect(result.timedOut).toBe(false);
  });

  it('classifies a missing executable as exit 127 with a spawn diagnostic', async () => {
    const env = createNodeLmStudioEnv({ lmsBin: join(scratch, 'does-not-exist-lms') });
    const result = await env.runLms([]);
    expect(result.exitCode).toBe(127);
    expect(result.stderr).toContain('spawn failed');
    expect(result.timedOut).toBe(false);
  });

  it('kills the child on timeout and still settles with exit 124', async () => {
    const fixture = fixtureScript('hang.mjs', HANG_FIXTURE);
    const env = createNodeLmStudioEnv({ lmsBin: process.execPath, cliTimeoutMs: 300 });
    const started = Date.now();
    const result = await env.runLms(fixtureArgs(fixture, []));
    expect(result.exitCode).toBe(124);
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 15_000);

  it('leaves the timeout disabled when cliTimeoutMs is 0', async () => {
    const fixture = fixtureScript('echo0.mjs', ECHO_FIXTURE);
    const env = createNodeLmStudioEnv({ lmsBin: process.execPath, cliTimeoutMs: 0 });
    const result = await env.runLms(fixtureArgs(fixture, ['0']));
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });
});

describe('http seam (node-env, M6-003)', () => {
  it('returns status/ok and forwards headers (auth) to the transport', async () => {
    let seenInit: RequestInit | undefined;
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      seenInit = init;
      return new Response('{"ok":true}', { status: 200 });
    };
    const env = createNodeLmStudioEnv({ fetch: fetchImpl as typeof globalThis.fetch });
    const response = await env.http('http://127.0.0.1:1234/api/v1/models', {
      headers: { authorization: 'Bearer tok' },
    });
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    expect((seenInit?.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(await response.text()).toContain('ok');
  });

  it('reports non-2xx status as ok:false without throwing', async () => {
    const fetchImpl = async () => new Response('{"error":"denied"}', { status: 401 });
    const env = createNodeLmStudioEnv({ fetch: fetchImpl as typeof globalThis.fetch });
    const response = await env.http('http://127.0.0.1:1234/api/v1/models');
    expect(response.ok).toBe(false);
    expect(response.status).toBe(401);
  });

  it('classifies an internal timeout as LmStudioError(kind=timeout) and settles', async () => {
    const env = createNodeLmStudioEnv({ fetch: abortableFetch() as typeof globalThis.fetch });
    await expect(env.http('http://127.0.0.1:1234/api/v1/models', { timeoutMs: 50 })).rejects.toMatchObject({
      kind: 'timeout',
    });
  });

  it('propagates a transport network failure as-is (not a timeout)', async () => {
    const fetchImpl = async () => {
      throw new TypeError('fetch failed');
    };
    const env = createNodeLmStudioEnv({ fetch: fetchImpl as typeof globalThis.fetch });
    await expect(env.http('http://127.0.0.1:1234/api/v1/models')).rejects.toBeInstanceOf(TypeError);
  });

  it('honors an external abort (cancellation) and the promise settles', async () => {
    const controller = new AbortController();
    const env = createNodeLmStudioEnv({ fetch: abortableFetch() as typeof globalThis.fetch });
    const pending = env.http('http://127.0.0.1:1234/api/v1/models', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(DOMException);
  });
});

describe('httpStream seam (node-env, M6-003)', () => {
  it('yields decoded SSE body chunks in order', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"a":1}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    const fetchImpl = async () => new Response(body, { status: 200 });
    const env = createNodeLmStudioEnv({ fetch: fetchImpl as typeof globalThis.fetch });
    const stream = await env.httpStream('http://127.0.0.1:1234/v1/chat', {});
    const chunks: string[] = [];
    for await (const chunk of stream.body()) chunks.push(chunk);
    expect(chunks.join('')).toContain('data: [DONE]');
  });

  it('ends the body iteration quietly when the external signal aborts', async () => {
    const controller = new AbortController();
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoder.encode('first'));
        // Stream stays open: a read after the first chunk would block.
      },
    });
    const fetchImpl = async () => new Response(body, { status: 200 });
    const env = createNodeLmStudioEnv({ fetch: fetchImpl as typeof globalThis.fetch });
    const stream = await env.httpStream('http://127.0.0.1:1234/v1/chat', { signal: controller.signal });
    const iterator = stream.body()[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.value).toBe('first');
    controller.abort();
    // The abort ends the iteration: the generator yields at most one final
    // decoder flush (possibly empty) and then completes — never a blocking read.
    const second = await iterator.next();
    const third = await iterator.next();
    expect(second.done || third.done).toBe(true);
    if (!second.done && !third.done) {
      throw new Error('body iteration did not settle after the external abort');
    }
  });

  it('classifies a header-timeout as LmStudioError(kind=timeout)', async () => {
    const env = createNodeLmStudioEnv({ fetch: abortableFetch() as typeof globalThis.fetch });
    await expect(env.httpStream('http://127.0.0.1:1234/v1/chat', { timeoutMs: 50 })).rejects.toMatchObject({
      kind: 'timeout',
    });
  });

  it('is a LmStudioError instance with subsystem rest on timeout', async () => {
    const env = createNodeLmStudioEnv({ fetch: abortableFetch() as typeof globalThis.fetch });
    const error = await env.httpStream('http://127.0.0.1:1234/v1/chat', { timeoutMs: 50 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LmStudioError);
    expect((error as LmStudioError).subsystem).toBe('rest');
    expect((error as LmStudioError).kind).toBe('timeout');
  });
});
