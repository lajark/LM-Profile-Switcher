/**
 * Fake `LmStudioEnv` for the adapter tests (M0-005): an in-memory HTTP handler
 * and an in-memory `lms` runner, so every adapter test exercises the real
 * adapter code against a scripted host without sockets or child processes.
 */
import type { LmRequestInit, LmSpawnResult, LmStudioEnv } from '@lmps/lmstudio-adapter';

export const NOW = '2026-08-22T01:02:03.000Z';

export interface FakeHttpResult {
  status: number;
  body?: unknown;
  rawText?: string;
}

export interface FakeLmStudioEnvOptions {
  baseUrl?: string;
  token?: string | null;
  lmsBin?: string;
  httpHandler?: (path: string, init: LmRequestInit) => FakeHttpResult | Promise<FakeHttpResult>;
  runLmsHandler?: (args: readonly string[], timeoutMs?: number) => LmSpawnResult | Promise<LmSpawnResult>;
  now?: string;
}

export function makeFakeEnv(options: FakeLmStudioEnvOptions = {}): LmStudioEnv {
  const baseUrl = options.baseUrl ?? 'http://127.0.0.1:1234';
  return {
    baseUrl,
    token: options.token ?? null,
    lmsBin: options.lmsBin ?? 'lms',
    now: () => options.now ?? NOW,
    nowMs: () => 0,
    async http(path, init = {}) {
      // Handlers match the bare path (e.g. `/api/v1/models`), not the
      // absolute URL the adapter builds.
      const requestPath = path.startsWith(baseUrl) ? path.slice(baseUrl.length) : path;
      const result =
        options.httpHandler === undefined
          ? { status: 404, rawText: '{"error":"no handler"}' }
          : await options.httpHandler(requestPath, init);
      return {
        ok: result.status >= 200 && result.status < 300,
        status: result.status,
        async text() {
          if (result.rawText !== undefined) return result.rawText;
          return result.body === undefined ? '' : JSON.stringify(result.body);
        },
      };
    },
    async runLms(args, timeoutMs) {
      return (
        options.runLmsHandler === undefined
          ? { exitCode: 127, stdout: '', stderr: 'no handler', timedOut: false }
          : await options.runLmsHandler(args, timeoutMs)
      );
    },
  };
}

/** Routes REST requests by path: `target` gets the handler, everything else 404. */
export function routeHttp(
  target: string,
  handler: (init: LmRequestInit) => FakeHttpResult,
): (path: string, init: LmRequestInit) => FakeHttpResult {
  return (path, init) => (path === target ? handler(init) : { status: 404, rawText: '{"error":"not found"}' });
}

export function restModelsBody(models: unknown[]): unknown {
  return { data: models };
}

export function loadedModel(id: string, loadConfig: Record<string, unknown> | null = {}): unknown {
  return { id, loaded: loadConfig !== null, load_config: loadConfig };
}

/**
 * Live-host row shape for `GET /api/v1/models` (verified 2026-09-06): the model
 * is named by `key` (snake_case) and loaded state by `loaded_instances`.
 * `instanceIds` lets a test model several loaded instances of one key (live host
 * 2026-09-07 spawns `key:2` when the same model is reloaded with another config).
 */
export function liveHostModel(key: string, loaded = false, instanceIds?: string[]): unknown {
  const ids = instanceIds ?? (loaded ? [key] : []);
  return {
    type: 'llm',
    publisher: key.split('/')[0],
    key,
    display_name: key.split('/')[1] ?? key,
    architecture: 'qwen35',
    quantization: { name: 'Q4_K_M', bits_per_weight: 4 },
    size_bytes: 17_742_039_110,
    params_string: '27B',
    loaded_instances: ids.map((id) => ({ id, identifier: `default-${id}` })),
    max_context_length: 262_144,
    format: 'gguf',
    capabilities: {},
    variants: [`${key}@q4_k_m`],
    selected_variant: `${key}@q4_k_m`,
  };
}

export const SPAWN_OK: LmSpawnResult = { exitCode: 0, stdout: '', stderr: '', timedOut: false };