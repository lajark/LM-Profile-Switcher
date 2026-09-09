/**
 * Transport selection for the sidecar (spike M0-006). The spike exists to
 * compare stdio, named pipe and loopback HTTP with evidence; the accepted
 * option is recorded in docs/adr/0003-sidecar-transport-and-packaging.md.
 */
import type { Dispatcher } from '../protocol.js';
import type { OpenAiProxySeam } from '../wiring.js';
import { startHttpServer } from './http-rpc.js';
import { startPipeServer } from './pipe-rpc.js';
import { startStdioServer } from './stdio-rpc.js';
import type { TransportKind, TransportServer } from './types.js';

export type { TransportKind, TransportServer } from './types.js';

export interface TransportStartOptions {
  kind: TransportKind;
  token: string;
  dispatcher: Dispatcher;
  pipeName?: string;
  /** Loopback http port (kind 'http'); defaults to a random OS-chosen port. */
  port?: number;
  /** OpenAI-compatible proxy front (M4-002); wired only for kind 'http'. */
  openAi?: OpenAiProxySeam;
}

export async function startTransport(options: TransportStartOptions): Promise<TransportServer> {
  const dispatcher = options.dispatcher;
  switch (options.kind) {
    case 'stdio':
      return startStdioServer({ token: options.token, dispatcher });
    case 'pipe':
      return startPipeServer({ pipeName: options.pipeName ?? randPipeName(), token: options.token, dispatcher });
    case 'http':
      return startHttpServer({ token: options.token, dispatcher, port: options.port, openAi: options.openAi });
  }
}

function randPipeName(): string {
  const suffix = Math.random().toString(36).slice(2, 10);
  return `\\\\.\\pipe\\lmps-${suffix}`;
}