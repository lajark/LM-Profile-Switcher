/**
 * OpenAI-compatible proxy orchestration (M4-002). Pure module: every orchestration
 * and wire-format decision lives here, unit-testable without sockets; the HTTP
 * transport only parses the body, relays session headers and streams the
 * pre-framed SSE lines. Resolution is deny-by-default (exact virtualModel match,
 * mirroring matchHookRule) — no semantic router, no confidence scoring anywhere.
 *
 * Request flow: parse (400) -> aliases doc (unconfigured/disabled -> 503,
 * invalid -> 503) -> exact alias match (miss -> 404) -> profile in store
 * (miss -> 503) -> same-session resolve/latch/release (opt-in, keyed by
 * virtualModel::sessionId) -> optional controlled activation (per-alias
 * `activate: true` under the shared activation.lock; else a read-only active
 * check returning 502 PROFILE_NOT_ACTIVE when the profile's model is not
 * loaded) -> upstream body = profile/alias generation overrides (client values
 * win last) -> stream ChatChunks into SSE frames (or buffer a non-stream JSON
 * body). Error messages are generic — never tokens, paths or prompt content.
 */
import { type ActivationRuntime, type ActivationRunner, isActivationError, type SessionLock } from '@lmps/core';
import { matchVirtualAlias, type AliasGeneration, type CompositeProfile, type VirtualAliasesDocument } from '@lmps/domain';
import { isLmStudioError, type ChatChunk } from '@lmps/lmstudio-adapter';
import type { ProfileStore } from '@lmps/profile-store';

import { RpcMethodError } from './protocol.js';

export interface ProxyChatRequest {
  model: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  stream: boolean;
  /** Client sampling fields that survive the curated passthrough (snake_case). */
  sampling: Partial<Record<string, number | null>>;
  user: string | null;
}

export interface ProxyError {
  code: string;
  message: string;
}

export type ProxyResult =
  | { status: 200; sse: AsyncIterable<string> }
  | { status: 200; body: Record<string, unknown> }
  | { status: number; error: ProxyError };

/** The upstream chat seam; real = restOpenAiChatStream, mock = createMockChatUpstream. */
export interface ProxyUpstream {
  open(body: Record<string, unknown>, signal?: AbortSignal): Promise<AsyncIterable<ChatChunk>>;
}

/** Minimal alias seam shape the pure orchestrator depends on (wiring provides it). */
export interface ProxyAliasSeam {
  readAliases(): VirtualAliasesDocument | null;
  audit(entry: Record<string, unknown>): void;
}

/** Minimal activation seam shape (wiring's SidecarActivationSeam satisfies it). */
export interface ProxyActivation {
  runtime: ActivationRuntime;
  lock: { acquire(): Promise<boolean>; release(): Promise<void> };
  runner: ActivationRunner;
}

export interface ProxyPorts {
  aliases: ProxyAliasSeam;
  store: ProfileStore;
  upstream: ProxyUpstream;
  session: SessionLock;
  activation: ProxyActivation | null;
  now(): string;
}

/** Every injectable generation field mapped to its OpenAI wire key. */
const INJECTION_FIELDS: ReadonlyArray<[keyof AliasGeneration, string]> = [
  ['temperature', 'temperature'],
  ['topP', 'top_p'],
  ['topK', 'top_k'],
  ['minP', 'min_p'],
  ['repeatPenalty', 'repeat_penalty'],
  ['frequencyPenalty', 'frequency_penalty'],
  ['presencePenalty', 'presence_penalty'],
  ['maxTokens', 'max_tokens'],
  ['seed', 'seed'],
];

const SAMPLING_KEYS = [
  'temperature',
  'top_p',
  'top_k',
  'min_p',
  'repeat_penalty',
  'frequency_penalty',
  'presence_penalty',
  'max_tokens',
  'seed',
] as const;

const MAX_MESSAGES = 96;
const MODEL_NOT_FOUND: ProxyError = { code: 'MODEL_NOT_FOUND', message: 'no virtual model matches this request' };
const ALIASES_INVALID: ProxyError = { code: 'ALIASES_INVALID', message: 'aliases document failed validation' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function sessionKey(virtualModel: string, sessionId: string): string {
  return `${virtualModel}::${sessionId}`;
}

/** Mask an opaque client session id for audit rows (never the full value). */
function maskSessionId(sessionId: string | null): string | null {
  return sessionId === null ? null : sessionId.slice(0, 8);
}

/**
 * Parse an OpenAI chat.completions request (M4-002). Unknown fields are ignored
 * except the honest rejects: `tools`, `tool_choice` and `response_format` are
 * refused (silently dropping them would break clients that believe they are on).
 */
export function parseChatCompletionsRequest(value: unknown):
  | { ok: true; request: ProxyChatRequest }
  | { ok: false; error: ProxyError } {
  if (!isRecord(value)) return { ok: false, error: { code: 'INVALID_REQUEST', message: 'expected a JSON object body' } };
  // Honest capability rejection is checked before structural validation: a
  // client asking for tools would otherwise get an INVALID_REQUEST for the same
  // body, hiding that the capability itself is unsupported.
  for (const unsupported of ['tools', 'tool_choice', 'response_format']) {
    if (unsupported in value) {
      return { ok: false, error: { code: 'UNSUPPORTED_CAPABILITY', message: `${unsupported} is not supported` } };
    }
  }
  const model = value['model'];
  if (typeof model !== 'string' || model.trim() === '') {
    return { ok: false, error: { code: 'INVALID_REQUEST', message: 'model must be a non-empty string' } };
  }
  const rawMessages = value['messages'];
  if (!Array.isArray(rawMessages) || rawMessages.length === 0 || rawMessages.length > MAX_MESSAGES) {
    return {
      ok: false,
      error: { code: 'INVALID_REQUEST', message: `messages must be 1..${MAX_MESSAGES} items` },
    };
  }
  const messages: ProxyChatRequest['messages'] = [];
  for (const raw of rawMessages) {
    if (!isRecord(raw)) return { ok: false, error: { code: 'INVALID_REQUEST', message: 'messages entries must be objects' } };
    const role = raw['role'];
    const content = raw['content'];
    if (role !== 'user' && role !== 'assistant' && role !== 'system') {
      return { ok: false, error: { code: 'INVALID_REQUEST', message: 'messages role must be user/assistant/system' } };
    }
    if (typeof content !== 'string' || content === '') {
      return { ok: false, error: { code: 'INVALID_REQUEST', message: 'messages content must be a non-empty string' } };
    }
    messages.push({ role, content });
  }
  const sampling: ProxyChatRequest['sampling'] = {};
  for (const key of SAMPLING_KEYS) {
    if (!(key in value)) continue;
    const candidate = value[key];
    if (typeof candidate === 'number' && Number.isFinite(candidate)) sampling[key] = candidate;
    else if (candidate === null) sampling[key] = null;
  }
  const user = typeof value['user'] === 'string' ? value['user'] : null;
  return {
    ok: true,
    request: { model: model.trim(), messages, stream: value['stream'] === true, sampling, user },
  };
}

/** session_id fallback carrier (header is primary; kept for curl-style clients). */
export function bodySessionId(value: unknown): string | null {
  if (isRecord(value) && typeof value['session_id'] === 'string' && value['session_id'] !== '') {
    return value['session_id'];
  }
  return null;
}

/**
 * Apply one generation config over an upstream body with the tri-state
 * semantics: value -> override, null -> delete (explicit clear), absent ->
 * pass through untouched. `systemPrompt` replaces the last system message (or
 * prepends one); null/absent leave the message list alone.
 */
export function applyGenerationToBody(
  body: Record<string, unknown>,
  generation: Readonly<Partial<AliasGeneration>> | undefined,
): void {
  if (generation === undefined) return;
  for (const [field, wire] of INJECTION_FIELDS) {
    const value = generation[field];
    if (value === undefined) continue;
    if (value === null) delete body[wire];
    else body[wire] = value;
  }
  if (typeof generation.systemPrompt === 'string') {
    applySystemPrompt(body, generation.systemPrompt);
  }
}

function applySystemPrompt(body: Record<string, unknown>, systemPrompt: string): void {
  const messages = Array.isArray(body['messages']) ? (body['messages'] as Array<{ role: string; content: string }>) : null;
  if (messages === null) return;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message !== undefined && message.role === 'system') {
      messages[i] = { ...message, content: systemPrompt };
      return;
    }
  }
  messages.unshift({ role: 'system', content: systemPrompt });
}

/** Make an SSE text frame out of one upstream chunk. */
export function sseFrame(chunk: ChatChunk, model: string, created: number, index: number, streamId: string): string {
  const payload = {
    id: streamId,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [
      {
        index,
        delta: chunk.contentDelta === '' ? {} : { content: chunk.contentDelta },
        finish_reason: chunk.finishReason,
      },
    ],
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/** Aggregate a buffered stream into a non-stream chat.completion JSON body. */
export function nonStreamBody(chunks: ChatChunk[], model: string, created: number, streamId: string): Record<string, unknown> {
  const content = chunks.map((chunk) => chunk.contentDelta).join('');
  let lastFinish: ChatChunk | null = null;
  let lastUsage: ChatChunk | null = null;
  let hasUsage = false;
  for (const chunk of chunks) {
    if (chunk.finishReason !== null) lastFinish = chunk;
    if (chunk.usage !== null) {
      lastUsage = chunk;
      hasUsage = true;
    }
  }
  const usage = hasUsage ? lastUsage?.usage : null;
  return {
    id: streamId,
    object: 'chat.completion',
    created,
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: lastFinish?.finishReason ?? null,
      },
    ],
    ...(usage === null || usage === undefined
      ? {}
      : {
          usage: {
            completion_tokens: usage.completionTokens,
            prompt_tokens: usage.promptTokens,
          },
        }),
  };
}

function mapUpstreamError(error: unknown): ProxyError {
  if (isLmStudioError(error)) {
    switch (error.kind) {
      case 'auth':
        return { code: 'UPSTREAM_AUTH', message: 'LM Studio rejected the connection' };
      case 'timeout':
        return { code: 'UPSTREAM_TIMEOUT', message: 'LM Studio request timed out' };
      case 'unreachable':
        return { code: 'UPSTREAM_UNREACHABLE', message: 'LM Studio is not reachable' };
      case 'unsupported':
        return { code: 'UPSTREAM_UNSUPPORTED', message: 'LM Studio streaming is unavailable' };
      default:
        return { code: 'UPSTREAM_ERROR', message: 'LM Studio request failed' };
    }
  }
  return { code: 'INTERNAL', message: 'an unexpected error occurred' };
}

function toResult(error: unknown): ProxyResult {
  if (error instanceof RpcMethodError && error.rpcCode === 'ALIASES_INVALID') {
    return { status: 503, error: ALIASES_INVALID };
  }
  return { status: 500, error: mapUpstreamError(error) };
}

/** The store lookup with PROFILE_NOT_FOUND as the thrown failure. */
function profileOf(store: ProfileStore, profileId: string, failure: ProxyError): CompositeProfile {
  try {
    return store.get(profileId);
  } catch {
    throw failure;
  }
}

const PROFILE_NOT_FOUND: ProxyError = { code: 'PROFILE_NOT_FOUND', message: 'the mapped profile was not found' };
const PROFILE_NOT_ACTIVE: ProxyError = { code: 'PROFILE_NOT_ACTIVE', message: 'the mapped profile is not active' };

/**
 * Serve one chat completion. The alias seam may throw its RPC error for a
 * non-conforming document; everything else fails closed with a stable HTTP
 * error. audit receives `{ at, outcome, virtualModel, sessionId?, profileId?,
 * aliasId? }` — session ids are masked, prompts/tokens never included.
 */
export async function handleChatCompletions(
  ports: ProxyPorts,
  requestValue: unknown,
  headerSessionId: string | null,
  release: boolean,
  signal: AbortSignal,
): Promise<ProxyResult> {
  const parsed = parseChatCompletionsRequest(requestValue);
  if (!parsed.ok) return { status: 400, error: parsed.error };
  const { request } = parsed;

  const sessionId = headerSessionId ?? bodySessionId(requestValue);
  const auditBase = {
    at: ports.now(),
    virtualModel: request.model,
    sessionId: maskSessionId(sessionId),
  };
  const audit = (entry: Record<string, unknown>): void => ports.aliases.audit({ ...auditBase, ...entry });

  let document: VirtualAliasesDocument;
  try {
    const doc = ports.aliases.readAliases();
    if (doc === null) {
      audit({ outcome: 'unconfigured' });
      return { status: 503, error: { code: 'PROXY_UNCONFIGURED', message: 'proxy aliases are not configured' } };
    }
    document = doc;
  } catch (error) {
    return toResult(error);
  }
  if (document.enabled === false) {
    audit({ outcome: 'disabled' });
    return { status: 503, error: { code: 'PROXY_DISABLED', message: 'proxy aliases are disabled' } };
  }

  const target = matchVirtualAlias(document, { model: request.model });
  if (target === null) {
    audit({ outcome: 'denied' });
    return { status: 404, error: MODEL_NOT_FOUND };
  }
  const alias = target.alias;

  // Same-session resolve: the first live resolution latches the profile for
  // (virtualModel, sessionId); a release unlatches then re-resolves fresh.
  // Requests without a session id stay stateless (config changes visible at once).
  const sessionEnabled = document.sessionLock !== false && alias.lockSession !== false;
  const key = sessionId === null ? null : sessionKey(alias.virtualModel, sessionId);
  let profileId = target.profileId;
  if (key !== null && release) {
    ports.session.release(key);
    audit({ outcome: 'released' });
  } else if (key !== null && sessionEnabled) {
    const held = ports.session.get(key);
    if (held !== null) {
      profileId = held.profileId;
      audit({ outcome: 'latched', profileId });
    } else {
      ports.session.latch(key, target.profileId);
      audit({ outcome: 'resolved', profileId: target.profileId });
    }
  } else {
    audit({ outcome: 'resolved', profileId: target.profileId });
  }

  let profile: CompositeProfile;
  try {
    profile = profileOf(ports.store, profileId, PROFILE_NOT_FOUND);
  } catch (error) {
    audit({ outcome: 'profile-missing', profileId });
    return { status: 503, error: error as ProxyError };
  }
  const effectiveModelKey = alias.modelKey ?? profile.model.modelKey;

  // Controlled activation: per-alias opt-in switches the profile under the
  // shared activation.lock; otherwise a read-only active check refuses a
  // request for an unloaded model with a clear 502 before any upload.
  const activation: ProxyActivation | null = ports.activation;
  if (alias.activate === true) {
    if (activation === null) {
      audit({ outcome: 'error', profileId });
      return { status: 503, error: { code: 'ACTIVATION_NOT_WIRED', message: 'activation is not wired' } };
    }
    const activationIssue = await runActivation(activation, profile, effectiveModelKey, signal, audit, profileId);
    if (activationIssue !== null) return activationIssue;
  } else if (activation !== null) {
    try {
      const state = await activation.runtime.getActiveState();
      if (state.modelKey !== effectiveModelKey) {
        audit({ outcome: 'profile-not-active', profileId });
        return { status: 502, error: PROFILE_NOT_ACTIVE };
      }
    } catch (error) {
      return toResult(error);
    }
  }

  // Upstream body: profile defaults first, alias overrides, then the client's
  // own values win (client > alias > profile; anything absent stays absent so
  // the upstream default applies — no hard cap injected).
  const body: Record<string, unknown> = {
    model: effectiveModelKey,
    messages: request.messages,
    stream: true,
  };
  applyGenerationToBody(body, profile.generation);
  applyGenerationToBody(body, alias.generation);
  for (const [keyValue, value] of Object.entries(request.sampling)) {
    if (value === null) delete body[keyValue];
    else body[keyValue] = value;
  }
  if (request.user !== null) body['user'] = request.user;

  ports.session.sweep();
  audit({ outcome: 'forwarded', profileId, aliasId: alias.id });

  const created = Math.floor(Date.now() / 1000);
  const streamId = `chatcmpl-lmps-${Math.random().toString(36).slice(2, 10)}`;
  try {
    const chunks = await ports.upstream.open(body, signal);
    if (request.stream) {
      return { status: 200, sse: frameStream(chunks, request.model, created, streamId) };
    }
    const buffered: ChatChunk[] = [];
    for await (const chunk of chunks) buffered.push(chunk);
    return { status: 200, body: nonStreamBody(buffered, request.model, created, streamId) };
  } catch (error) {
    return toResult(error);
  }
}

/**
 * The `activate: true` path. The shared activation.lock is owned entirely by the
 * runner's `locking` stage, so this never pre-acquires it — a second acquire of
 * the same file lock would fail as ACTIVATION_LOCK_BUSY and turn every active
 * switch into a 500. A raced activation surfaces the runner's own lock-busy
 * ActivationError, which maps to the same 503 the hook/CLI paths report.
 */
async function runActivation(
  activation: ProxyActivation,
  profile: CompositeProfile,
  effectiveModelKey: string,
  signal: AbortSignal,
  audit: (entry: Record<string, unknown>) => void,
  profileId: string,
): Promise<ProxyResult | null> {
  try {
    const state = await activation.runtime.getActiveState();
    if (state.modelKey === effectiveModelKey) return null;
  } catch (error) {
    return toResult(error);
  }
  try {
    const result = await activation.runner.run(profile, { signal });
    if (result.outcome.status !== 'active') {
      audit({ outcome: 'activation-failed', profileId });
      return { status: 503, error: { code: 'ACTIVATION_FAILED', message: 'activating the mapped profile failed' } };
    }
    audit({ outcome: 'activated', profileId });
    return null;
  } catch (error) {
    if (isActivationError(error) && error.code === 'ACTIVATION_LOCK_BUSY') {
      audit({ outcome: 'lock-busy', profileId });
      return { status: 503, error: { code: 'ACTIVATION_LOCK_BUSY', message: 'activation is busy' } };
    }
    return toResult(error);
  }
}

async function* frameStream(
  chunks: AsyncIterable<ChatChunk>,
  model: string,
  created: number,
  streamId: string,
): AsyncIterable<string> {
  let index = 0;
  for await (const chunk of chunks) {
    yield sseFrame(chunk, model, created, index, streamId);
    index += 1;
  }
  yield 'data: [DONE]\n\n';
}

/** GET /v1/models: the enabled aliases surfaced as OpenAI model objects. */
export async function handleListModels(
  ports: ProxyPorts,
): Promise<{ status: number; body: Record<string, unknown> }> {
  let document: VirtualAliasesDocument | null;
  try {
    document = ports.aliases.readAliases();
  } catch {
    return { status: 503, body: { error: ALIASES_INVALID } };
  }
  if (document === null) return { status: 200, body: { object: 'list', data: [] } };
  if (document.enabled === false) return { status: 200, body: { object: 'list', data: [] } };
  const data = document.aliases
    .filter((alias) => alias.enabled !== false)
    .map((alias) => ({ id: alias.virtualModel, object: 'model' as const, owned_by: 'lmps' }));
  return { status: 200, body: { object: 'list', data } };
}