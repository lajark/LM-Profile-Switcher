/**
 * Sidecar entry point (spike M0-006 + M3-002 data plane). The single wiring
 * module: reads the transport kind, session token and LM Studio connection
 * settings from argv and env, builds the profile store and the
 * recommendation/benchmark seams, then starts the selected transport and serves
 * the shared RPC handlers.
 *
 * The LM token is a SECRET: it is read here from env and passed straight into
 * the adapter; it never reaches stdout, frames or logs. Human diagnostics go
 * to stderr only; stdout carries the machine rendezvous line.
 */
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import { SCHEMA_VERSION } from '@lmps/domain';
import {
  createNodeLmStudioEnv,
  resolveBaseUrl,
  type AdapterSelection,
  type LmStudioEnv,
} from '@lmps/lmstudio-adapter';
import { createDefaultFsys, createDefaultProfileStore } from '@lmps/profile-store';

import { createHandlers } from './handlers.js';
import { Dispatcher } from './protocol.js';
import { startTransport, type TransportKind } from './transports/index.js';
import {
  createAliasSeam,
  createHookSeam,
  createOpenAiProxySeam,
  createSidecarActivationSeam,
  createSidecarBenchmarkSeam,
  createSidecarRecommendationSeam,
} from './wiring.js';

const KINDS: readonly string[] = ['stdio', 'pipe', 'http'];

function env(name: string): string | undefined {
  return process.env[name];
}

function readTransport(): TransportKind {
  const raw = process.argv[2] ?? env('LMPS_SIDECAR_TRANSPORT') ?? 'stdio';
  return KINDS.includes(raw) ? (raw as TransportKind) : 'stdio';
}

/** Same precedence as the CLI: LMPS_HOME → <home>/.lmps → . (M3-001). */
function resolveRootDir(): string {
  const home = env('USERPROFILE') ?? env('HOME') ?? '.';
  return env('LMPS_HOME') || join(home, '.lmps');
}

/**
 * `lms` executable path: CLI_SPEC documents LMPS_LMS_BIN; the pre-M3-002
 * scripts also honored LMPS_LM_BIN. Accept both so nothing already wired to the
 * older name breaks.
 */
function lmsBin(): string | undefined {
  return env('LMPS_LMS_BIN') ?? env('LMPS_LM_BIN');
}

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
  argvToken: string | undefined,
  envToken: string | undefined,
): string {
  const explicit = argvToken ?? envToken;
  if (explicit !== undefined) return explicit;
  if (kind === 'http') return hookSeam.readOrCreateToken(randomBytes(24).toString('hex'));
  throw new Error('stdio/pipe transports require a session token (argv[3] or LMPS_SIDECAR_TOKEN)');
}

/** Optional fixed loopback port; malformed values are a startup error, not a fallback. */
function parseHookPort(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`invalid LMPS_HOOK_PORT: ${raw}`);
  }
  return port;
}

async function main(): Promise<void> {
  const kind = readTransport();
  const fs = createDefaultFsys();
  const rootDir = resolveRootDir();
  const hookSeam = createHookSeam(fs, { rootDir });
  const token = resolveToken(kind, hookSeam, process.argv[3], env('LMPS_SIDECAR_TOKEN'));
  const pipeName = process.argv[4] ?? env('LMPS_SIDECAR_PIPE');
  const lmEnv: LmStudioEnv = createNodeLmStudioEnv({
    baseUrl: resolveBaseUrl(env('LMPS_LM_URL')),
    // SECRET by classification; only ever sent as an Authorization header.
    token: env('LMPS_LM_TOKEN') ?? null,
    lmsBin: lmsBin(),
  });
  // The explicit LMPS_ADAPTER=mock switch is the only way to select the demo
  // adapter; production defaults to auto and never silently flips to mock.
  const selection: AdapterSelection = env('LMPS_ADAPTER') === 'mock' ? 'mock' : 'auto';

  const seams = {
    // A single consistent host view plus the SAME activation.lock apply uses:
    // labelled 'sidecar' because the SEA has no process.pid. The tray/CLI and
    // benchmark all contend on this one lock.
    recommendation: createSidecarRecommendationSeam(fs, { lmEnv, selection, rootDir, owner: 'sidecar' }),
    benchmark: createSidecarBenchmarkSeam(fs, { lmEnv, selection, rootDir, owner: 'sidecar' }),
    activation: createSidecarActivationSeam(fs, { lmEnv, selection, rootDir, owner: 'sidecar' }),
    hook: hookSeam,
    alias: createAliasSeam(fs, { rootDir }),
  } as const;

  // The proxy (M4-002) resolves the SAME store the RPC data plane drives, so
  // profiles edited over RPC are immediately addressable as virtual models.
  const store = createDefaultProfileStore(rootDir);
  const openAiProxy = createOpenAiProxySeam(fs, {
    alias: seams.alias,
    store,
    lmEnv,
    selection,
    activation: seams.activation,
  });

  const handlers = createHandlers({
    lmBaseUrl: env('LMPS_LM_URL'),
    lmToken: env('LMPS_LM_TOKEN') ?? null,
    lmsBin: lmsBin(),
    rootDir,
    store,
    recommendation: seams.recommendation,
    benchmark: seams.benchmark,
    activation: seams.activation,
    hook: seams.hook,
    alias: seams.alias,
  });

  const dispatcher = new Dispatcher(handlers);
  const server = await startTransport({
    kind,
    token,
    dispatcher,
    pipeName,
    port: kind === 'http' ? parseHookPort(env('LMPS_HOOK_PORT')) : undefined,
    openAi: openAiProxy,
  });
  if (kind === 'http') {
    hookSeam.writeAddress({
      schemaVersion: SCHEMA_VERSION,
      transport: 'http',
      address: server.address(),
      pid: process.pid,
      startedAt: new Date().toISOString(),
    });
  }
  process.stdout.write(`${JSON.stringify({ event: 'ready', transport: kind, address: server.address() })}\n`);

  const shutdown = async (): Promise<void> => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  await server.closed;
  process.exit(0);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`sidecar fatal: ${message}\n`);
  process.exit(1);
});