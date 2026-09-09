/**
 * LM Studio REST API v1 surface (M0-005): endpoint constants and pure
 * parse/build helpers, driven by the injected `LmStudioEnv` so tests never
 * touch a socket. Field names follow the official v1 contract (endpoints
 * verified 2026-09-05: `GET|POST /api/v1/models`, `POST …/load|unload`,
 * `echo_load_config` echo). Version drift is captured by the capability probe,
 * not guessed here.
 */
import type { CompositeProfile } from '@lmps/domain';

import type { LmHttpResponse, LmRequestInit, LmStudioEnv } from '../env.js';
import { LmStudioError, classifyHttpFailure } from '../errors.js';

export const REST_MODELS_PATH = '/api/v1/models';

/**
 * Transport budget for `POST …/load`. Loading is a cold-start operation that
 * legitimately takes seconds to minutes (a real 9B host needed ~16s), far
 * beyond the 5s REST-latency default. Set above the activation stage budget
 * (60s) so the stage — not the transport — is the deterministic bound; the
 * transport timeout only guards a hung server as a last-resort safety net.
 */
export const REST_LOAD_TIMEOUT_MS = 5 * 60 * 1000;

export interface RestLmModel {
  id: string;
  loaded: boolean;
  loadConfig: Record<string, unknown> | null;
  /**
   * Instance id of a loaded model (live-host contract: unload addresses the
   * loaded instance by `instance_id`, not the model key). Null when the model
   * is not loaded or the host does not expose instance ids.
   */
  instanceId: string | null;
  /**
   * Every loaded instance id (live host 2026-09-07: loading the same model with
   * a different config spawns a second instance, e.g. `qwen/qwen3.5-9b:2`). The
   * benchmark runtime uses these to restore only the instances a run created and
   * never an instance another activation left loaded.
   */
  loadedInstanceIds: string[];
}

export interface RestLoadResponse {
  instanceId: string | null;
  loadConfig: Record<string, unknown> | null;
}

export function restUrl(base: string, path: string): string {
  return `${base}${path}`;
}

export function authHeaders(token: string | null): Record<string, string> {
  return token === null ? {} : { Authorization: `Bearer ${token}` };
}

export function jsonContentType(headers?: Readonly<Record<string, string>>): Record<string, string> {
  return { 'content-type': 'application/json', accept: 'application/json', ...(headers ?? {}) };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface JsonResponse {
  status: number;
  body: unknown;
}

/**
 * Executes one REST call and returns the parsed JSON body. Transport failures
 * become `unreachable`; non-2xx responses are classified via
 * `classifyHttpFailure`; non-JSON bodies are `parse`.
 */
export async function restRequestJson(
  env: LmStudioEnv,
  path: string,
  init: LmRequestInit = {},
): Promise<JsonResponse> {
  let response: LmHttpResponse;
  try {
    response = await env.http(restUrl(env.baseUrl, path), {
      method: init.method ?? 'GET',
      headers: { accept: 'application/json', ...authHeaders(env.token), ...init.headers },
      body: init.body,
      timeoutMs: init.timeoutMs,
    });
  } catch (error) {
    throw new LmStudioError(`REST ${path} unreachable`, {
      subsystem: 'rest',
      kind: 'unreachable',
      detail: path,
      cause: error,
    });
  }

  const text = await response.text();
  let body: unknown = null;
  if (text.trim() !== '') {
    try {
      body = JSON.parse(text) as unknown;
    } catch (error) {
      throw new LmStudioError(`REST ${path} returned non-JSON`, {
        subsystem: 'rest',
        kind: 'parse',
        detail: path,
        cause: error,
      });
    }
  }

  if (!response.ok) {
    throw new LmStudioError(`REST ${path} failed with status ${response.status}`, {
      subsystem: 'rest',
      kind: classifyHttpFailure(response.status),
      detail: path,
    });
  }

  return { status: response.status, body };
}

/**
 * Parses the `GET /api/v1/models` response (`data` array, optionally `models`).
 * Live host contract (verified 2026-09-06): each row names the model by `key`
 * (snake_case, e.g. `qwen/qwen3.8-27b`) — not `id` — and reports loaded state
 * via `loaded_instances` (non-empty when loaded). A legacy `data` array / `id`
 * / `loaded` shape is accepted for compatibility; rows with neither `id` nor
 * `key` are dropped.
 */
export function parseListResponse(body: unknown): RestLmModel[] {
  if (!isPlainRecord(body)) return [];
  const record: Record<string, unknown> = body;
  const items = Array.isArray(record.data) ? record.data : Array.isArray(record.models) ? record.models : [];

  const result: RestLmModel[] = [];
  for (const item of items) {
    if (!isPlainRecord(item)) continue;
    const row: Record<string, unknown> = item;
    const id =
      typeof row.id === 'string' && row.id !== ''
        ? row.id
        : typeof row.key === 'string' && row.key !== ''
          ? row.key
          : '';
    if (id === '') continue;
    const loadConfig = isPlainRecord(row.load_config) ? row.load_config : null;
    const instances = Array.isArray(row.loaded_instances)
      ? (row.loaded_instances as unknown[]).filter(isPlainRecord)
      : [];
    const loaded =
      row.loaded === true || row.state === 'loaded' || loadConfig !== null || instances.length > 0;
    const instanceIds: string[] = [];
    for (const instance of instances) {
      const instanceId = (instance as Record<string, unknown>).id;
      if (typeof instanceId === 'string' && instanceId !== '') instanceIds.push(instanceId);
    }
    result.push({ id, loaded, loadConfig, instanceId: instanceIds[0] ?? null, loadedInstanceIds: instanceIds });
  }
  return result;
}

/** Parses the `POST …/load` response: instance id plus the echoed `load_config`. */
export function parseLoadResponse(body: unknown): RestLoadResponse {
  if (!isPlainRecord(body)) return { instanceId: null, loadConfig: null };
  const record: Record<string, unknown> = body;
  const instanceId = typeof record.instance_id === 'string' ? record.instance_id : null;
  const loadConfig = isPlainRecord(record.load_config) ? record.load_config : null;
  return { instanceId, loadConfig };
}

/** Body for `POST …/load`. Only fields the official v1 contract documents. */
export function buildRestLoadBody(params: RestLoadParams): Record<string, unknown> {
  const body: Record<string, unknown> = { model: params.modelKey, echo_load_config: true };
  if (params.identifier !== undefined && params.identifier !== null) body.identifier = params.identifier;
  if (params.contextLength !== undefined && params.contextLength !== null) body.context_length = params.contextLength;
  if (typeof params.gpuOffload === 'number') body.gpu_offload = params.gpuOffload;
  if (params.evalBatchSize !== undefined && params.evalBatchSize !== null) body.eval_batch_size = params.evalBatchSize;
  if (params.flashAttention !== undefined && params.flashAttention !== null) body.flash_attention = params.flashAttention;
  if (params.offloadKvCacheToGpu !== undefined && params.offloadKvCacheToGpu !== null) {
    body.offload_kv_cache_to_gpu = params.offloadKvCacheToGpu;
  }
  if (params.numExperts !== undefined && params.numExperts !== null) body.num_experts = params.numExperts;
  return body;
}

export interface RestLoadParams {
  modelKey: string;
  identifier?: string | null;
  contextLength?: number | null;
  /** Numeric offload ratio only — `auto`/`max`/`off` lack a stable v1 mapping. */
  gpuOffload?: 'auto' | 'max' | 'off' | number | null;
  evalBatchSize?: number | null;
  flashAttention?: boolean | null;
  offloadKvCacheToGpu?: boolean | null;
  numExperts?: number | null;
}

/** Projects a stored profile onto the REST load body the host understands. */
export function profileToRestLoadParams(profile: CompositeProfile): RestLoadParams {
  return {
    modelKey: profile.model.modelKey,
    identifier: profile.behavior.identifier,
    contextLength: profile.runtime.contextLength,
    gpuOffload: profile.runtime.gpuOffload,
    evalBatchSize: profile.runtime.evalBatchSize,
    flashAttention: profile.runtime.flashAttention,
    offloadKvCacheToGpu: profile.runtime.offloadKvCacheToGpu,
    numExperts: profile.runtime.numExperts,
  };
}

export async function restListModels(env: LmStudioEnv): Promise<RestLmModel[]> {
  const { body } = await restRequestJson(env, REST_MODELS_PATH);
  return parseListResponse(body);
}

export async function restLoadModel(env: LmStudioEnv, params: RestLoadParams): Promise<RestLoadResponse> {
  const { body } = await restRequestJson(env, `${REST_MODELS_PATH}/load`, {
    method: 'POST',
    headers: jsonContentType(),
    body: JSON.stringify(buildRestLoadBody(params)),
    // A cold model load is a slow end-to-end operation; its transport budget is
    // the dedicated load timeout, not the generic REST-latency budget.
    timeoutMs: REST_LOAD_TIMEOUT_MS,
  });
  return parseLoadResponse(body);
}

/**
 * Unloads a loaded model instance. Live-host contract (verified 2026-09-07):
 * `POST …/unload` requires `instance_id` (`{"model": …}` alone is rejected with
 * 400 missing-instance_id). The instance id comes from the list response's
 * `loaded_instances[].id` (or the load response's `instance_id`); when no
 * instance id is known the model key is sent as a best-effort fallback.
 */
export async function restUnloadModel(
  env: LmStudioEnv,
  modelKey: string,
  instanceId?: string | null,
  identifier?: string | null,
): Promise<void> {
  const body: Record<string, unknown> = {
    // The host addresses loaded instances by their instance id, not the key.
    instance_id: instanceId ?? modelKey,
  };
  if (body.instance_id === modelKey && identifier !== undefined && identifier !== null) body.identifier = identifier;
  await restRequestJson(env, `${REST_MODELS_PATH}/unload`, {
    method: 'POST',
    headers: jsonContentType(),
    body: JSON.stringify(body),
  });
}