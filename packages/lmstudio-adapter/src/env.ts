/**
 * Host seam for LM Studio interactions (M0-005). HTTP transport, the `lms`
 * child process and the clock are injected so every adapter runs against
 * fakes in tests — `node-env.ts` is the package's only place that imports
 * Node built-ins. Nothing else in the monorepo may talk to LM Studio directly
 * (architecture rule: UI/CLI go through this adapter).
 */

/** Minimal HTTP response (fetch-shaped but testable without a socket). */
export interface LmHttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export interface LmRequestInit {
  method?: 'GET' | 'POST';
  headers?: Readonly<Record<string, string>>;
  body?: string;
}

export interface LmSpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface LmStudioEnv {
  /** REST base URL (default `http://127.0.0.1:1234`). */
  baseUrl: string;
  /** Optional REST bearer token. SECRET — records redact it before leaving memory. */
  token: string | null;
  /** `lms` executable name or absolute path. */
  lmsBin: string;
  now(): string;
  /** Monotonic clock in ms, for latency measurement. */
  nowMs(): number;
  http(path: string, init?: LmRequestInit): Promise<LmHttpResponse>;
  runLms(args: readonly string[], timeoutMs?: number): Promise<LmSpawnResult>;
}

export const DEFAULT_LM_BASE_URL = 'http://127.0.0.1:1234';
export const DEFAULT_LMS_BIN = 'lms';

/** Normalizes a base URL: trims whitespace and trailing slashes; empty → fallback. */
export function resolveBaseUrl(raw: string | undefined, fallback: string = DEFAULT_LM_BASE_URL): string {
  const value = (raw ?? '').trim().replace(/\/+$/, '');
  return value === '' ? fallback : value;
}