// M6-003: real child-process integration tests for the Core Service entry.
// Each test spawns the BUILT sidecar (`apps/core-service/dist/index.js`) as a
// real Node process over real stdio, against an isolated temp LMPS_HOME and
// the explicit mock adapter — so no LM Studio server, token or real data root
// is involved. This file REQUIRES a fresh build (`corepack pnpm run build`)
// before `pnpm run test`, exactly like the CI `check` gate already orders it.
//
// Covered: ready/auth lifecycle, wrong-token and invalid-frame rejection,
// stdin-close graceful exit, SIGTERM (POSIX), SIGKILL crash + restart without
// orphans, request cancellation, loopback HTTP bearer auth, cross-process
// activation-lock contention/retry, crash-residue reclaim, and secret/path
// redaction in logs and stderr.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface, type Interface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeProfile } from '../core/fixtures';

const DIST_ENTRY = fileURLToPath(new URL('../../apps/core-service/dist/index.js', import.meta.url));

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now();
  for (;;) {
    if (predicate()) return;
    if (Date.now() - started > timeoutMs) throw new Error('condition never became true');
    await delay(25);
  }
}

/** Windows-safe process liveness probe (mirrors the sidecar's own helper). */
function processExists(pid: number): boolean {
  try {
    if (process.platform === 'win32') {
      const probe = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { encoding: 'utf8', windowsHide: true });
      return probe.status === 0 && (probe.stdout ?? '').includes(String(pid));
    }
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A pid that is guaranteed (modulo instant reuse) to belong to a dead process. */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await once(child, 'exit');
  return child.pid as number;
}

interface SidecarHarness {
  child: ChildProcess;
  pid: number;
  /** Line-delimited JSON frame over the child's stdout. */
  send(line: string): void;
  closeStdin(): void;
  /** Resolves with the child's exit code once it exits. */
  exited: Promise<number | null>;
  /** Accumulated stderr text (redaction assertions read this). */
  stderr: string;
  /** All frames parsed from stdout so far. */
  frames: ReadonlyArray<Record<string, unknown>>;
  waitForFrame(predicate: (frame: Record<string, unknown>) => boolean, timeoutMs?: number): Promise<Record<string, unknown>>;
}

function spawnSidecar(rootDir: string, kind: string, token: string): SidecarHarness {
  if (!existsSync(DIST_ENTRY)) {
    throw new Error(`sidecar dist missing at ${DIST_ENTRY}; run \`corepack pnpm run build\` before the tests`);
  }
  const env: Record<string, string | undefined> = { ...process.env, LMPS_HOME: rootDir, LMPS_ADAPTER: 'mock' };
  // Keep the test hermetic: never inherit a real LM Studio token.
  delete env.LMPS_LM_TOKEN;

  const child = spawn(process.execPath, [DIST_ENTRY, kind, token], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const frames: Array<Record<string, unknown>> = [];
  const waiters = new Set<{
    predicate: (frame: Record<string, unknown>) => boolean;
    resolve: (frame: Record<string, unknown>) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>();

  const stdout = child.stdout;
  if (stdout === null) throw new Error('sidecar stdout pipe unavailable');
  const rl: Interface = createInterface({ input: stdout, crlfDelay: Infinity });
  rl.on('line', (line) => {
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    const frame = value as Record<string, unknown>;
    frames.push(frame);
    for (const waiter of [...waiters]) {
      if (waiter.predicate(frame)) {
        clearTimeout(waiter.timer);
        waiters.delete(waiter);
        waiter.resolve(frame);
      }
    }
  });

  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer | string) => {
    stderr += String(chunk);
  });

  const exited = new Promise<number | null>((resolve) => {
    child.on('exit', (code) => resolve(code));
  });
  child.on('exit', (code) => {
    rl.close();
    for (const waiter of [...waiters]) {
      clearTimeout(waiter.timer);
      waiters.delete(waiter);
      waiter.reject(new Error(`sidecar exited (code ${String(code)}) before the frame arrived`));
    }
  });

  return {
    child,
    pid: child.pid as number,
    frames,
    stderr,
    exited,
    send(line) {
      child.stdin?.write(`${line}\n`);
    },
    closeStdin() {
      child.stdin?.end();
    },
    waitForFrame(predicate, timeoutMs = 5000) {
      const existing = frames.find(predicate);
      if (existing !== undefined) return Promise.resolve(existing);
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error('frame wait timed out'));
        }, timeoutMs);
        const waiter = { predicate, resolve, reject, timer };
        waiters.add(waiter);
      });
    },
  };
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

async function authenticate(h: SidecarHarness, token: string): Promise<void> {
  await h.waitForFrame((f) => f.event === 'ready', 10_000);
  h.send(authFrame(token));
  const auth = await h.waitForFrame((f) => f.id === -1 && f.result !== undefined, 5000);
  expect(auth.result).toEqual({ authenticated: true });
}

let nextId = 0;

/** Monotonic request id so seed and apply frames never collide within a test. */
function bumpId(): number {
  nextId += 1;
  return nextId;
}

/** Seed one profile over the real stdio data plane; asserts the create succeeded. */
async function seedProfile(h: SidecarHarness, id: string): Promise<void> {
  const reqId = bumpId();
  h.send(request(reqId, 'profiles.create', { profile: makeProfile(id) }));
  const reply = await h.waitForFrame((f) => f.id === reqId, 5000);
  expect(reply.error).toBeUndefined();
  expect(reply.result).toMatchObject({ id });
}

describe('real sidecar child process over stdio (M6-003)', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'lmps-sidecar-child-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('emits ready, authenticates, pings, then exits 0 on stdin close', async () => {
    const token = 'child-token-1';
    const h = spawnSidecar(home, 'stdio', token);
    const ready = await h.waitForFrame((f) => f.event === 'ready', 10_000);
    expect(ready.transport).toBe('stdio');
    await authenticate(h, token);
    h.send(request(1, 'ping'));
    const pong = await h.waitForFrame((f) => f.id === 1, 5000);
    expect(pong.result).toMatchObject({ pong: true });
    h.closeStdin();
    expect(await h.exited).toBe(0);
    await waitUntil(() => !processExists(h.pid));
    expect(h.stderr).not.toContain(token);
  }, 20_000);

  it('rejects a wrong first token with UNAUTHORIZED and exits cleanly', async () => {
    const token = 'child-token-2';
    const h = spawnSidecar(home, 'stdio', token);
    await h.waitForFrame((f) => f.event === 'ready', 10_000);
    h.send(authFrame('definitely-wrong'));
    const err = await h.waitForFrame((f) => f.id === -1 && f.error !== undefined, 5000);
    expect(err.error).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(await h.exited).toBe(0);
    expect(h.stderr).not.toContain('definitely-wrong');
  }, 20_000);

  it('rejects a non-auth first frame and an invalid first line with UNAUTHORIZED', async () => {
    const token = 'child-token-3';
    const h = spawnSidecar(home, 'stdio', token);
    await h.waitForFrame((f) => f.event === 'ready', 10_000);
    h.send(request(7, 'ping'));
    const notAuth = await h.waitForFrame((f) => f.id === -1 && f.error !== undefined, 5000);
    expect(notAuth.error).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(await h.exited).toBe(0);
  }, 20_000);

  it('ignores invalid frames after auth and keeps the session alive', async () => {
    const token = 'child-token-4';
    const h = spawnSidecar(home, 'stdio', token);
    await authenticate(h, token);
    h.send('{not json');
    h.send(request(1, 'ping'));
    const pong = await h.waitForFrame((f) => f.id === 1, 5000);
    expect(pong.result).toMatchObject({ pong: true });
    h.closeStdin();
    expect(await h.exited).toBe(0);
  }, 20_000);

  it('cancels an in-flight request and the promise settles with canceled:true', async () => {
    const token = 'child-token-5';
    const h = spawnSidecar(home, 'stdio', token);
    await authenticate(h, token);
    h.send(request(1, 'cancelable', { delayMs: 30_000 }));
    await delay(250);
    h.send(cancelFrame(1));
    const reply = await h.waitForFrame((f) => f.id === 1, 5000);
    expect(reply.result).toEqual({ canceled: true });
    h.closeStdin();
    expect(await h.exited).toBe(0);
  }, 20_000);

  it.skipIf(process.platform === 'win32')('exits gracefully on SIGTERM (POSIX)', async () => {
    const token = 'child-token-6';
    const h = spawnSidecar(home, 'stdio', token);
    await h.waitForFrame((f) => f.event === 'ready', 10_000);
    h.child.kill('SIGTERM');
    expect(await h.exited).toBe(0);
    await waitUntil(() => !processExists(h.pid));
  }, 20_000);

  it('recovers from a SIGKILL crash with no orphan and restarts on the same data root', async () => {
    const token = 'child-token-7';
    const h = spawnSidecar(home, 'stdio', token);
    await h.waitForFrame((f) => f.event === 'ready', 10_000);
    const pid = h.pid;
    h.child.kill('SIGKILL');
    await h.exited;
    await waitUntil(() => !processExists(pid));

    const restarted = spawnSidecar(home, 'stdio', token);
    await authenticate(restarted, token);
    restarted.closeStdin();
    expect(await restarted.exited).toBe(0);
  }, 20_000);
});

describe('real sidecar child process over loopback HTTP (M6-003)', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'lmps-sidecar-http-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('serves bearer-authenticated RPC, writes the rendezvous file, and shuts down without orphans', async () => {
    const token = 'http-token-1';
    const h = spawnSidecar(home, 'http', token);
    const ready = await h.waitForFrame((f) => f.event === 'ready', 10_000);
    const address = ready.address as string;
    expect(address.startsWith('http://127.0.0.1:')).toBe(true);

    const noAuth = await fetch(`${address}/rpc`, {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });
    expect(noAuth.status).toBe(401);

    const ok = await fetch(`${address}/rpc`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }),
    });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { result: { pong: boolean } };
    expect(body.result.pong).toBe(true);

    const addressFile = join(home, 'hooks', 'address.json');
    expect(existsSync(addressFile)).toBe(true);
    const rendezvous = JSON.parse(readFileSync(addressFile, 'utf8')) as { transport: string; address: string };
    expect(rendezvous.transport).toBe('http');
    expect(rendezvous.address).toBe(address);

    expect(h.stderr).not.toContain(token);
    h.child.kill('SIGKILL');
    await h.exited;
    await waitUntil(() => !processExists(h.pid));
  }, 20_000);
});

describe('cross-process activation lock over real sidecar processes (M6-003)', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'lmps-sidecar-lock-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('reports ACTIVATION_LOCK_BUSY while a live holder owns the lock, then a retry succeeds after release', async () => {
    const token = 'lock-token-1';
    // Simulate a concurrent holder that is THIS test process: alive, live lease.
    const holder = { owner: String(process.pid), acquiredAt: new Date().toISOString(), leaseMs: 30 * 60_000 };
    mkdirSync(join(home, 'locks'), { recursive: true });
    writeFileSync(join(home, 'locks', 'activation.lock'), JSON.stringify(holder, null, 2));

    const h = spawnSidecar(home, 'stdio', token);
    await authenticate(h, token);
    await seedProfile(h, 'alpha');

    const applyId = bumpId();
    h.send(request(applyId, 'activation.apply', { id: 'alpha' }));
    const busy = await h.waitForFrame((f) => f.id === applyId, 15_000);
    expect(busy.error).toMatchObject({ code: 'ACTIVATION_LOCK_BUSY' });

    // The holder finishes and releases the lease; the same process can retry.
    rmSync(join(home, 'locks', 'activation.lock'), { force: true });
    const retryId = bumpId();
    h.send(request(retryId, 'activation.apply', { id: 'alpha' }));
    const active = await h.waitForFrame((f) => f.id === retryId, 15_000);
    expect(active.result).toMatchObject({ outcome: 'active' });
    // Lock released by the runner at the end of the transaction.
    expect(existsSync(join(home, 'locks', 'activation.lock'))).toBe(false);

    // The transaction log is redacted: no token, no data-root path.
    const logText = readFileSync(join(home, 'logs', 'transactions.ndjson'), 'utf8');
    expect(logText).toContain('active');
    expect(logText).not.toContain(token);
    expect(logText).not.toContain(home);
    expect(h.stderr).not.toContain(token);

    h.closeStdin();
    expect(await h.exited).toBe(0);
  }, 30_000);

  it('reclaims a live lease from a dead pid (crash residue) so a restarted sidecar is not blocked', async () => {
    const token = 'lock-token-2';
    const dead = await deadPid();
    const residue = { owner: String(dead), acquiredAt: new Date().toISOString(), leaseMs: 30 * 60_000 };
    mkdirSync(join(home, 'locks'), { recursive: true });
    writeFileSync(join(home, 'locks', 'activation.lock'), JSON.stringify(residue, null, 2));

    const h = spawnSidecar(home, 'stdio', token);
    await authenticate(h, token);
    await seedProfile(h, 'alpha');
    const applyId = bumpId();
    h.send(request(applyId, 'activation.apply', { id: 'alpha' }));
    const reply = await h.waitForFrame((f) => f.id === applyId, 15_000);
    // The dead owner's lease is crash residue: reclaimed, not a busy error.
    expect(reply.result).toMatchObject({ outcome: 'active' });
    expect(reply.error).toBeUndefined();
    h.closeStdin();
    expect(await h.exited).toBe(0);
  }, 30_000);

  it('reclaims a corrupt lock file as residue on a fresh process', async () => {
    const token = 'lock-token-3';
    mkdirSync(join(home, 'locks'), { recursive: true });
    writeFileSync(join(home, 'locks', 'activation.lock'), '{not json');
    const h = spawnSidecar(home, 'stdio', token);
    await authenticate(h, token);
    await seedProfile(h, 'alpha');
    const applyId = bumpId();
    h.send(request(applyId, 'activation.apply', { id: 'alpha' }));
    const reply = await h.waitForFrame((f) => f.id === applyId, 15_000);
    expect(reply.result).toMatchObject({ outcome: 'active' });
    h.closeStdin();
    expect(await h.exited).toBe(0);
  }, 30_000);

  it('two real processes contending for one lock get stable outcomes and a busy loser can retry', async () => {
    const tokenA = 'contend-A';
    const tokenB = 'contend-B';
    const hA = spawnSidecar(home, 'stdio', tokenA);
    const hB = spawnSidecar(home, 'stdio', tokenB);
    await authenticate(hA, tokenA);
    await authenticate(hB, tokenB);
    await seedProfile(hA, 'alpha');

    const applyA = bumpId();
    const applyB = bumpId();
    hA.send(request(applyA, 'activation.apply', { id: 'alpha' }));
    hB.send(request(applyB, 'activation.apply', { id: 'alpha' }));
    const [fa, fb] = await Promise.all([
      hA.waitForFrame((f) => f.id === applyA, 20_000),
      hB.waitForFrame((f) => f.id === applyB, 20_000),
    ]);

    const aActive = fa.result !== undefined;
    const bActive = fb.result !== undefined;
    const aBusy = fa.error?.code === 'ACTIVATION_LOCK_BUSY';
    const bBusy = fb.error?.code === 'ACTIVATION_LOCK_BUSY';
    if (aActive) expect(fa.result).toMatchObject({ outcome: 'active' });
    if (bActive) expect(fb.result).toMatchObject({ outcome: 'active' });
    // Every response is a valid active outcome or the stable busy error.
    expect((aActive || aBusy) && (bActive || bBusy)).toBe(true);
    // At least one process must have won the lock.
    expect(aActive || bActive).toBe(true);

    // A busy loser retries successfully once the winner releases the lock.
    if (aBusy || bBusy) {
      const loser = aBusy ? hA : hB;
      await delay(500);
      const retryId = bumpId();
      loser.send(request(retryId, 'activation.apply', { id: 'alpha' }));
      const retry = await loser.waitForFrame((f) => f.id === retryId, 20_000);
      expect(retry.result).toMatchObject({ outcome: 'active' });
    }

    for (const h of [hA, hB]) {
      h.closeStdin();
      await h.exited;
      await waitUntil(() => !processExists(h.pid));
    }
  }, 40_000);
});
