// policy-scan:fixture — asserts the Authorization header equals 'Bearer super-secret-token'; exemption in scripts/lib/policy-scan-exemptions.json
// M2-003 streaming chat seam: SSE framing (chunk-boundary splitting, `data:`
// stripping, `[DONE]`, tail flush), per-data-line chunk parsing, the
// `restChatCompletionStream` request contract and failure classification, and
// the REST benchmark runtime's client-side timing (TTFT / generated tokens with
// usage preference / total). All feeds are scripted — no sockets.
import { describe, expect, it } from 'vitest';
import {
  createMockBenchmarkRuntime,
  createMockChatUpstream,
  createRestBenchmarkRuntime,
  parseChatData,
  parseSseChatStream,
  restChatCompletionStream,
  restOpenAiChatStream,
  type LmRequestInit,
  type LmStreamResponse,
  type LmStudioEnv,
} from '@lmps/lmstudio-adapter';

import { liveHostModel } from './fixtures.js';

const BASE = 'http://127.0.0.1:1234';

async function collect(stream: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

function sseBody(blocks: string[]): LmStreamResponse {
  return { ok: true, status: 200, body: () => blocks };
}

describe('parseSseChatStream', () => {
  it('splits chunks at line boundaries and strips the data: prefix', async () => {
    const blocks = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\ndata: {"choices":[{"delta',
      '":{"content":"lo"}}]}\ndata: [DONE]\n',
    ];
    const chunks = await collect(parseSseChatStream(blocks));
    expect(chunks.map((c) => (c as { contentDelta: string }).contentDelta)).toEqual(['Hel', 'lo']);
  });

  it('ignores blank lines and SSE comment lines', async () => {
    const blocks = [': ping\n\ndata: {"choices":[{"delta":{"content":"ok"}}]}\n\n'];
    const chunks = await collect(parseSseChatStream(blocks));
    expect(chunks.length).toBe(1);
    expect((chunks[0] as { contentDelta: string }).contentDelta).toBe('ok');
  });

  it('flushes a tail data line without a trailing newline', async () => {
    const chunks = await collect(parseSseChatStream(['data: {"choices":[{"delta":{"content":"tail"}}]}']));
    expect(chunks.map((c) => (c as { contentDelta: string }).contentDelta)).toEqual(['tail']);
  });

  it('terminates on [DONE] before any trailing event', async () => {
    const chunks = await collect(
      parseSseChatStream([
        'data: {"choices":[{"delta":{"content":"a"}}]}\ndata: [DONE]\ndata: {"choices":[{"delta":{"content":"b"}}]}\n',
      ]),
    );
    expect(chunks.map((c) => (c as { contentDelta: string }).contentDelta)).toEqual(['a']);
  });

  it('strips the trailing carriage return from CRLF lines', async () => {
    const chunks = await collect(parseSseChatStream(['data: {"choices":[{"delta":{"content":"x"}}]}\r\n']));
    expect(chunks.map((c) => (c as { contentDelta: string }).contentDelta)).toEqual(['x']);
  });
});

describe('parseChatData', () => {
  it('parses content, finish_reason and usage from one data line', () => {
    const chunk = parseChatData(
      '{"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}],"usage":{"completion_tokens":2,"prompt_tokens":8}}',
    );
    expect(chunk).toEqual({ contentDelta: 'hi', finishReason: 'stop', usage: { completionTokens: 2, promptTokens: 8 } });
  });

  it('returns null for empty deltas', () => {
    expect(parseChatData('{"choices":[{"delta":{}}]}')).toBeNull();
    expect(parseChatData('not json')).toBeNull();
    expect(parseChatData('{"choices":[]}')).toBeNull();
  });

  it('counts reasoning_content as generated output (live host: qwen3.5 streams thinking in reasoning_content)', () => {
    const thinking = parseChatData('{"choices":[{"delta":{"reasoning_content":"Think step by step"},"finish_reason":null}]}');
    expect(thinking?.contentDelta).toBe('Think step by step');
    const visible = parseChatData('{"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}');
    expect(visible?.contentDelta).toBe('ok');
    // A mixed chunk (reasoning then visible content) appends both in stream order.
    const mixed = parseChatData('{"choices":[{"delta":{"reasoning_content":"hmm ","content":"ok"},"finish_reason":null}]}');
    expect(mixed?.contentDelta).toBe('hmm ok');
  });

  it('returns null when only reasoning arrives with no finish or usage', () => {
    // A delta carrying only reasoning still yields a chunk (it is generated
    // output); only a truly empty delta plus no terminator is null.
    expect(parseChatData('{"choices":[{"delta":{"reasoning_content":""},"finish_reason":null}]}')).toBeNull();
  });
});

describe('restChatCompletionStream', () => {
  it('posts a streaming chat completion and yields parsed chunks', async () => {
    const requests: Array<{ thenUrl: string; init: LmRequestInit }> = [];
    const env = makeStreamEnv({
      open: async (url, init) => {
        requests.push({ thenUrl: url, init });
        return sseBody(['data: {"choices":[{"delta":{"content":"h"}}]}\ndata: [DONE]\n']);
      },
    });
    const stream = await restChatCompletionStream(env, { modelKey: 'm', prompt: 'hi', maxTokens: 8 });
    const chunks = await collect(stream);
    expect(chunks.map((c) => (c as { contentDelta: string }).contentDelta)).toEqual(['h']);
    expect(requests[0]?.thenUrl).toBe(`${BASE}/api/v0/chat/completions`);
    const body = JSON.parse(requests[0]?.init.body ?? '{}') as Record<string, unknown>;
    expect(body).toEqual({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
      max_tokens: 8,
    });
    expect(requests[0]?.init.headers?.['content-type']).toContain('application/json');
  });

  it('asserts the bearer token only on the wire', async () => {
    const requestHeaders: Record<string, unknown>[] = [];
    const env = makeStreamEnv({
      token: 'super-secret-token',
      open: async (_url, init) => {
        requestHeaders.push(init.headers ?? {});
        return sseBody(['data: [DONE]\n']);
      },
    });
    const stream = await restChatCompletionStream(env, { modelKey: 'm', prompt: 'hi', maxTokens: 8 });
    await collect(stream);
    expect(requestHeaders[0]?.['Authorization']).toBe('Bearer super-secret-token');
  });

  it('reports unsupported when the streaming seam is absent', async () => {
    const env: LmStudioEnv = {
      baseUrl: BASE,
      token: null,
      lmsBin: 'lms',
      now: () => '2026-09-05T00:00:00.000Z',
      nowMs: () => 0,
      http: async () => ({ ok: true, status: 200, text: async () => '{}' }),
      runLms: async () => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false }),
    };
    await expect(
      restChatCompletionStream(env, { modelKey: 'm', prompt: 'hi', maxTokens: 8 }),
    ).rejects.toMatchObject({ kind: 'unsupported' });
  });

  it('classifies a transport failure as unreachable', async () => {
    const env = makeStreamEnv({
      open: async () => {
        throw Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' });
      },
    });
    await expect(restChatCompletionStream(env, { modelKey: 'm', prompt: 'hi', maxTokens: 8 })).rejects.toMatchObject({
      kind: 'unreachable',
    });
  });

  it('classifies an auth HTTP failure through the standard kinds', async () => {
    const env = makeStreamEnv({
      open: async () => ({ ok: false, status: 401, body: () => [''] }),
    });
    await expect(restChatCompletionStream(env, { modelKey: 'm', prompt: 'hi', maxTokens: 8 })).rejects.toMatchObject({
      kind: 'auth',
    });
  });
});

describe('restOpenAiChatStream', () => {
  it('posts an arbitrary body to the chat completions path and parses the stream', async () => {
    const requests: Array<{ thenUrl: string; init: LmRequestInit }> = [];
    const env = makeStreamEnv({
      open: async (url, init) => {
        requests.push({ thenUrl: url, init });
        return sseBody(['data: {"choices":[{"delta":{"content":"ok"}}]}\ndata: [DONE]\n']);
      },
    });
    const stream = await restOpenAiChatStream(env, {
      model: 'qwen2.5-7b',
      messages: [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'hi' },
      ],
      stream: true,
      temperature: 0.2,
      max_tokens: 64,
    });
    const chunks = await collect(stream);
    expect(chunks.map((c) => (c as { contentDelta: string }).contentDelta)).toEqual(['ok']);
    expect(requests[0]?.thenUrl).toBe(`${BASE}/api/v0/chat/completions`);
    expect(JSON.parse(requests[0]?.init.body ?? '{}')).toEqual({
      model: 'qwen2.5-7b',
      messages: [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'hi' },
      ],
      stream: true,
      temperature: 0.2,
      max_tokens: 64,
    });
    expect(requests[0]?.init.headers?.['content-type']).toContain('application/json');
  });

  it('classifies a transport failure as unreachable and an auth failure as auth', async () => {
    const env = makeStreamEnv({
      open: async () => {
        throw Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' });
      },
    });
    await expect(restOpenAiChatStream(env, {})).rejects.toMatchObject({ kind: 'unreachable' });
    const authEnv = makeStreamEnv({
      open: async () => ({ ok: false, status: 403, body: () => [''] }),
    });
    await expect(restOpenAiChatStream(authEnv, {})).rejects.toMatchObject({ kind: 'auth' });
  });

  it('restChatCompletionStream merges options.body without changing the golden shape', async () => {
    const requests: Array<{ init: LmRequestInit }> = [];
    const env = makeStreamEnv({
      open: async (_url, init) => {
        requests.push({ init });
        return sseBody(['data: [DONE]\n']);
      },
    });
    const stream = await restChatCompletionStream(
      env,
      { modelKey: 'm', prompt: 'hi', maxTokens: 8 },
      { body: { temperature: 0.7 } },
    );
    await collect(stream);
    expect(JSON.parse(requests[0]?.init.body ?? '{}')).toEqual({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
      max_tokens: 8,
      temperature: 0.7,
    });
  });
});

describe('createMockChatUpstream', () => {
  it('yields scripted chunks and a terminal finish reason', async () => {
    const upstream = createMockChatUpstream({
      scripts: [{ deltas: ['hello', ' world'], finishReason: 'stop' }],
    });
    const chunks = await collect(await upstream.open({ model: 'anything' }));
    expect(chunks).toEqual([
      { contentDelta: 'hello', finishReason: null, usage: null },
      { contentDelta: ' world', finishReason: null, usage: null },
      { contentDelta: '', finishReason: 'stop', usage: null },
    ]);
  });

  it('emits a usage carrying terminal chunk when configured', async () => {
    const upstream = createMockChatUpstream({
      scripts: [{ deltas: ['a'], finishReason: 'stop', usage: { completionTokens: 1, promptTokens: 3 } }],
    });
    const chunks = await collect(await upstream.open({}));
    expect(chunks.at(-1)).toEqual({ contentDelta: '', finishReason: 'stop', usage: { completionTokens: 1, promptTokens: 3 } });
  });

  it('injects the open fault and stops on abort', async () => {
    const openFault = Object.assign(new Error('upstream down'), { kind: 'unreachable' });
    const upstream = createMockChatUpstream({ faults: { open: openFault } });
    await expect(upstream.open({})).rejects.toBe(openFault);

    const aborted = createMockChatUpstream({ scripts: [{ deltas: ['a'] }] });
    const controller = new AbortController();
    controller.abort();
    const chunks = await collect(await aborted.open({}, controller.signal));
    expect(chunks).toEqual([]);
  });
});

describe('createRestBenchmarkRuntime', () => {
  it('measures TTFT on the first delta and prefers usage completion_tokens', async () => {
    let now = 0;
    const env = makeStreamEnv({
      nowMs: () => now,
      http: async () => ({ ok: true, status: 200, text: async () => '{}' }),
      open: async () =>
        sseBody([
          'data: {"choices":[{"delta":{"content":"hel"}}]}\n',
          'data: {"choices":[{"delta":{"content":"lo"}}]}\ndata: [DONE]\n',
        ]),
    });
    const setNow = (ms: number): void => {
      now = ms;
    };
    setNow(0);
    const runtime = createRestBenchmarkRuntime(env);
    const profile = testProfile();
    await runtime.load(profile);
    now = 0;
    const sample = await runtime.measure(profile, { prompt: 'Say hi.', maxTokens: 8 });
    expect(sample.ttftMs).toBe(0);
    expect(sample.generatedTokens).toBe(2); // usage absent → delta count
    expect(sample.finishReason).toBeNull();
  });

  it('measures a reasoning-model stream (reasoning_content only) as real output', async () => {
    let now = 0;
    const env = makeStreamEnv({
      nowMs: () => now,
      http: async () => ({ ok: true, status: 200, text: async () => '{}' }),
      open: async () =>
        sseBody([
          'data: {"choices":[{"delta":{"reasoning_content":"Think"}}]}\n',
          'data: {"choices":[{"delta":{"reasoning_content":"ing"},"finish_reason":null}]}\n',
          'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n',
          'data: [DONE]\n',
        ]),
    });
    const setNow = (ms: number): void => {
      now = ms;
    };
    const runtime = createRestBenchmarkRuntime(env);
    const profile = testProfile();
    await runtime.load(profile);
    setNow(0);
    const sample = await runtime.measure(profile, { prompt: 'Say hi.', maxTokens: 8 });
    // Reasoning deltas count as generated output, so TTFT is the first
    // reasoning token and the delta count includes both phases (usage absent).
    expect(sample.ttftMs).toBe(0);
    expect(sample.generatedTokens).toBe(3);
    expect(sample.finishReason).toBe('stop');
  });

  it('prefers usage.completion_tokens over the delta count', async () => {
    const env = makeStreamEnv({
      open: async () =>
        sseBody([
          'data: {"choices":[{"delta":{"content":"a"}}]}\n',
          'data: {"choices":[{"delta":{"content":"b"}}],"usage":{"completion_tokens":17,"prompt_tokens":8}}\n',
          'data: [DONE]\n',
        ]),
    });
    const runtime = createRestBenchmarkRuntime(env);
    const sample = await runtime.measure(testProfile(), { prompt: 'Say hi.', maxTokens: 8 });
    expect(sample.generatedTokens).toBe(17);
    expect(sample.totalMs).toBe(0);
  });

  it('reports the load wall-clock from the injected clock', async () => {
    // Scripted clock advances 150ms between the two reads inside one load call.
    let now = 0;
    const env = makeStreamEnv({
      nowMs: () => {
        const value = now;
        now += 150;
        return value;
      },
      http: async () => ({ ok: true, status: 200, text: async () => '{}' }),
    });
    const runtime = createRestBenchmarkRuntime(env);
    const loaded = await runtime.load(testProfile());
    expect(loaded.loadMs).toBe(150);
  });

  it('restore unloads only the instances this run created, never a pre-existing activation', async () => {
    // Scenario (live host 2026-09-07): an activation already left
    // `qwen/qwen3.5-9b` loaded (instance :1); the benchmark reloads the same
    // model with a different context and the host spawns `:2`. Restore must
    // evict `:2` and must NOT evict the pre-existing `:1`.
    const unloadBodies: string[] = [];
    const listBodies: string[] = [
      // pre-load snapshot: only the activation instance
      JSON.stringify({ models: [liveHostModel('qwen/qwen3.5-9b', true, ['qwen/qwen3.5-9b'])] }),
      // list after load: activation + benchmark-created instance
      JSON.stringify({ models: [liveHostModel('qwen/qwen3.5-9b', true, ['qwen/qwen3.5-9b', 'qwen/qwen3.5-9b:2'])] }),
    ];
    let listCalls = 0;
    const env = makeStreamEnv({
      http: async (url, init) => {
        // The adapter builds absolute URLs; handlers match the bare path.
        const path = url.replace(BASE, '');
        if (path === '/api/v1/models') {
          const body = listBodies[listCalls] ?? listBodies[listBodies.length - 1]!;
          listCalls += 1;
          return { ok: true, status: 200, text: async () => body };
        }
        if (path === '/api/v1/models/load') {
          return { ok: true, status: 200, text: async () => JSON.stringify({ instance_id: 'qwen/qwen3.5-9b:2' }) };
        }
        if (path === '/api/v1/models/unload') {
          unloadBodies.push(init?.body ?? '');
          return { ok: true, status: 200, text: async () => JSON.stringify({ success: true }) };
        }
        return { ok: true, status: 404, text: async () => '{}' };
      },
    });
    const runtime = createRestBenchmarkRuntime(env);
    await runtime.load(testProfile());
    await runtime.restore();
    expect(unloadBodies).toHaveLength(1);
    // The unload body carries the created instance id (`instance_id`), leaving :1 intact.
    expect(JSON.parse(unloadBodies[0] ?? '{}')).toEqual({ instance_id: 'qwen/qwen3.5-9b:2' });
  });

  it('restore is a no-op when the model was already loaded with the identical instance', async () => {
    const unloadBodies: string[] = [];
    const listBody = JSON.stringify({
      models: [liveHostModel('qwen/qwen3.5-9b', true, ['qwen/qwen3.5-9b'])],
    });
    const env = makeStreamEnv({
      http: async (url, init) => {
        const path = url.replace(BASE, '');
        if (path === '/api/v1/models') return { ok: true, status: 200, text: async () => listBody };
        if (path === '/api/v1/models/load') {
          // Host reports the instance already existed and was not recreated.
          return { ok: true, status: 200, text: async () => JSON.stringify({ instance_id: 'qwen/qwen3.5-9b' }) };
        }
        if (path === '/api/v1/models/unload') {
          unloadBodies.push(init?.body ?? '');
          return { ok: true, status: 200, text: async () => JSON.stringify({ success: true }) };
        }
        return { ok: true, status: 404, text: async () => '{}' };
      },
    });
    const runtime = createRestBenchmarkRuntime(env);
    await runtime.load(testProfile());
    await runtime.restore();
    expect(unloadBodies).toHaveLength(0);
  });
});

describe('createMockBenchmarkRuntime', () => {
  it('yields scripted TTFT, generated tokens and total on an injected clock', async () => {
    let now = 0;
    const runtime = createMockBenchmarkRuntime({
      scripts: [{ deltas: ['hello', ' ', 'world'], gapMs: 0 }],
      loadMs: 700,
      nowMs: () => now,
    });
    const profile = testProfile();
    const loaded = await runtime.load(profile);
    expect(loaded.loadMs).toBe(700);
    now = 0;
    const sample = await runtime.measure(profile, { prompt: 'Say hi.', maxTokens: 8 });
    expect(sample.ttftMs).toBe(0);
    expect(sample.generatedTokens).toBe(3);
    expect(sample.totalMs).toBe(0);
    expect(sample.finishReason).toBe('stop');
  });

  it('rotates per-sample scripts and honors usage completion counts', async () => {
    const runtime = createMockBenchmarkRuntime({
      scripts: [
        { deltas: ['a'], usage: { completionTokens: 5 } },
        { deltas: ['b', 'c'] },
      ],
      nowMs: () => 0,
    });
    const profile = testProfile();
    const first = await runtime.measure(profile, { prompt: 'p', maxTokens: 8 });
    const second = await runtime.measure(profile, { prompt: 'p', maxTokens: 8 });
    const third = await runtime.measure(profile, { prompt: 'p', maxTokens: 8 }); // wraps
    expect(first.generatedTokens).toBe(5);
    expect(second.generatedTokens).toBe(2);
    expect(third.generatedTokens).toBe(5);
  });

  it('injects load and measure faults', async () => {
    const loadFault = Object.assign(new Error('OOM during load'), { kind: 'oom' });
    const runtime = createMockBenchmarkRuntime({
      faults: { load: loadFault, measure: Object.assign(new Error('boom'), { kind: 'crash' }) },
    });
    await expect(runtime.load(testProfile())).rejects.toBe(loadFault);
    await expect(runtime.measure(testProfile(), { prompt: 'p', maxTokens: 8 })).rejects.toMatchObject({
      kind: 'crash',
    });
  });
});

function testProfile(): {
  schemaVersion: number;
  model: { modelKey: string };
  task: { type: string };
  behavior: { identifier: string | null };
  runtime: { contextLength: number; gpuOffload: 'auto' | 'max' | 'off' | number | null };
} {
  return {
    schemaVersion: 2,
    model: { modelKey: 'synthetic/test-model' },
    task: { type: 'quick-chat' },
    // profileToRestLoadParams requires the behavior/runtime sections even when
    // only the model key is exercised by the benchmark runtime's measure path.
    behavior: { identifier: null },
    runtime: { contextLength: 8192, gpuOffload: 'max' },
  };
}

interface StreamEnvOptions {
  token?: string | null;
  open?: (url: string, init: LmRequestInit) => Promise<LmStreamResponse>;
  http?: (url: string, init: LmRequestInit) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
  nowMs?: () => number;
}

function makeStreamEnv(options: StreamEnvOptions = {}): LmStudioEnv {
  return {
    baseUrl: BASE,
    token: options.token ?? null,
    lmsBin: 'lms',
    now: () => '2026-09-05T00:00:00.000Z',
    nowMs: options.nowMs ?? (() => 0),
    async http(path, init) {
      if (options.http !== undefined) return options.http(path, init ?? {});
      return { ok: true, status: 200, text: async () => '{}' };
    },
    httpStream: options.open,
    async runLms() {
      return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
    },
  };
}