// M4-002 proxy plane tests. handleChatCompletions / handleListModels run over the
// REAL createAliasSeam (strict aliases.json parsing + logs/proxy.ndjson audit),
// the REAL session lock and the REAL profile store, with a recording upstream
// seam that captures the assembled request body — so model resolution, deny-by-
// default, same-session latching, generation tri-state injection and the error
// ladder are all asserted against the actual pure orchestrator. A second plane
// drives alias.activate through the REAL shared activation seam (mock adapter),
// like hook.switch in hook-plane.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionLock, type ActivationRuntime } from '@lmps/core';
import type { VirtualAliasesDocument } from '@lmps/domain';
import { clearProbeCache, createMockAdapter } from '@lmps/lmstudio-adapter';
import * as lmstudioAdapter from '@lmps/lmstudio-adapter';
import { createProfileStore, type ProfileStore } from '@lmps/profile-store';

import { createHandlers } from '../../apps/core-service/src/handlers.ts';
import { Dispatcher, type DispatchResult } from '../../apps/core-service/src/protocol.ts';
import {
  applyGenerationToBody,
  bodySessionId,
  handleChatCompletions,
  handleListModels,
  nonStreamBody,
  sessionKey,
  sseFrame,
  type ProxyActivation,
  type ProxyPorts,
  type ProxyResult,
  type ProxyUpstream,
} from '../../apps/core-service/src/proxy.ts';
import {
  createAliasSeam,
  createSidecarActivationSeam,
  type SidecarActivationSeam,
} from '../../apps/core-service/src/wiring.ts';
import { makeProfile } from '../core/fixtures.ts';
import { makeFakeEnv } from '../lmstudio-adapter/fixtures.ts';
import { FAKE_NOW, FakeFs } from '../profile-store/fixtures.ts';

const ROOT = '/app';
const PROFILE_DIR = `${ROOT}/profiles`;
const BACKUP_DIR = `${ROOT}/backups`;
const ALIASES_PATH = `${ROOT}/hooks/aliases.json`;
const PROXY_LOG = `${ROOT}/logs/proxy.ndjson`;
const ALPHA_KEY = 'alpha-qwen.gguf';
const BETA_KEY = 'beta-qwen.gguf';

/** One enabled alias: lmps://coder → profile alpha (no generation overrides). */
function makeAliases(
  overrides: Partial<Omit<VirtualAliasesDocument, 'aliases'>> & {
    aliases?: Array<Record<string, unknown>>;
  } = {},
): VirtualAliasesDocument {
  return {
    schemaVersion: 2,
    version: '2026.09.test',
    enabled: true,
    aliases: [{ id: 'code-editor', virtualModel: 'lmps://coder', profileId: 'alpha' }],
    ...overrides,
  } as VirtualAliasesDocument;
}

function seedAliases(fs: FakeFs, doc: VirtualAliasesDocument): void {
  fs.mkdirRecursive(`${ROOT}/hooks`);
  fs.writeFileUtf8(ALIASES_PATH, `${JSON.stringify(doc)}\n`);
}

function qwenProfile(id: string, modelKey: string): ReturnType<typeof makeProfile> {
  return makeProfile(id, { model: { modelKey, family: 'qwen2' } });
}

const makeStore = (fs: FakeFs): ProfileStore =>
  createProfileStore({ fs, now: () => FAKE_NOW, profileDir: PROFILE_DIR, backupDir: BACKUP_DIR });

/** Records every upstream request body (the assembled model/messages/stream JSON). */
function recordingUpstream(): { bodies: Array<Record<string, unknown>>; upstream: ProxyUpstream } {
  const bodies: Array<Record<string, unknown>> = [];
  const upstream: ProxyUpstream = {
    open: async (body) => {
      bodies.push(body);
      return (async function* () {
        yield { contentDelta: 'hello', finishReason: null, usage: null };
        yield { contentDelta: '', finishReason: 'stop', usage: { completionTokens: 5, promptTokens: 12 } };
      })();
    },
  };
  return { bodies, upstream };
}

type ActivationSeed = ProxyActivation | 'real' | null;

async function makePlane(options: {
  doc?: VirtualAliasesDocument | null;
  aliasesJson?: string;
  activation?: ActivationSeed;
  sessionTtlMs?: number;
  now?: () => string;
} = {}): Promise<{
  ports: ProxyPorts;
  fs: FakeFs;
  store: ProfileStore;
  bodies: Array<Record<string, unknown>>;
  activation: ProxyActivation | null;
  realActivation: SidecarActivationSeam | null;
}> {
  const fs = new FakeFs();
  const store = makeStore(fs);
  const alias = createAliasSeam(fs, { rootDir: ROOT });
  if (options.aliasesJson !== undefined) {
    fs.mkdirRecursive(`${ROOT}/hooks`);
    fs.writeFileUtf8(ALIASES_PATH, options.aliasesJson);
  } else if (options.doc !== null && options.doc !== undefined) {
    seedAliases(fs, options.doc);
  }
  const { bodies, upstream } = recordingUpstream();
  const now = options.now ?? (() => FAKE_NOW);
  let realActivation: SidecarActivationSeam | null = null;
  let activation: ProxyActivation | null = null;
  if (options.activation === 'real') {
    realActivation = createSidecarActivationSeam(fs, {
      lmEnv: makeFakeEnv({ baseUrl: 'http://127.0.0.1:14400', token: null }),
      selection: 'mock',
      rootDir: ROOT,
      owner: 'sidecar',
      now,
    });
    activation = {
      runtime: realActivation.runtime,
      lock: realActivation.lock,
      runner: realActivation.runner,
    };
  } else if (options.activation !== null && options.activation !== undefined && options.activation !== 'real') {
    activation = options.activation;
  }
  const ports: ProxyPorts = {
    aliases: alias,
    store,
    upstream,
    session: createSessionLock({ ttlMs: options.sessionTtlMs ?? 60_000, now }),
    activation,
    now,
  };
  return { ports, fs, store, bodies, activation, realActivation };
}

function chatBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model: 'lmps://coder',
    messages: [{ role: 'user', content: 'hello' }],
    ...overrides,
  };
}

async function collectFrames(sse: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const frame of sse) out.push(frame);
  return out;
}

function lastLogLine(fs: FakeFs): Record<string, unknown> {
  const lines = fs.readFileUtf8(PROXY_LOG).split('\n').filter((line) => line !== '');
  const last = lines[lines.length - 1];
  if (last === undefined) throw new Error('no audit rows');
  return JSON.parse(last) as Record<string, unknown>;
}

/** Every audit outcome in write order (each forwarded request emits a
 * resolution row then a forwarded row, so assertions match on presence). */
function auditOutcomes(fs: FakeFs): string[] {
  return fs
    .readFileUtf8(PROXY_LOG)
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => (JSON.parse(line) as { outcome: string }).outcome);
}

describe('proxy resolution ladder (M4-002)', () => {
  beforeEach(() => clearProbeCache());

  it('refuses malformed requests with 400 before touching anything', async () => {
    const plane = await makePlane({ doc: makeAliases() });
    for (const [body, code] of [
      [{ tools: ['x'] }, 'UNSUPPORTED_CAPABILITY'],
      [{ model: '' }, 'INVALID_REQUEST'],
      [{ model: 'lmps://coder', messages: [] }, 'INVALID_REQUEST'],
      [{ model: 'lmps://coder', messages: [{ role: 'tool', content: 'x' }] }, 'INVALID_REQUEST'],
    ] as const) {
      const res = await handleChatCompletions(plane.ports, body, null, false, new AbortController().signal);
      expect(res.status).toBe(400);
      expect('error' in res && res.error.code).toBe(code);
    }
    expect(plane.bodies).toEqual([]);
    expect(plane.fs.exists(PROXY_LOG)).toBe(false);
  });

  it('refuses unconfigured / disabled / invalid documents with 503', async () => {
    const unconfigured = await makePlane();
    const unconfiguredRes = await handleChatCompletions(unconfigured.ports, chatBody(), null, false, new AbortController().signal);
    expect(unconfiguredRes.status).toBe(503);
    expect('error' in unconfiguredRes && unconfiguredRes.error.code).toBe('PROXY_UNCONFIGURED');
    expect(lastLogLine(unconfigured.fs).outcome).toBe('unconfigured');

    const disabled = await makePlane({ doc: makeAliases({ enabled: false }) });
    const disabledRes = await handleChatCompletions(disabled.ports, chatBody(), null, false, new AbortController().signal);
    expect('error' in disabledRes && disabledRes.error.code).toBe('PROXY_DISABLED');

    // Hand-edited breakage: `enabled` missing makes the document non-conforming.
    const invalid = await makePlane({
      aliasesJson: `${JSON.stringify({ schemaVersion: 2, version: 'x', aliases: [] })}\n`,
    });
    const invalidRes = await handleChatCompletions(invalid.ports, chatBody(), null, false, new AbortController().signal);
    expect(invalidRes.status).toBe(503);
    expect('error' in invalidRes && invalidRes.error.code).toBe('ALIASES_INVALID');
  });

  it('refuses an unknown virtual model with 404 (deny-by-default) and audits denied', async () => {
    const plane = await makePlane({ doc: makeAliases() });
    const res = await handleChatCompletions(
      plane.ports,
      chatBody({ model: 'lmps://nonexistent' }),
      null,
      false,
      new AbortController().signal,
    );
    expect(res.status).toBe(404);
    expect('error' in res && res.error.code).toBe('MODEL_NOT_FOUND');
    expect(lastLogLine(plane.fs).outcome).toBe('denied');
  });

  it('refuses when the mapped profile is missing from the store with 503', async () => {
    const plane = await makePlane({ doc: makeAliases() }); // 'alpha' not created
    const res = await handleChatCompletions(plane.ports, chatBody(), null, false, new AbortController().signal);
    expect(res.status).toBe(503);
    expect('error' in res && res.error.code).toBe('PROFILE_NOT_FOUND');
    expect(lastLogLine(plane.fs).outcome).toBe('profile-missing');
  });

  it('forwards a stream request and assembles the upstream body around the profile', async () => {
    const plane = await makePlane({ doc: makeAliases() });
    plane.store.create(qwenProfile('alpha', ALPHA_KEY));
    const res = await handleChatCompletions(
      plane.ports,
      chatBody({ stream: true }),
      'sess-AAAA',
      false,
      new AbortController().signal,
    );
    expect(res.status).toBe(200);
    if (!('sse' in res)) throw new Error('expected sse result');
    const frames = await collectFrames(res.sse);
    expect(frames.length).toBe(3);
    expect(frames[0]).toContain('"delta":{"content":"hello"}');
    expect(frames[1]).toContain('"finish_reason":"stop"');
    expect(frames[2]).toBe('data: [DONE]\n\n');

    const body = plane.bodies[0];
    expect(body).toMatchObject({
      model: ALPHA_KEY,
      stream: true,
      messages: [{ role: 'user', content: 'hello' }],
    });
    // Audit row carries the masked (first 8 chars) session id and the prompt does
    // not appear; the outcome is the forward.
    const row = lastLogLine(plane.fs);
    expect(row.outcome).toBe('forwarded');
    expect(row.sessionId).toBe('sess-AAA');
    expect(row.profileId).toBe('alpha');
    expect(row.aliasId).toBe('code-editor');
    expect(plane.fs.readFileUtf8(PROXY_LOG)).not.toContain('hello');
    expect(plane.fs.readFileUtf8(PROXY_LOG)).not.toContain(ROOT);
  });

  it('aggregates a non-stream request into a chat.completion body with usage', async () => {
    const plane = await makePlane({ doc: makeAliases() });
    plane.store.create(qwenProfile('alpha', ALPHA_KEY));
    const res = await handleChatCompletions(plane.ports, chatBody(), null, false, new AbortController().signal);
    expect(res.status).toBe(200);
    if (!('body' in res)) throw new Error('expected json result');
    const completion = res.body as {
      object: string;
      choices: Array<{ message: { role: string; content: string }; finish_reason: string }>;
      usage: { completion_tokens: number; prompt_tokens: number };
    };
    expect(completion.object).toBe('chat.completion');
    expect(completion.choices[0]?.message.content).toBe('hello');
    expect(completion.choices[0]?.message.role).toBe('assistant');
    expect(completion.choices[0]?.finish_reason).toBe('stop');
    expect(completion.usage).toEqual({ completion_tokens: 5, prompt_tokens: 12 });
  });
});

describe('proxy activation policy (M4-002)', () => {
  beforeEach(() => clearProbeCache());

  it('returns 502 PROFILE_NOT_ACTIVE for an unloaded profile and never forwards', async () => {
    const runtime: ActivationRuntime = createMockAdapter({ now: () => FAKE_NOW });
    const plane = await makePlane({
      doc: makeAliases(),
      activation: {
        runtime,
        lock: { acquire: async () => true, release: async () => undefined },
        runner: {
          run: async () => {
            throw new Error('unused activation runner');
          },
        },
      },
    });
    plane.store.create(qwenProfile('alpha', ALPHA_KEY));
    const res = await handleChatCompletions(plane.ports, chatBody(), null, false, new AbortController().signal);
    expect(res.status).toBe(502);
    expect('error' in res && res.error.code).toBe('PROFILE_NOT_ACTIVE');
    expect(plane.bodies).toEqual([]);
    expect(lastLogLine(plane.fs).outcome).toBe('profile-not-active');
  });

  it('forwards when the loaded runtime already carries the effective model key', async () => {
    const runtime: ActivationRuntime = createMockAdapter({
      instances: [{ key: ALPHA_KEY, loadConfig: {} }],
      now: () => FAKE_NOW,
    });
    const plane = await makePlane({
      doc: makeAliases(),
      activation: {
        runtime,
        lock: { acquire: async () => true, release: async () => undefined },
        runner: {
          run: async () => {
            throw new Error('unused activation runner');
          },
        },
      },
    });
    plane.store.create(qwenProfile('alpha', ALPHA_KEY));
    const res = await handleChatCompletions(plane.ports, chatBody(), null, false, new AbortController().signal);
    expect(res.status).toBe(200);
    expect(plane.bodies).toEqual([expect.objectContaining({ model: ALPHA_KEY })]);
  });

  it('activate:true runs the shared activation runner and forwards after the switch', async () => {
    const plane = await makePlane({
      doc: makeAliases({ aliases: [{ id: 'code', virtualModel: 'lmps://coder', profileId: 'alpha', activate: true }] }),
      activation: 'real',
    });
    plane.store.create(qwenProfile('alpha', ALPHA_KEY));
    const res = await handleChatCompletions(plane.ports, chatBody(), null, false, new AbortController().signal);
    expect(res.status).toBe(200);
    const state = await plane.realActivation?.runtime.getActiveState();
    expect(state?.modelKey).toBe(ALPHA_KEY);
    expect(plane.bodies[0]).toMatchObject({ model: ALPHA_KEY });
    const log = plane.fs.readFileUtf8(PROXY_LOG);
    expect(log).toContain('"outcome":"activated"');
  });

  it('activate:true reports ACTIVATION_LOCK_BUSY when the shared lock is held', async () => {
    const plane = await makePlane({
      doc: makeAliases({ aliases: [{ id: 'code', virtualModel: 'lmps://coder', profileId: 'alpha', activate: true }] }),
      activation: 'real',
    });
    plane.store.create(qwenProfile('alpha', ALPHA_KEY));
    const lock = plane.realActivation?.lock;
    expect(lock).toBeDefined();
    expect(await lock?.acquire()).toBe(true);
    let res: ProxyResult;
    try {
      res = await handleChatCompletions(plane.ports, chatBody(), null, false, new AbortController().signal);
    } finally {
      await lock?.release();
    }
    expect(res.status).toBe(503);
    expect('error' in res && res.error.code).toBe('ACTIVATION_LOCK_BUSY');
    expect(plane.bodies).toEqual([]);
  });
});

describe('proxy session locking (M4-002)', () => {
  beforeEach(() => clearProbeCache());

  it('latches the first resolution for a session id and re-mapping does NOT re-resolve', async () => {
    const plane = await makePlane({ doc: makeAliases() });
    plane.store.create(qwenProfile('alpha', ALPHA_KEY));
    plane.store.create(qwenProfile('beta', BETA_KEY));

    await handleChatCompletions(plane.ports, chatBody(), 'sess-AAA', false, new AbortController().signal);
    expect(plane.bodies[0]?.model).toBe(ALPHA_KEY);

    // Re-map coder → beta; the same session still speaks to the latched profile.
    seedAliases(
      plane.fs,
      makeAliases({ aliases: [{ id: 'code', virtualModel: 'lmps://coder', profileId: 'beta' }] }),
    );
    await handleChatCompletions(plane.ports, chatBody(), 'sess-AAA', false, new AbortController().signal);
    expect(plane.bodies[1]?.model).toBe(ALPHA_KEY);
    expect(auditOutcomes(plane.fs)).toContain('latched');
  });

  it('X-Session-Release unlatches and re-resolves against the current document', async () => {
    const plane = await makePlane({ doc: makeAliases() });
    plane.store.create(qwenProfile('alpha', ALPHA_KEY));
    plane.store.create(qwenProfile('beta', BETA_KEY));
    await handleChatCompletions(plane.ports, chatBody(), 'sess-BBB', false, new AbortController().signal);
    seedAliases(
      plane.fs,
      makeAliases({ aliases: [{ id: 'code', virtualModel: 'lmps://coder', profileId: 'beta' }] }),
    );
    const res = await handleChatCompletions(plane.ports, chatBody(), 'sess-BBB', true, new AbortController().signal);
    expect(res.status).toBe(200);
    expect(plane.bodies[1]?.model).toBe(BETA_KEY);
    expect(auditOutcomes(plane.fs)).toContain('released');
  });

  it('requests without a session id re-resolve every time (config visible immediately)', async () => {
    const plane = await makePlane({ doc: makeAliases() });
    plane.store.create(qwenProfile('alpha', ALPHA_KEY));
    plane.store.create(qwenProfile('beta', BETA_KEY));
    await handleChatCompletions(plane.ports, chatBody(), null, false, new AbortController().signal);
    seedAliases(
      plane.fs,
      makeAliases({ aliases: [{ id: 'code', virtualModel: 'lmps://coder', profileId: 'beta' }] }),
    );
    await handleChatCompletions(plane.ports, chatBody(), null, false, new AbortController().signal);
    expect(plane.bodies[1]?.model).toBe(BETA_KEY);
    expect(auditOutcomes(plane.fs)).toContain('resolved');
  });

  it('document sessionLock:false disables latching even with a session id', async () => {
    const plane = await makePlane({ doc: makeAliases({ sessionLock: false }) });
    plane.store.create(qwenProfile('alpha', ALPHA_KEY));
    plane.store.create(qwenProfile('beta', BETA_KEY));
    await handleChatCompletions(plane.ports, chatBody(), 'sess-CCC', false, new AbortController().signal);
    seedAliases(
      plane.fs,
      makeAliases({ sessionLock: false, aliases: [{ id: 'code', virtualModel: 'lmps://coder', profileId: 'beta' }] }),
    );
    await handleChatCompletions(plane.ports, chatBody(), 'sess-CCC', false, new AbortController().signal);
    expect(plane.bodies[1]?.model).toBe(BETA_KEY);
    expect(auditOutcomes(plane.fs)).toContain('resolved');
  });

  it('accepts the body session_id fallback and masks it in the audit row', async () => {
    const plane = await makePlane({ doc: makeAliases() });
    plane.store.create(qwenProfile('alpha', ALPHA_KEY));
    await handleChatCompletions(plane.ports, chatBody({ session_id: 'sess-FFF-very-long' }), null, false, new AbortController().signal);
    expect(plane.bodies[0]?.model).toBe(ALPHA_KEY);
    expect(lastLogLine(plane.fs).sessionId).toBe('sess-FFF');
  });

  it('removing the alias unmaps even a latched session (deny-by-default)', async () => {
    const plane = await makePlane({ doc: makeAliases() });
    plane.store.create(qwenProfile('alpha', ALPHA_KEY));
    await handleChatCompletions(plane.ports, chatBody(), 'sess-DDD', false, new AbortController().signal);
    seedAliases(plane.fs, makeAliases({ aliases: [] }));
    const res = await handleChatCompletions(plane.ports, chatBody(), 'sess-DDD', false, new AbortController().signal);
    expect(res.status).toBe(404);
    expect(lastLogLine(plane.fs).outcome).toBe('denied');
  });
});

describe('proxy generation injection (M4-002)', () => {
  beforeEach(() => clearProbeCache());

  it('applies profile then alias overrides with the client value winning last', async () => {
    const plane = await makePlane({
      doc: makeAliases({
        aliases: [
          {
            id: 'code',
            virtualModel: 'lmps://coder',
            profileId: 'alpha',
            generation: { maxTokens: 64, seed: null, systemPrompt: 'you are concise' },
          },
        ],
      }),
    });
    plane.store.create(
      makeProfile('alpha', {
        model: { modelKey: ALPHA_KEY, family: 'qwen2' },
        generation: { temperature: 0.2, topP: 0.9, seed: 42 },
      }),
    );
    await handleChatCompletions(
      plane.ports,
      chatBody({ temperature: 0.9 }),
      null,
      false,
      new AbortController().signal,
    );
    const body = plane.bodies[0];
    // client > alias > profile, null = explicit clear, absent = upstream default.
    expect(body?.['temperature']).toBe(0.9);
    expect(body?.['top_p']).toBe(0.9);
    expect(body?.['max_tokens']).toBe(64);
    expect('seed' in (body ?? {})).toBe(false);
    const messages = body?.['messages'] as Array<{ role: string; content: string }>;
    expect(messages[0]).toEqual({ role: 'system', content: 'you are concise' });
    expect(messages[1]).toEqual({ role: 'user', content: 'hello' });
  });

  it('systemPrompt replaces the last system message when the client already sent one', async () => {
    const plane = await makePlane({
      doc: makeAliases({
        aliases: [
          { id: 'code', virtualModel: 'lmps://coder', profileId: 'alpha', generation: { systemPrompt: 'new sys' } },
        ],
      }),
    });
    plane.store.create(qwenProfile('alpha', ALPHA_KEY));
    await handleChatCompletions(
      plane.ports,
      chatBody({
        messages: [
          { role: 'system', content: 'old sys' },
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'ok' },
        ],
      }),
      null,
      false,
      new AbortController().signal,
    );
    const messages = plane.bodies[0]?.['messages'] as Array<{ role: string; content: string }>;
    expect(messages.length).toBe(3);
    expect(messages[0]).toEqual({ role: 'system', content: 'new sys' });
  });

  it('an alias modelKey overrides the upstream model field; default stream returns a JSON body', async () => {
    const plane = await makePlane({
      doc: makeAliases({
        aliases: [{ id: 'code', virtualModel: 'lmps://coder', profileId: 'alpha', modelKey: 'override-key-v2' }],
      }),
    });
    plane.store.create(qwenProfile('alpha', ALPHA_KEY));
    const res = await handleChatCompletions(plane.ports, chatBody(), null, false, new AbortController().signal);
    if ('sse' in res) throw new Error('expected json result');
    expect(plane.bodies[0]?.model).toBe('override-key-v2');
  });
});

describe('GET /v1/models + aliases.status (M4-002)', () => {
  beforeEach(() => clearProbeCache());

  it('lists the enabled aliases as OpenAI model objects', async () => {
    const plane = await makePlane({
      doc: makeAliases({
        aliases: [
          { id: 'a', virtualModel: 'lmps://coder', profileId: 'alpha' },
          { id: 'b', virtualModel: 'lmps://writer', profileId: 'beta', enabled: false },
        ],
      }),
    });
    const res = await handleListModels(plane.ports);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ id: 'lmps://coder', object: 'model', owned_by: 'lmps' }]);
  });

  it('returns an empty list when unconfigured or disabled', async () => {
    const unconfigured = await makePlane();
    expect((await handleListModels(unconfigured.ports)).body.data).toEqual([]);
    const disabled = await makePlane({ doc: makeAliases({ enabled: false }) });
    expect((await handleListModels(disabled.ports)).body.data).toEqual([]);
  });

  it('aliases.status summarizes the document through the RPC dispatcher', async () => {
    const plane = await makePlane({ doc: makeAliases() });
    plane.store.create(qwenProfile('alpha', ALPHA_KEY));
    const handlers = createHandlers({
      lmBaseUrl: undefined,
      lmToken: null,
      lmsBin: undefined,
      rootDir: ROOT,
      store: plane.store,
      alias: plane.ports.aliases,
      hook: null,
      activation: null,
      fs: plane.fs,
      now: () => FAKE_NOW,
    });
    const dispatcher = new Dispatcher(handlers);
    const res: DispatchResult = await dispatcher.dispatch(
      { jsonrpc: '2.0', id: 1, method: 'aliases.status', params: {} },
      new AbortController().signal,
    );
    expect(res.error).toBeUndefined();
    expect(res.result).toEqual({
      configured: true,
      enabled: true,
      version: '2026.09.test',
      sessionLock: true,
      sessionTtlMs: 1800000,
      aliasCount: 1,
      aliases: [{ id: 'code-editor', virtualModel: 'lmps://coder', profileId: 'alpha', enabled: true, activate: false }],
    });
  });

  it('aliases.status reports METHOD_UNSUPPORTED without the seam and ALIASES_INVALID on a broken doc', async () => {
    const plane = await makePlane({ doc: makeAliases() });
    const unsupported = createHandlers({
      lmBaseUrl: undefined,
      lmToken: null,
      lmsBin: undefined,
      rootDir: ROOT,
      alias: null,
      hook: null,
      activation: null,
      fs: plane.fs,
      now: () => FAKE_NOW,
    });
    const broken = createHandlers({
      lmBaseUrl: undefined,
      lmToken: null,
      lmsBin: undefined,
      rootDir: ROOT,
      store: plane.store,
      alias: plane.ports.aliases,
      hook: null,
      activation: null,
      fs: plane.fs,
      now: () => FAKE_NOW,
    });
    plane.fs.mkdirRecursive(`${ROOT}/hooks`);
    plane.fs.writeFileUtf8(`${ROOT}/hooks/aliases.json`, `${JSON.stringify({ schemaVersion: 2, version: 'x' })}\n`);
    const unsupportedRes = await new Dispatcher(unsupported).dispatch(
      { jsonrpc: '2.0', id: 1, method: 'aliases.status', params: {} },
      new AbortController().signal,
    );
    expect(unsupportedRes.error?.code).toBe('METHOD_UNSUPPORTED');
    const brokenRes = await new Dispatcher(broken).dispatch(
      { jsonrpc: '2.0', id: 1, method: 'aliases.status', params: {} },
      new AbortController().signal,
    );
    expect(brokenRes.error?.code).toBe('ALIASES_INVALID');
  });
});

describe('proxy pure helpers (M4-002)', () => {
  it('bodySessionId prefers nothing when absent', () => {
    expect(bodySessionId({})).toBeNull();
    expect(bodySessionId({ session_id: 'sess-X' })).toBe('sess-X');
  });

  it('sessionKey namespaces by virtual model and session id', () => {
    expect(sessionKey('lmps://coder', 'sess-X')).toBe('lmps://coder::sess-X');
  });

  it('applyGenerationToBody: value sets, null clears, absent passes through', () => {
    const body: Record<string, unknown> = { temperature: 0.5, seed: 1 };
    applyGenerationToBody(body, { temperature: undefined, seed: null, maxTokens: 8 });
    expect(body).toEqual({ temperature: 0.5, max_tokens: 8 });
  });

  it('sseFrame and nonStreamBody match the OpenAI shapes', () => {
    const created = 1_700_000_000;
    const frame = sseFrame({ contentDelta: 'it', finishReason: null, usage: null }, 'lmps://coder', created, 0, 'id-1');
    const parsed = JSON.parse(frame.slice('data: '.length, -2)) as { choices: Array<{ delta: { content: string } }> };
    expect(parsed.choices[0]?.delta.content).toBe('it');

    const body = nonStreamBody(
      [
        { contentDelta: 'a', finishReason: null, usage: null },
        { contentDelta: 'b', finishReason: 'stop', usage: null },
      ],
      'lmps://coder',
      created,
      'id-2',
    ) as { choices: Array<{ message: { content: string } }>; usage?: unknown };
    expect(body.choices[0]?.message.content).toBe('ab');
    expect(body.usage).toBeUndefined();
  });
});

describe('mock adapter path (LMPS_ADAPTER=mock)', () => {
  it('activation preflight resolves WITHOUT probing the host (regression: first-use probe blocked real loopback smoke)', async () => {
    const spy = vi.spyOn(lmstudioAdapter, 'probeCapabilities');
    try {
      const plane = await makePlane({ activation: 'real' });
      const state = await plane.activation!.runtime.getActiveState();
      expect(state).toBeDefined();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});