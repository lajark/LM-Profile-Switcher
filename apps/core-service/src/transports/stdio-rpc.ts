/**
 * stdio JSON-RPC transport (spike M0-006). Line-delimited JSON over the
 * process stdio pair. Authentication: the peer sends an AuthFrame as its
 * first line; stdin close or channel end shuts the server down.
 */
import { createInterface } from 'node:readline';

import { serveLineFrames, type Dispatcher, type FrameIO } from '../protocol.js';
import type { TransportServer } from './types.js';

export interface StdioOptions {
  token: string;
  dispatcher: Dispatcher;
}

export async function startStdioServer(options: StdioOptions): Promise<TransportServer> {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });

  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  const io: FrameIO = {
    readLine: () => input[Symbol.asyncIterator](),
    writeLine: (line) => {
      process.stdout.write(`${line}\n`);
    },
    onClose: (handler) => {
      input.on('close', handler);
      input.on('error', handler);
    },
  };

  void serveLineFrames(io, options.dispatcher, options.token).then(
    () => resolveClosed(),
    () => resolveClosed(),
  );

  return {
    address: () => 'stdio',
    close: async () => {
      input.close();
      resolveClosed();
    },
    closed,
  };
}