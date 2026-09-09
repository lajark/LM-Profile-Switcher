import type { Dispatcher } from '../protocol.js';

export type TransportKind = 'stdio' | 'pipe' | 'http';

export interface TransportServer {
  /** Machine-readable rendezvous value: 'stdio', the pipe path, or a URL. */
  address(): string;
  close(): Promise<void>;
  /** Resolves when the underlying channel closes (EOF / server closed). */
  closed: Promise<void>;
}

export interface TransportOptions {
  token: string;
  dispatcher: Dispatcher;
  pipeName?: string;
}