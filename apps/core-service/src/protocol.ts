/**
 * Sidecar JSON-RPC wire format and dispatch core (spike M0-006).
 *
 * Pure TypeScript: no Node-builtin imports, so this module deterministically
 * fits into the esbuild-inlined Node SEA bundle and vitest unit tests alike.
 *
 * Framing is newline-delimited JSON, one request or response per line. The
 * same frame flow is used by the stdio and named-pipe transports; the HTTP
 * transport reuses dispatch() with Bearer auth and a chunked body.
 */

export const RPC_VERSION = '2.0' as const;

export interface RpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface RpcResponse {
  jsonrpc: '2.0';
  id: number;
  /** Odd fields: present only on the join frame of a stream. */
  final?: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

/** First frame of a stdio/named-pipe connection: session-token handshake. */
export interface AuthFrame {
  jsonrpc: '2.0';
  auth: true;
  token: string;
}

/** Request that aborts the in-flight request with the given id. */
export interface CancelRequest {
  jsonrpc: '2.0';
  method: 'cancel';
  params: { id: number };
}

export function isAuthFrame(value: unknown): value is AuthFrame {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Partial<AuthFrame>;
  return v.auth === true && typeof v.token === 'string';
}

export function isCancelRequest(value: unknown): value is CancelRequest {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Partial<CancelRequest>;
  return v.method === 'cancel' && typeof v.params?.id === 'number';
}

export function isRpcRequest(value: unknown): value is RpcRequest {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Partial<RpcRequest>;
  return v.jsonrpc === RPC_VERSION && typeof v.id === 'number' && typeof v.method === 'string';
}

export interface RpcError {
  code: string;
  message: string;
}

/**
 * Typed RPC failure carrying a stable machine code (M3-002). Additive over the
 * INTERNAL fallback: a handler may throw this to surface a localizable error
 * code to the UI; anything else still collapses to INTERNAL so existing handler
 * contracts (e.g. settings.setLocale) keep their behavior unchanged.
 */
export class RpcMethodError extends Error {
  readonly rpcCode: string;

  constructor(rpcCode: string, message: string) {
    super(message);
    this.name = 'RpcMethodError';
    this.rpcCode = rpcCode;
  }
}

export interface DispatchResult {
  result: unknown;
  error?: RpcError;
  /** Present only for stream methods; the transport emits one frame per chunk. */
  stream?: AsyncIterable<unknown>;
}

export type SingleHandler = (params: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;

export type StreamHandler = (params: Record<string, unknown>, signal: AbortSignal) => AsyncIterable<unknown>;

export interface Handlers {
  single: Readonly<Record<string, SingleHandler>>;
  stream: Readonly<Record<string, StreamHandler>>;
}

export class Dispatcher {
  constructor(private readonly handlers: Handlers) {}

  async dispatch(request: RpcRequest, signal: AbortSignal): Promise<DispatchResult> {
    const single = this.handlers.single[request.method];
    if (single !== undefined) {
      try {
        const result = await single(request.params ?? {}, signal);
        return { result };
      } catch (error) {
        if (signal.aborted) {
          return { result: undefined, error: { code: 'CANCELED', message: 'canceled by peer' } };
        }
        return { result: undefined, error: toRpcError(error, request.method) };
      }
    }
    const streamHandler = this.handlers.stream[request.method];
    if (streamHandler !== undefined) {
      const stream = streamHandler(request.params ?? {}, signal);
      return { result: undefined, stream };
    }
    return {
      result: undefined,
      error: { code: 'METHOD_NOT_FOUND', message: `unknown method: ${request.method}` },
    };
  }

  methods(): string[] {
    return [...Object.keys(this.handlers.single), ...Object.keys(this.handlers.stream)].sort();
  }
}

function toRpcError(error: unknown, method: string): RpcError {
  if (error instanceof RpcMethodError) {
    return { code: error.rpcCode, message: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { code: 'INTERNAL', message: `${method}: ${message}` };
}

export function decodeLine(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return { jsonrpc: RPC_VERSION, id: -1, error: { code: 'INVALID_JSON', message: 'invalid frame' } };
  }
}

export function encodeResponse(id: number, result: unknown, final = false): string {
  const body: RpcResponse = final ? { jsonrpc: RPC_VERSION, id, final: true, result } : { jsonrpc: RPC_VERSION, id, result };
  return JSON.stringify(body);
}

export function encodeError(id: number, code: string, message: string): string {
  return JSON.stringify({ jsonrpc: RPC_VERSION, id, error: { code, message } });
}

/**
 * Frame IO contract implemented by each transport. Decoupled so the state
 * machine below is testable in-process with in-memory streams.
 */
export interface FrameIO {
  /** Must resolve when the underlying channel closes (EOF / socket close). */
  readLine(): AsyncIterable<string>;
  writeLine(line: string): void;
  onClose(handler: () => void): void;
}

/**
 * Auth + dispatch + stream/cancel state machine shared by stdio and
 * named-pipe transports. Resolves once the channel closes.
 *
 * RPC requests are dispatched concurrently: the read loop must never block on
 * an in-flight handler, otherwise a `cancel` frame would queue behind the very
 * request it targets (observed in the M0-006 matrix: stdio/pipe cancel_ok was
 * false before this fix, http true). Responses are routed by `id`, so the
 * order between different requests is unobservable.
 */
export async function serveLineFrames(io: FrameIO, dispatcher: Dispatcher, token: string): Promise<void> {
  let authenticated = false;
  const active = new Map<number, AbortController>();
  const inFlight = new Set<Promise<void>>();
  io.onClose(() => {
    for (const controller of active.values()) controller.abort();
    active.clear();
  });

  for await (const line of io.readLine()) {
    const value = decodeLine(line);

    if (!authenticated) {
      if (isAuthFrame(value)) {
        if (value.token === token) {
          authenticated = true;
          io.writeLine(encodeResponse(-1, { authenticated: true }));
        } else {
          io.writeLine(encodeError(-1, 'UNAUTHORIZED', 'invalid session token'));
          return;
        }
      } else {
        io.writeLine(encodeError(-1, 'UNAUTHORIZED', 'expected auth frame'));
        return;
      }
      continue;
    }

    if (isCancelRequest(value)) {
      active.get(value.params.id)?.abort();
      continue;
    }

    if (!isRpcRequest(value)) continue;

    const controller = new AbortController();
    active.set(value.id, controller);
    // Do not await here: the read loop must stay free to consume control
    // frames (cancel) while a long handler is running.
    const task = emitDispatch(io, dispatcher, value, controller, active);
    inFlight.add(task);
    // A failing task must still be drained from inFlight without surfacing an
    // unhandled rejection; write errors on a closed channel are benign here.
    void task.catch(() => {}).then(() => inFlight.delete(task));
  }

  for (const controller of active.values()) controller.abort();
  active.clear();
  await Promise.allSettled([...inFlight]);
}

async function emitDispatch(
  io: FrameIO,
  dispatcher: Dispatcher,
  value: RpcRequest,
  controller: AbortController,
  active: Map<number, AbortController>,
): Promise<void> {
  const result = await dispatcher.dispatch(value, controller.signal);
  active.delete(value.id);

  if (result.error !== undefined) {
    io.writeLine(encodeError(value.id, result.error.code, result.error.message));
    return;
  }

  if (result.stream !== undefined) {
    let count = 0;
    let canceled = false;
    try {
      for await (const chunk of result.stream) {
        if (controller.signal.aborted) {
          canceled = true;
          break;
        }
        count += 1;
        io.writeLine(encodeResponse(value.id, chunk));
      }
    } catch {
      canceled = true;
    }
    io.writeLine(encodeResponse(value.id, { done: true, count, canceled }, true));
    return;
  }

  io.writeLine(encodeResponse(value.id, result.result));
}