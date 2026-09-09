// policy-scan:fixture — throwaway transport peer tokens ('t-http'/'t-pipe'); exemption in scripts/lib/policy-scan-exemptions.json
// Deterministic transport tests for the core-service sidecar (M0-006).
// The protocol state machine is exercised over an in-memory FrameIO; the HTTP
// and named-pipe transports are integration-tested against real servers on
// loopback. probeCapabilities/adapterProbe are NOT called here, so no real LM
// Studio instance, token or local files are involved.
import { connect as netConnect, type Socket } from 'node:net';
import { createInterface, type Interface } from 'node:readline';
import { describe, expect, it } from 'vitest';

import { createHandlers } from '../../apps/core-service/src/handlers.ts';
import { Dispatcher, type FrameIO, serveLineFrames } from '../../apps/core-service/src/protocol.ts';
import { startHttpServer } from '../../apps/core-service/src/transports/http-rpc.ts';
import { startPipeServer, type PipeOptions } from '../../apps/core-service/src/transports/pipe-rpc.ts';
import type { TransportServer } from '../../apps/core-service/src/transports/types.ts';
import type { OpenAiProxySeam } from '../../apps/core-service/src/wiring.ts';

function dispatcherToken(): Dispatcher {
  const handlers = createHandlers({ lmBaseUrl: undefined, lmToken: null, lmsBin: undefined });
  return new Dispatcher(handlers);
}

// ---------------------------------------------------------------------------
// In-memory state machine (protocol.ts)
// ---------------------------------------------------------------------------

class LinesIO implements FrameIO {
  output: string[] = [];
  private onCloseHandler: (() => void) | undefined;

  constructor(private readonly input: string[]) {}

  async *readLine(): AsyncIterable<string> {
    for (const line of this.input) yield line;
  }

  writeLine(line: string): void {
    this.output.push(line);
  }

  onClose(handler: () => void): void {
    this.onCloseHandler = handler;
  }
}

/** Feed lines, wait for the state machine to drain, return captured output. */
async function serveInput(lines: string[]): Promise<LinesIO> {
  const io = new LinesIO(lines);
  await serveLineFrames(io, dispatcherToken(), 't-state');
  return io;
}

function authFrame(token: string): string {
  return JSON.stringify({ jsonrpc: '2.0', auth: true, token });
}

function request(id: number, method: string, params: Record<string, unknown> = {}): string {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params });
}

function cancelFrame(id: number): string {
  return JSON.stringify({ jsonrpc: '2.0', method: 'cancel', params: { id } });
}

function findId(frames: string[], id: number): Record<string, unknown> {
  const hit = frames
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .find((frame) => frame['id'] === id);
  if (hit === undefined) throw new Error(`no frame with id ${id}: ${frames.join(' | ')}`);
  return hit;
}

describe('serveLineFrames state machine (protocol.ts)', () => {
  it('authenticates a valid first frame', async () => {
    const io = await serveInput([authFrame('t-state')]);
    const reply = findId(io.output, -1);
    expect(reply['result']).toEqual({ authenticated: true });
  });

  it('rejects a wrong token and closes the session', async () => {
    const io = await serveInput([authFrame('wrong')]);
    const reply = findId(io.output, -1);
    expect(reply['error']).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rejects the first frame when it is not an auth frame', async () => {
    const io = await serveInput([request(7, 'ping')]);
    const reply = findId(io.output, -1);
    expect(reply['error']).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it(
    'cancels an in-flight request with a parallel cancel frame (M0-006 regression: ' +
      'the read loop must not block on the handler it targets)',
    async () => {
      const io = new LinesIO([authFrame('t-state'), request(1, 'cancelable', { delayMs: 100_000 }), cancelFrame(1)]);
      await serveLineFrames(io, dispatcherToken(), 't-state');
      const reply = findId(io.output, 1);
      expect(reply['result']).toEqual({ canceled: true });
    },
    5000,
  );

  it('streams chunks in order and terminates with a final frame', async () => {
    const io = new LinesIO([authFrame('t-state'), request(1, 'stream', { count: 5 })]);
    await serveLineFrames(io, dispatcherToken(), 't-state');
    const frames = io.output.map((line) => JSON.parse(line) as Record<string, unknown>);
    const chunkFrames = frames.filter((f) => f['id'] === 1 && f['final'] === undefined);
    expect(chunkFrames.map((f) => (f['result'] as { chunk: number }).chunk)).toEqual([0, 1, 2, 3, 4]);
    const final = frames.filter((f) => f['id'] === 1 && f['final'] === true)[0];
    expect(final!['result']).toMatchObject({ done: true, count: 5, canceled: false });
  });

  it('keeps the session alive after a failed method (error frame, not disconnect)', async () => {
    const io = new LinesIO([authFrame('t-state'), request(1, 'nope'), request(2, 'ping')]);
    await serveLineFrames(io, dispatcherToken(), 't-state');
    const err = findId(io.output, 1);
    expect(err['error']).toMatchObject({ code: 'METHOD_NOT_FOUND' });
    const ok = findId(io.output, 2);
    expect(ok['result']).toMatchObject({ pong: true });
  });
});

// ---------------------------------------------------------------------------
// Loopback HTTP transport
// ---------------------------------------------------------------------------

describe('loopback HTTP transport', () => {
  async function startHttp(): Promise<TransportServer> {
    return startHttpServer({ token: 't-http', dispatcher: dispatcherToken() });
  }

  it('rejects unauthenticated requests with 401', async () => {
    const server = await startHttp();
    try {
      const address = server.address();
      const response = await fetch(`${address}/rpc`, {
        method: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
      });
      expect(response.status).toBe(401);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe('UNAUTHORIZED');
    } finally {
      await server.close();
    }
  });

  it('answers ping with a pong over /rpc', async () => {
    const server = await startHttp();
    try {
      const response = await fetch(`${server.address()}/rpc`, {
        method: 'POST',
        headers: { authorization: 'Bearer t-http' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { id: number; result: { pong: boolean } };
      expect(body.id).toBe(1);
      expect(body.result.pong).toBe(true);
    } finally {
      await server.close();
    }
  });

  it('streams chunked JSON lines and closes with a final frame', async () => {
    const server = await startHttp();
    try {
      const response = await fetch(`${server.address()}/rpc/stream`, {
        method: 'POST',
        headers: { authorization: 'Bearer t-http' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'stream', params: { count: 5 } }),
      });
      const lines = (await response.text()).trim().split('\n').map((l) => JSON.parse(l) as { id: number; final?: boolean; result: { chunk?: number; count?: number } });
      expect(lines.filter((l) => l.id === 2 && l.final === undefined)).toHaveLength(5);
      const final = lines.filter((l) => l.id === 2 && l.final === true)[0];
      expect(final!.result).toMatchObject({ done: true, count: 5, canceled: false });
    } finally {
      await server.close();
    }
  });

  it('cancels an in-flight cancelable through /rpc/cancel', async () => {
    const server = await startHttp();
    try {
      const address = server.address();
      const pending = fetch(`${address}/rpc`, {
        method: 'POST',
        headers: { authorization: 'Bearer t-http' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'cancelable', params: { delayMs: 100_000 } }),
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const cancel = await fetch(`${address}/rpc/cancel`, {
        method: 'POST',
        headers: { authorization: 'Bearer t-http' },
        body: JSON.stringify({ id: 3 }),
      });
      const cancelAck = (await cancel.json()) as { canceled: boolean };
      expect(cancelAck.canceled).toBe(true);
      const reply = (await pending) as unknown as Response;
      const body = (await reply.json()) as { id: number; result: { canceled: boolean } };
      expect(body.result.canceled).toBe(true);
    } finally {
      await server.close();
    }
  }, 10_000);
});

// ---------------------------------------------------------------------------
// OpenAI-compatible proxy routes (M4-002)
// ---------------------------------------------------------------------------

/**
 * Scripted proxy front: the transport's job is body/header/session parsing and
 * SSE framing, so this seam only proves the wire contract (token gate, session
 * header delivery, SSE content-type / [DONE] terminator, 400 on oversized
 * bodies, 404 on unknown /v1 routes) without re-exercising the orchestrator —
 * the orchestrator is covered end-to-end in proxy-plane.test.ts.
 */
function scriptedProxySeam(): { seam: OpenAiProxySeam; calls: Array<{ sessionId: string | null; release: boolean }> } {
  const calls: Array<{ sessionId: string | null; release: boolean }> = [];
  const seam: OpenAiProxySeam = {
    async handleListModels() {
      return { status: 200, body: { object: 'list', data: [{ id: 'lmps://coder', object: 'model', owned_by: 'lmps' }] } };
    },
    async handleChatCompletions(requestValue, sessionId, release) {
      calls.push({ sessionId, release });
      if (release) return { status: 503, error: { code: 'SESSION_RELEASED', message: 'released' } };
      if (typeof requestValue === 'object' && requestValue !== null && (requestValue as Record<string, unknown>)['tools'] !== undefined) {
        return { status: 400, error: { code: 'UNSUPPORTED_CAPABILITY', message: 'tools not supported' } };
      }
      return {
        status: 200,
        sse: (async function* () {
          yield `data: ${JSON.stringify({ id: 'chatcmpl-1', choices: [{ delta: { content: `session=${String(sessionId)}` } }] })}\n\n`;
          yield 'data: [DONE]\n\n';
        })(),
      };
    },
  };
  return { seam, calls };
}

describe('OpenAI-compatible proxy routes (M4-002)', () => {
  async function startProxy(): Promise<{ server: TransportServer; calls: Array<{ sessionId: string | null; release: boolean }> }> {
    const { seam, calls } = scriptedProxySeam();
    const server = await startHttpServer({ token: 't-http', dispatcher: dispatcherToken(), openAi: seam });
    return { server, calls };
  }

  it('requires the bearer token on /v1/models too', async () => {
    const { server } = await startProxy();
    try {
      const response = await fetch(`${server.address()}/v1/models`);
      expect(response.status).toBe(401);
    } finally {
      await server.close();
    }
  });

  it('lists models over GET /v1/models', async () => {
    const { server } = await startProxy();
    try {
      const response = await fetch(`${server.address()}/v1/models`, {
        headers: { authorization: 'Bearer t-http' },
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { data: Array<{ id: string }> };
      expect(body.data[0]?.id).toBe('lmps://coder');
    } finally {
      await server.close();
    }
  });

  it('streams chat completions as text/event-stream and forwards the session header', async () => {
    const { server, calls } = await startProxy();
    try {
      const response = await fetch(`${server.address()}/v1/chat/completions`, {
        method: 'POST',
        headers: { authorization: 'Bearer t-http', 'content-type': 'application/json', 'x-session-id': 'sess-transport' },
        body: JSON.stringify({ model: 'lmps://coder', messages: [{ role: 'user', content: 'hi' }] }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      const text = await response.text();
      expect(text).toContain('"content":"session=sess-transport"');
      expect(text.endsWith('data: [DONE]\n\n')).toBe(true);
      expect(calls[0]).toEqual({ sessionId: 'sess-transport', release: false });
    } finally {
      await server.close();
    }
  });

  it('delivers the x-session-release flag to the seam as a 503 path', async () => {
    const { server, calls } = await startProxy();
    try {
      const response = await fetch(`${server.address()}/v1/chat/completions`, {
        method: 'POST',
        headers: { authorization: 'Bearer t-http', 'content-type': 'application/json', 'x-session-release': 'true' },
        body: JSON.stringify({ model: 'lmps://coder', messages: [{ role: 'user', content: 'hi' }] }),
      });
      expect(calls[0]?.release).toBe(true);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe('SESSION_RELEASED');
    } finally {
      await server.close();
    }
  });

  it('returns 404 for an unknown /v1 path and 400 for an oversized chat body', async () => {
    const { server } = await startProxy();
    try {
      const address = server.address();
      const missing = await fetch(`${address}/v1/embeddings`, {
        method: 'POST',
        headers: { authorization: 'Bearer t-http', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'lmps://coder', input: 'x' }),
      });
      expect(missing.status).toBe(404);

      // A body over the 1 MiB guard is refused — either a 400 or the server
      // tearing the connection down while the client is still uploading (the
      // destroy it does to stop the upload), never a 200.
      const oversized = 'x'.repeat((1 << 20) + 16);
      let status: number | string;
      try {
        const response = await fetch(`${address}/v1/chat/completions`, {
          method: 'POST',
          headers: { authorization: 'Bearer t-http', 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'lmps://coder', messages: [{ role: 'user', content: oversized }] }),
        });
        status = response.status;
      } catch {
        status = 'connection-reset';
      }
      expect(status === 400 || status === 'connection-reset').toBe(true);
    } finally {
      await server.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Named-pipe transport
// ---------------------------------------------------------------------------

describe('named-pipe transport', () => {
  let serial = 0;

  async function startPipe(): Promise<{ server: TransportServer; pipeName: string }> {
    serial += 1;
    const pipeName = `\\\\.\\pipe\\lmps-test-${process.pid}-${serial}`;
    const options: PipeOptions = { pipeName, token: 't-pipe', dispatcher: dispatcherToken() };
    const server = await startPipeServer(options);
    return { server, pipeName };
  }

  function connectPipe(pipeName: string): { socket: Socket; rl: Interface } {
    const socket = netConnect(pipeName);
    const rl = createInterface({ input: socket, crlfDelay: Infinity });
    return { socket, rl };
  }

  async function roundTrip(
    pipeName: string,
    frames: string[],
    resolveId: number,
  ): Promise<Array<Record<string, unknown>>> {
    const { socket, rl } = connectPipe(pipeName);
    const received: Array<Record<string, unknown>> = [];
    const done = new Promise<void>((resolve) => {
      rl.on('line', (line) => {
        const frame = JSON.parse(line) as Record<string, unknown>;
        received.push(frame);
        if (frame['id'] === resolveId) resolve();
      });
    });
    for (const frame of frames) socket.write(`${frame}\n`);
    await done;
    rl.close();
    socket.destroy();
    return received;
  }

  it('authenticates, then answers ping over the pipe', async () => {
    const { server, pipeName } = await startPipe();
    try {
      const received = await roundTrip(pipeName, [authFrame('t-pipe'), request(1, 'ping')], 1);
      const auth = received.find((f) => f['id'] === -1);
      expect(auth!['result']).toEqual({ authenticated: true });
      const ping = received.find((f) => f['id'] === 1);
      expect(ping!['result']).toMatchObject({ pong: true });
    } finally {
      await server.close();
    }
  });

  it('cancels an in-flight cancelable over the pipe', async () => {
    const { server, pipeName } = await startPipe();
    try {
      const received = await roundTrip(
        pipeName,
        [
          authFrame('t-pipe'),
          request(1, 'cancelable', { delayMs: 100_000 }),
          cancelFrame(1),
        ],
        1,
      );
      const reply = received.find((f) => f['id'] === 1);
      expect(reply!['result']).toEqual({ canceled: true });
    } finally {
      await server.close();
    }
  });

  it('closes the session on a wrong token', async () => {
    const { server, pipeName } = await startPipe();
    try {
      const received = await roundTrip(pipeName, [authFrame('nope')], -1);
      const auth = received.find((f) => f['id'] === -1);
      expect(auth!['error']).toMatchObject({ code: 'UNAUTHORIZED' });
    } finally {
      await server.close();
    }
  });
});