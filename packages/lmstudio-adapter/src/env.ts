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
  /** Cooperative cancellation; the transport aborts the request when signalled. */
  signal?: AbortSignal;
  /**
   * Per-request transport timeout override (ms). Long-lived operations like
   * model load legitimately exceed the default REST-latency budget, so the
   * caller can widen just this one call instead of the whole env.
   */
  timeoutMs?: number;
}

/** Body of an SSE streaming response; chunks yield decoded text pieces. */
export interface LmStreamResponse {
  ok: boolean;
  status: number;
  body(): AsyncIterable<string>;
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
  /**
   * Streaming HTTP seam for SSE endpoints (M2-003). Optional so the interface
   * stays compatible with existing fakes; only the benchmark path needs it.
   * The timeout-to-first-byte/body semantics are the implementation's choice;
   * cancellation via `init.signal` must abort the body iteration.
   */
  httpStream?(url: string, init?: LmRequestInit): Promise<LmStreamResponse>;
  runLms(args: readonly string[], timeoutMs?: number): Promise<LmSpawnResult>;
}

export const DEFAULT_LM_BASE_URL = 'http://127.0.0.1:1234';
export const DEFAULT_LMS_BIN = 'lms';

/** Normalizes a base URL: trims whitespace and trailing slashes; empty → fallback. */
export function resolveBaseUrl(raw: string | undefined, fallback: string = DEFAULT_LM_BASE_URL): string {
  const value = (raw ?? '').trim().replace(/\/+$/, '');
  return value === '' ? fallback : value;
}