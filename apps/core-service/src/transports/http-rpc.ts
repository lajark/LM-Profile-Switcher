/**
 * Loopback HTTP JSON-RPC transport (spike M0-006). Binds 127.0.0.1 on a
 * random OS-chosen port; the port is reported through TransportServer.address
 * so the parent can rendezvous. Authentication: Bearer session token on every
 * request; tokens are compared in constant time.
 *
 * Never binds 0.0.0.0: an external bind is a hard error for the spike.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { isRpcRequest, type Dispatcher } from '../protocol.js';
import type { OpenAiProxySeam } from '../wiring.js';
import type { TransportServer } from './types.js';

const MAX_BODY_BYTES = 1 << 20; // 1 MiB guard against unbounded request bodies.

export interface HttpOptions {
  token: string;
  dispatcher: Dispatcher;
  /** Loopback port to bind; defaults to an OS-chosen random port. */
  port?: number;
  /**
   * OpenAI-compatible proxy front (M4-002); when present the server also serves
   * GET /v1/models and POST /v1/chat/completions behind the same Bearer token.
   */
  openAi?: OpenAiProxySeam;
}

function constantTimeEqual(expected: string, actual: string): boolean {
  if (expected.length !== actual.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  }
  return diff === 0;
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
      } catch {
        reject(new Error('invalid json body'));
      }
    });
    request.on('error', reject);
  });
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

export async function startHttpServer(options: HttpOptions): Promise<TransportServer> {
  const active = new Map<number, AbortController>();

  const authorized = (request: IncomingMessage): boolean => {
    const header = request.headers['authorization'];
    if (typeof header !== 'string') return false;
    return constantTimeEqual(`Bearer ${options.token}`, header);
  };

  const server = createServer((request, response) => {
    void handleRequest(request, response);
  });

  async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!authorized(request)) {
      writeJson(response, 401, { error: { code: 'UNAUTHORIZED', message: 'missing or invalid bearer token' } });
      return;
    }
    const path = request.url ?? '/';
    if (request.method === 'GET' && path === '/health') {
      writeJson(response, 200, { ok: true });
      return;
    }
    if (options.openAi !== undefined && request.method === 'GET' && path === '/v1/models') {
      await listModels(request, response);
      return;
    }
    if (request.method !== 'POST') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'use POST' } });
      return;
    }
    if (path === '/rpc') {
      await singleCall(request, response);
      return;
    }
    if (path === '/rpc/stream') {
      await streamCall(request, response);
      return;
    }
    if (path === '/rpc/cancel') {
      await cancelCall(request, response);
      return;
    }
    if (options.openAi !== undefined && path === '/v1/chat/completions') {
      await chatCompletions(request, response);
      return;
    }
    writeJson(response, 404, { error: { code: 'NOT_FOUND', message: path } });
  }

  async function listModels(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const seam = options.openAi;
    if (seam === undefined) {
      writeJson(response, 404, { error: { code: 'NOT_FOUND', message: 'openai proxy not wired' } });
      return;
    }
    const result = await seam.handleListModels();
    writeJson(response, result.status, result.body);
  }

  /** x-session-id header (primary session carrier; body session_id is the fallback). */
  function sessionHeader(request: IncomingMessage): string | null {
    const value = request.headers['x-session-id'];
    return typeof value === 'string' && value !== '' ? value : null;
  }

  function releaseHeader(request: IncomingMessage): boolean {
    return request.headers['x-session-release'] === 'true';
  }

  async function chatCompletions(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const seam = options.openAi;
    if (seam === undefined) {
      writeJson(response, 404, { error: { code: 'NOT_FOUND', message: 'openai proxy not wired' } });
      return;
    }
    let value: unknown;
    try {
      value = await readJsonBody(request);
    } catch (error) {
      writeJson(response, 400, { error: { code: 'BAD_REQUEST', message: error instanceof Error ? error.message : 'bad body' } });
      return;
    }
    const controller = new AbortController();
    response.on('close', () => controller.abort());
    const result = await seam.handleChatCompletions(value, sessionHeader(request), releaseHeader(request), controller.signal);
    if ('error' in result) {
      writeJson(response, result.status, { error: result.error });
      return;
    }
    if ('sse' in result) {
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'transfer-encoding': 'chunked',
      });
      let failed = false;
      for await (const frame of result.sse) {
        if (failed) break;
        try {
          response.write(frame);
        } catch {
          failed = true;
        }
      }
      if (!failed) response.end();
      return;
    }
    writeJson(response, 200, result.body);
  }

  async function singleCall(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let value: unknown;
    try {
      value = await readJsonBody(request);
    } catch (error) {
      writeJson(response, 400, { error: { code: 'BAD_REQUEST', message: error instanceof Error ? error.message : 'bad body' } });
      return;
    }
    if (!isRpcRequest(value)) {
      writeJson(response, 400, { error: { code: 'BAD_REQUEST', message: 'expected a jsonrpc 2.0 request' } });
      return;
    }
    const controller = new AbortController();
    active.set(value.id, controller);
    const result = await options.dispatcher.dispatch(value, controller.signal);
    active.delete(value.id);
    if (result.error !== undefined) {
      writeJson(response, 200, { jsonrpc: '2.0', id: value.id, error: result.error });
      return;
    }
    if (result.stream !== undefined) {
      writeJson(response, 200, { jsonrpc: '2.0', id: value.id, result: { done: true, count: 0, canceled: false } });
      return;
    }
    writeJson(response, 200, { jsonrpc: '2.0', id: value.id, result: result.result });
  }

  async function streamCall(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let value: unknown;
    try {
      value = await readJsonBody(request);
    } catch (error) {
      writeJson(response, 400, { error: { code: 'BAD_REQUEST', message: error instanceof Error ? error.message : 'bad body' } });
      return;
    }
    if (!isRpcRequest(value)) {
      writeJson(response, 400, { error: { code: 'BAD_REQUEST', message: 'expected a jsonrpc 2.0 request' } });
      return;
    }
    const controller = new AbortController();
    active.set(value.id, controller);
    const result = await options.dispatcher.dispatch(value, controller.signal);
    if (result.error !== undefined) {
      active.delete(value.id);
      writeJson(response, 200, { jsonrpc: '2.0', id: value.id, error: result.error });
      return;
    }
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'transfer-encoding': 'chunked',
    });
    let count = 0;
    let canceled = false;
    try {
      if (result.stream !== undefined) {
        for await (const chunk of result.stream) {
          if (controller.signal.aborted) {
            canceled = true;
            break;
          }
          count += 1;
          response.write(`${JSON.stringify({ jsonrpc: '2.0', id: value.id, result: chunk })}\n`);
        }
      } else {
        response.write(`${JSON.stringify({ jsonrpc: '2.0', id: value.id, result: result.result })}\n`);
      }
    } catch {
      canceled = true;
    }
    active.delete(value.id);
    response.end(`${JSON.stringify({ jsonrpc: '2.0', id: value.id, final: true, result: { done: true, count, canceled } })}\n`);
  }

  async function cancelCall(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let value: unknown;
    try {
      value = await readJsonBody(request);
    } catch (error) {
      writeJson(response, 400, { error: { code: 'BAD_REQUEST', message: error instanceof Error ? error.message : 'bad body' } });
      return;
    }
    if (value === null || typeof value !== 'object' || typeof (value as { id?: unknown }).id !== 'number') {
      writeJson(response, 400, { error: { code: 'BAD_REQUEST', message: 'expected { id: number }' } });
      return;
    }
    const target = (value as { id: number }).id;
    const controller = active.get(target);
    if (controller !== undefined) controller.abort();
    writeJson(response, 200, { ok: true, canceled: controller !== undefined });
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;

  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  return {
    address: () => `http://127.0.0.1:${address.port}`,
    close: async () => {
      for (const controller of active.values()) controller.abort();
      if (server.listening) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      resolveClosed();
    },
    closed,
  };
}