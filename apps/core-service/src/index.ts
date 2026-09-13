/**
 * Sidecar entry point (spike M0-006 + M3-002 data plane). The single wiring
 * module: resolves the startup settings from argv/env, builds the profile
 * store and the recommendation/benchmark seams, then starts the selected
 * transport and serves the shared RPC handlers.
 *
 * The LM token is a SECRET: it is read here from env and passed straight into
 * the adapter; it never reaches stdout, frames or logs. Human diagnostics go
 * to stderr only; stdout carries the machine rendezvous line.
 *
 * M6-003: startup settings are parsed by the pure resolveSidecarSettings
 * (settings.ts) so the entry is testable without a process; the activation and
 * benchmark locks carry this process's real pid as owner and probe owner
 * liveness on acquire, so a crashed sidecar's still-valid lease is reclaimed
 * by the restart instead of blocking it until lease expiry.
 */
import { randomBytes } from 'node:crypto';

import { SCHEMA_VERSION } from '@lmps/domain';
import {
  createNodeLmStudioEnv,
  resolveBaseUrl,
  type LmStudioEnv,
} from '@lmps/lmstudio-adapter';
import { createDefaultFsys, createDefaultProfileStore } from '@lmps/profile-store';

import { createHandlers } from './handlers.js';
import { isOwnerAlive } from './process-liveness.js';
import { Dispatcher } from './protocol.js';
import { resolveSidecarSettings, type SidecarEnv } from './settings.js';
import { startTransport, type TransportKind } from './transports/index.js';
import {
  createAliasSeam,
  createHookSeam,
  createOpenAiProxySeam,
  createSidecarActivationSeam,
  createSidecarBenchmarkSeam,
  createSidecarRecommendationSeam,
} from './wiring.js';

/**
 * Session token for the transport. Explicit argv/env wins (the desktop shell
 * always passes a per-spawn token); the http transport may instead fall back to
 * the persistent hook token, creating one on first use. There is NO hard-coded
 * fallback: stdio/pipe without a token refuse to start rather than silently
 * accepting a well-known secret.
 */
function resolveToken(
  kind: TransportKind,
  hookSeam: ReturnType<typeof createHookSeam>,
  explicit: string | undefined,
): string {
  if (explicit !== undefined) return explicit;
  if (kind === 'http') return hookSeam.readOrCreateToken(randomBytes(24).toString('hex'));
  throw new Error('stdio/pipe transports require a session token (argv[3] or LMPS_SIDECAR_TOKEN)');
}

async function main(): Promise<void> {
  const settings = resolveSidecarSettings(process.argv, process.env as SidecarEnv);
  const fs = createDefaultFsys();
  const hookSeam = createHookSeam(fs, { rootDir: settings.rootDir });
  const token = resolveToken(settings.kind, hookSeam, settings.token);

  const lmEnv: LmStudioEnv = createNodeLmStudioEnv({
    baseUrl: resolveBaseUrl(settings.lmBaseUrl),
    // SECRET by classification; only ever sent as an Authorization header.
    token: settings.lmToken,
    lmsBin: settings.lmsBin,
  });

  // Every sidecar process owns the lock with its REAL pid (process.pid exists
  // in the Node SEA too) and probes owner liveness on acquire, so a crashed
  // peer's lease is reclaimed on restart. The tray/CLI and benchmark all
  // contend on this one activation.lock.
  const owner = String(process.pid);
  const seams = {
    recommendation: createSidecarRecommendationSeam(fs, {
      lmEnv,
      selection: settings.selection,
      rootDir: settings.rootDir,
      owner,
    }),
    benchmark: createSidecarBenchmarkSeam(fs, {
      lmEnv,
      selection: settings.selection,
      rootDir: settings.rootDir,
      owner,
      isOwnerAlive,
    }),
    activation: createSidecarActivationSeam(fs, {
      lmEnv,
      selection: settings.selection,
      rootDir: settings.rootDir,
      owner,
      isOwnerAlive,
    }),
    hook: hookSeam,
    alias: createAliasSeam(fs, { rootDir: settings.rootDir }),
  } as const;

  // The proxy (M4-002) resolves the SAME store the RPC data plane drives, so
  // profiles edited over RPC are immediately addressable as virtual models.
  const store = createDefaultProfileStore(settings.rootDir);
  const openAiProxy = createOpenAiProxySeam(fs, {
    alias: seams.alias,
    store,
    lmEnv,
    selection: settings.selection,
    activation: seams.activation,
  });

  const handlers = createHandlers({
    lmBaseUrl: settings.lmBaseUrl,
    lmToken: settings.lmToken,
    lmsBin: settings.lmsBin,
    rootDir: settings.rootDir,
    store,
    recommendation: seams.recommendation,
    benchmark: seams.benchmark,
    activation: seams.activation,
    hook: seams.hook,
    alias: seams.alias,
  });

  const dispatcher = new Dispatcher(handlers);
  const server = await startTransport({
    kind: settings.kind,
    token,
    dispatcher,
    pipeName: settings.pipeName,
    port: settings.kind === 'http' ? settings.port : undefined,
    openAi: openAiProxy,
  });
  if (settings.kind === 'http') {
    hookSeam.writeAddress({
      schemaVersion: SCHEMA_VERSION,
      transport: 'http',
      address: server.address(),
      pid: process.pid,
      startedAt: new Date().toISOString(),
    });
  }
  // Register graceful-shutdown handlers BEFORE announcing ready: a supervisor
  // or test that receives the ready frame may signal immediately, and the
  // default SIGTERM/SIGINT behavior would kill the process without a clean
  // exit (a flaky CI race the M6-003 child-process test exposed).
  const shutdown = async (): Promise<void> => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  process.stdout.write(`${JSON.stringify({ event: 'ready', transport: settings.kind, address: server.address() })}\n`);

  await server.closed;
  process.exit(0);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`sidecar fatal: ${message}\n`);
  process.exit(1);
});
