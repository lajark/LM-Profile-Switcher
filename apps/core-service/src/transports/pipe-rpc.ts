/**
 * Named-pipe JSON-RPC transport (spike M0-006). Listens on a Windows named
 * pipe (\\.\pipe\<name>) and serves one line-framed RPC session per
 * connection. Authentication: each connection opens with an AuthFrame.
 */
import { createServer, type Socket } from 'node:net';
import { createInterface } from 'node:readline';

import { serveLineFrames, type Dispatcher, type FrameIO } from '../protocol.js';
import type { TransportServer } from './types.js';

export interface PipeOptions {
  pipeName: string;
  token: string;
  dispatcher: Dispatcher;
}

export async function startPipeServer(options: PipeOptions): Promise<TransportServer> {
  const { pipeName } = options;

  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    const input = createInterface({ input: socket, crlfDelay: Infinity });
    const io: FrameIO = {
      readLine: () => input[Symbol.asyncIterator](),
      writeLine: (line) => {
        socket.write(`${line}\n`);
      },
      onClose: (handler) => {
        socket.on('close', handler);
        socket.on('error', handler);
      },
    };
    void serveLineFrames(io, options.dispatcher, options.token).finally(() => {
      sockets.delete(socket);
      socket.destroy();
    });
  });

  server.on('error', (error) => {
    // Address-in-use or pipe gone: surface on stderr, keep the process alive
    // so a supervising parent sees a clean exit path via stdin close / signal.
    process.stderr.write(`pipe server error: ${error.message}\n`);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(pipeName, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  return {
    address: () => pipeName,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      if (server.listening) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      resolveClosed();
    },
    closed,
  };
}