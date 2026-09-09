/**
 * Streaming chat completions over the LM Studio OpenAI-compatible endpoint
 * (M2-003). One SSE request bisects the measured round-trip: first content
 * delta marks TTFT, accumulated deltas estimate generation tokens, a final
 * `usage` member — when present — takes precedence over the delta count.
 *
 * Path note (design risk, honest): LM Studio exposes chat completions at
 * `/api/v0/chat/completions`; the live smoke test verifies the exact path and a
 * single constant change here fixes a mismatch (`REST_CHAT_COMPLETIONS_PATH`).
 */
import type { LmStudioEnv } from '../env.js';
import { LmStudioError, classifyHttpFailure } from '../errors.js';
import { authHeaders, jsonContentType, restUrl } from './v1.js';

export const REST_CHAT_COMPLETIONS_PATH = '/api/v0/chat/completions';

export interface ChatChunk {
  contentDelta: string;
  finishReason: string | null;
  usage: ChatUsage | null;
}

export interface ChatUsage {
  completionTokens: number | null;
  promptTokens: number | null;
}

export interface ChatStreamParams {
  modelKey: string;
  prompt: string;
  maxTokens: number;
}

export interface ChatStreamOptions {
  signal?: AbortSignal;
  /**
   * Extra request-body fields merged over the M2-003 golden body. The proxy
   * (M4-002) builds its own full body via `restOpenAiChatStream` and does not
   * use this merge; kept for callers that extend the golden shape.
   */
  body?: Record<string, unknown>;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseUsage(value: unknown): ChatUsage | null {
  if (!isPlainRecord(value)) return null;
  const completionTokens =
    typeof value.completion_tokens === 'number' && Number.isFinite(value.completion_tokens)
      ? value.completion_tokens
      : null;
  const promptTokens =
    typeof value.prompt_tokens === 'number' && Number.isFinite(value.prompt_tokens) ? value.prompt_tokens : null;
  if (completionTokens === null && promptTokens === null) return null;
  return { completionTokens, promptTokens };
}

/**
 * Parses one `data:` line into a chunk; unparseable/empty lines yield null.
 * Reasoning models (live host 2026-09-07: qwen3.5) stream their thinking in
 * `delta.reasoning_content` before any visible `delta.content`, and a bounded
 * token budget can be consumed entirely by thinking — so both fields count as
 * generated output for TTFT/token measurement. Non-reasoning models are
 * unaffected: they only ever set `content`.
 */
export function parseChatData(data: string): ChatChunk | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data) as unknown;
  } catch {
    return null;
  }
  if (!isPlainRecord(parsed)) return null;
  const choices = parsed.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const choice = choices[0];
  if (!isPlainRecord(choice)) return null;
  const delta = isPlainRecord(choice.delta) ? choice.delta : {};
  const content = typeof delta.content === 'string' ? delta.content : '';
  const reasoning = typeof delta.reasoning_content === 'string' ? delta.reasoning_content : '';
  const finishReason = typeof choice.finish_reason === 'string' ? choice.finish_reason : null;
  const usage = parseUsage(parsed.usage);
  if (content === '' && reasoning === '' && finishReason === null && usage === null) return null;
  // Stream order is reasoning first, visible content last — preserve it.
  return { contentDelta: reasoning + content, finishReason, usage };
}

/**
 * Splits a decoded SSE body into `data:` events. Chunks may split lines and
 * `data:` payloads may span chunk boundaries; each complete data line is parsed
 * independently and `[DONE]` ends the stream. Known limitation, documented:
 * multi-line `data:` payloads are not reassembled (OpenAI chat completions
 * sends one JSON object per line).
 */
export async function* parseSseChatStream(body: AsyncIterable<string>): AsyncIterable<ChatChunk> {
  let buffer = '';
  for await (const piece of body) {
    buffer += piece;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const rawLine of lines) {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (line === '' || !line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      const chunk = parseChatData(data);
      if (chunk !== null) yield chunk;
    }
  }
  const tail = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer;
  if (tail.startsWith('data:')) {
    const data = tail.slice(5).trim();
    if (data === '[DONE]') return;
    const chunk = parseChatData(data);
    if (chunk !== null) yield chunk;
  }
}

/**
 * Opens one streaming chat completion against the OpenAI-compatible endpoint
 * with an arbitrary request body and returns the parsed event stream. This is
 * the upstream seam the proxy (M4-002) drives with its own body (model alias,
 * multi-message history, injected generation fields). Endpoint reachability
 * and failure classification are identical to `restChatCompletionStream`.
 */
export async function restOpenAiChatStream(
  env: LmStudioEnv,
  body: Record<string, unknown>,
  options: ChatStreamOptions = {},
): Promise<AsyncIterable<ChatChunk>> {
  const openStream = env.httpStream;
  if (openStream === undefined) {
    throw new LmStudioError('streaming HTTP seam is not available', {
      subsystem: 'rest',
      kind: 'unsupported',
      detail: REST_CHAT_COMPLETIONS_PATH,
    });
  }
  const url = restUrl(env.baseUrl, REST_CHAT_COMPLETIONS_PATH);
  let response;
  try {
    response = await openStream(url, {
      method: 'POST',
      headers: jsonContentType(authHeaders(env.token)),
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch (error) {
    throw new LmStudioError(`REST ${REST_CHAT_COMPLETIONS_PATH} unreachable`, {
      subsystem: 'rest',
      kind: 'unreachable',
      detail: REST_CHAT_COMPLETIONS_PATH,
      cause: error,
    });
  }
  if (!response.ok) {
    throw new LmStudioError(`REST ${REST_CHAT_COMPLETIONS_PATH} failed with status ${response.status}`, {
      subsystem: 'rest',
      kind: classifyHttpFailure(response.status),
      detail: REST_CHAT_COMPLETIONS_PATH,
    });
  }
  return parseSseChatStream(response.body());
}

/**
 * Opens one streaming chat completion for the M2-003 golden request shape:
 * a single user message, `stream: true`, `max_tokens`. `options.body` merges
 * extra fields over this golden body without changing it when absent; callers
 * that need a full custom body (the proxy) use `restOpenAiChatStream` instead.
 */
export async function restChatCompletionStream(
  env: LmStudioEnv,
  params: ChatStreamParams,
  options: ChatStreamOptions = {},
): Promise<AsyncIterable<ChatChunk>> {
  return restOpenAiChatStream(
    env,
    {
      model: params.modelKey,
      messages: [{ role: 'user', content: params.prompt }],
      stream: true,
      max_tokens: params.maxTokens,
      ...options.body,
    },
    options,
  );
}