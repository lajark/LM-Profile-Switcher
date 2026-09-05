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

export interface RestLmModel {
  id: string;
  loaded: boolean;
  loadConfig: Record<string, unknown> | null;
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

/** Parses the `GET /api/v1/models` response (`data` array, optionally `models`). */
export function parseListResponse(body: unknown): RestLmModel[] {
  if (!isPlainRecord(body)) return [];
  const record: Record<string, unknown> = body;
  const items = Array.isArray(record.data) ? record.data : Array.isArray(record.models) ? record.models : [];

  const result: RestLmModel[] = [];
  for (const item of items) {
    if (!isPlainRecord(item)) continue;
    const row: Record<string, unknown> = item;
    const id = typeof row.id === 'string' && row.id !== '' ? row.id : '';
    if (id === '') continue;
    const loadConfig = isPlainRecord(row.load_config) ? row.load_config : null;
    const loaded = row.loaded === true || row.state === 'loaded' || loadConfig !== null;
    result.push({ id, loaded, loadConfig });
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
  });
  return parseLoadResponse(body);
}

export async function restUnloadModel(
  env: LmStudioEnv,
  modelKey: string,
  identifier?: string | null,
): Promise<void> {
  const body: Record<string, unknown> = { model: modelKey };
  if (identifier !== undefined && identifier !== null) body.identifier = identifier;
  await restRequestJson(env, `${REST_MODELS_PATH}/unload`, {
    method: 'POST',
    headers: jsonContentType(),
    body: JSON.stringify(body),
  });
}