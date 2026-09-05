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
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), httpTimeoutMs);
      try {
        const response = await fetchImpl(path, {
          method: init.method ?? 'GET',
          headers: init.headers,
          body: init.body,
          signal: controller.signal,
        });
        return {
          ok: response.ok,
          status: response.status,
          text: () => response.text(),
        } satisfies LmHttpResponse;
      } catch (error) {
        if (controller.signal.aborted) {
          throw new LmStudioError(`REST ${path} timed out after ${httpTimeoutMs}ms`, {
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