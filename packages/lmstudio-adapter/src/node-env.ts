/**
 * Node implementation of the `LmStudioEnv` seam (M0-005). This is the only
 * file in the package that imports `node:`: HTTP calls run through `fetch`
 * with a per-request timeout, and `lms` child processes run with a timeout,
 * kill and bounded capture. Tests never reference this module — they inject
 * fakes through the env interface.
 */
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

import {
  DEFAULT_LMS_BIN,
  DEFAULT_LM_BASE_URL,
  resolveBaseUrl,
  type LmHttpResponse,
  type LmRequestInit,
  type LmSpawnResult,
  type LmStreamResponse,
  type LmStudioEnv,
} from './env.js';
import { LmStudioError } from './errors.js';

export interface NodeLmStudioEnvOptions {
  baseUrl?: string;
  token?: string | null;
  lmsBin?: string;
  /** Per-request HTTP timeout in ms (default 5000). */
  httpTimeoutMs?: number;
  /** Default CLI call timeout in ms (default 15000). */
  cliTimeoutMs?: number;
  now?: () => string;
  fetch?: typeof globalThis.fetch;
}

const HTTP_DEFAULT_TIMEOUT_MS = 5_000;
const CLI_DEFAULT_TIMEOUT_MS = 15_000;
/** Safety net after the child is killed: never let a promise dangle. */
const KILL_SETTLE_MS = 2_000;

export function createNodeLmStudioEnv(options: NodeLmStudioEnvOptions = {}): LmStudioEnv {
  const httpTimeoutMs = options.httpTimeoutMs ?? HTTP_DEFAULT_TIMEOUT_MS;
  const cliTimeoutMs = options.cliTimeoutMs ?? CLI_DEFAULT_TIMEOUT_MS;
  const lmsBin = options.lmsBin ?? DEFAULT_LMS_BIN;
  const fetchImpl = options.fetch ?? globalThis.fetch;

  return {
    baseUrl: resolveBaseUrl(options.baseUrl, DEFAULT_LM_BASE_URL),
    token: options.token ?? null,
    lmsBin,
    now: options.now ?? (() => new Date().toISOString()),
    nowMs: () => performance.now(),

    async http(path: string, init: LmRequestInit = {}): Promise<LmHttpResponse> {
      const timeoutMs = init.timeoutMs ?? httpTimeoutMs;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(path, {
          method: init.method ?? 'GET',
          headers: init.headers,
          body: init.body,
          signal: combinedSignal(init.signal, controller.signal),
        });
        return {
          ok: response.ok,
          status: response.status,
          text: () => response.text(),
        } satisfies LmHttpResponse;
      } catch (error) {
        if (controller.signal.aborted) {
          throw new LmStudioError(`REST ${path} timed out after ${timeoutMs}ms`, {
            subsystem: 'rest',
            kind: 'timeout',
            detail: path,
            cause: error,
          });
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },

    async httpStream(url: string, init: LmRequestInit = {}): Promise<LmStreamResponse> {
      // The timeout covers connection + headers only; once the stream is open,
      // the per-sample budget (core) and the caller's signal bound the body.
      const timeoutMs = init.timeoutMs ?? httpTimeoutMs;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, {
          method: init.method ?? 'POST',
          headers: init.headers,
          body: init.body,
          signal: combinedSignal(init.signal, controller.signal),
        });
        return {
          ok: response.ok,
          status: response.status,
          body: streamBody(response.body, init.signal),
        } satisfies LmStreamResponse;
      } catch (error) {
        if (controller.signal.aborted) {
          throw new LmStudioError(`REST ${url} timed out after ${timeoutMs}ms`, {
            subsystem: 'rest',
            kind: 'timeout',
            detail: url,
            cause: error,
          });
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },

    runLms(args: readonly string[], timeoutMs: number = cliTimeoutMs): Promise<LmSpawnResult> {
      return new Promise<LmSpawnResult>((resolveResult) => {
        const child = spawn(lmsBin, [...args], {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let settled = false;

        const finish = (exitCode: number): void => {
          if (settled) return;
          settled = true;
          resolveResult({ exitCode, stdout, stderr, timedOut });
        };

        if (timeoutMs > 0) {
          setTimeout(() => {
            timedOut = true;
            child.kill();
            // Some platforms may not surface 'exit' after kill; settle anyway.
            setTimeout(() => finish(124), KILL_SETTLE_MS);
          }, timeoutMs);
        }

        child.stdout.on('data', (chunk: Buffer | string) => {
          stdout += String(chunk);
        });
        child.stderr.on('data', (chunk: Buffer | string) => {
          stderr += String(chunk);
        });
        child.on('error', (error) => {
          stderr += `spawn failed: ${error.message}`;
          finish(127);
        });
        child.on('exit', (code) => {
          finish(timedOut ? 124 : (code ?? 1));
        });
      });
    },
  };
}

/**
 * Composes the external cancellation signal with the internal transport signal.
 * Falls back to the internal one when `AbortSignal.any` is unavailable rather
 * than coupling the two (an external abort then only ends the body iteration).
 */
function combinedSignal(external: AbortSignal | undefined, internal: AbortSignal): AbortSignal {
  if (external === undefined) return internal;
  const any = (AbortSignal as unknown as { any?: (signals: readonly AbortSignal[]) => AbortSignal }).any;
  if (typeof any === 'function') return any([internal, external]);
  return internal;
}

/**
 * Iterates an SSE body, decoding web-stream chunks to text. Aborting the
 * external signal ends the iteration (cooperative cancel) instead of throwing,
 * so a timed-out stream reads as a truncated but settled body rather than a
 * crash.
 */
function streamBody(body: ReadableStream<Uint8Array> | null, external: AbortSignal | undefined): () => AsyncIterable<string> {
  const decoder = new TextDecoder();
  return async function* (): AsyncIterable<string> {
    if (body === null) return;
    const reader = body.getReader();
    try {
      for (;;) {
        if (external?.aborted === true) break;
        let next;
        try {
          next = await reader.read();
        } catch {
          break; // transport aborted (timeout/cancel); end the stream quietly
        }
        if (next.done) break;
        if (next.value !== undefined) yield decoder.decode(next.value, { stream: true });
      }
      yield decoder.decode();
    } finally {
      reader.releaseLock();
    }
  };
}