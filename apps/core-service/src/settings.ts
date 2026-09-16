/**
 * Sidecar entrypoint settings (M6-003). Everything the sidecar needs to know
 * about its invocation is resolved here from argv/env so the wiring in
 * index.ts stays a thin composition and startup configuration is unit-testable
 * in isolation. PURE module: no Node built-in imports; argv/env are parameters.
 */
import type { TransportKind } from './transports/types.js';

export const SIDECAR_TRANSPORT_KINDS: readonly string[] = ['stdio', 'pipe', 'http'];

/** Env surface the sidecar reads (undefined values = unset). */
export interface SidecarEnv {
  LMPS_SIDECAR_TRANSPORT?: string;
  LMPS_SIDECAR_TOKEN?: string;
  LMPS_SIDECAR_PIPE?: string;
  LMPS_HOOK_PORT?: string;
  LMPS_HOME?: string;
  LMPS_LMS_BIN?: string;
  LMPS_LM_BIN?: string;
  LMPS_LM_URL?: string;
  LMPS_LM_TOKEN?: string;
  LMPS_ADAPTER?: string;
  LMPS_E2E_MOCK_HEALTHCHECK_FAIL_MODEL?: string;
  LMPS_E2E_MOCK_BENCHMARK_FAIL_MODEL?: string;
  LMPS_E2E_MOCK_BENCHMARK_GAP_MS?: string;
  USERPROFILE?: string;
  HOME?: string;
}

export interface SidecarSettings {
  /** Transport selected by argv[2] ?? LMPS_SIDECAR_TRANSPORT ?? 'stdio'. */
  kind: TransportKind;
  /** Session token: argv[3] ?? LMPS_SIDECAR_TOKEN (explicit wins). */
  token: string | undefined;
  /** Named-pipe path: argv[4] ?? LMPS_SIDECAR_PIPE (kind 'pipe'). */
  pipeName: string | undefined;
  /** Fixed loopback hook port from LMPS_HOOK_PORT; parsed only for kind 'http'. */
  port: number | undefined;
  /** Data root: LMPS_HOME ?? <home>/.lmps (same precedence as the CLI). */
  rootDir: string;
  /** lms executable: LMPS_LMS_BIN wins over the legacy LMPS_LM_BIN. */
  lmsBin: string | undefined;
  /** LM Studio REST base URL (raw); undefined → adapter default. */
  lmBaseUrl: string | undefined;
  /** LM Studio token (SECRET); null when unset. */
  lmToken: string | null;
  /** Adapter selection; 'mock' only when LMPS_ADAPTER === 'mock'. */
  selection: 'mock' | 'auto';
  /** Mock-only deterministic health-check failure target. */
  mockHealthCheckFailModel: string | undefined;
  /** Mock-only deterministic benchmark measurement failure target. */
  mockBenchmarkFailModel: string | undefined;
  /** Mock-only benchmark inter-delta delay. */
  mockBenchmarkGapMs: number | undefined;
}

/** Invalid transports silently fall back to stdio (same behavior as before). */
function readTransport(raw: string | undefined): TransportKind {
  if (raw !== undefined && SIDECAR_TRANSPORT_KINDS.includes(raw)) return raw as TransportKind;
  return 'stdio';
}

/** Optional fixed loopback port; malformed values are a startup error, not a fallback. */
function parseHookPort(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('invalid LMPS_HOOK_PORT: ' + raw);
  }
  return port;
}

/** Optional non-negative integer used only by deterministic Mock E2E seams. */
function parseOptionalNonNegativeInt(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 60000) {
    throw new Error('invalid LMPS_E2E_MOCK_BENCHMARK_GAP_MS: ' + raw);
  }
  return value;
}

export function resolveSidecarSettings(argv: readonly string[], env: SidecarEnv): SidecarSettings {
  const kind = readTransport(argv[2] ?? env.LMPS_SIDECAR_TRANSPORT);
  const home = env.USERPROFILE ?? env.HOME ?? '';
  const selection = env.LMPS_ADAPTER === 'mock' ? 'mock' : 'auto';
  return {
    kind,
    token: argv[3] ?? env.LMPS_SIDECAR_TOKEN,
    pipeName: argv[4] ?? env.LMPS_SIDECAR_PIPE,
    // The port is only meaningful for the http transport; a malformed value
    // with stdio/pipe is ignored, mirroring the pre-M6-003 behavior.
    port: kind === 'http' ? parseHookPort(env.LMPS_HOOK_PORT) : undefined,
    // Same precedence as the CLI: LMPS_HOME → <home>/.lmps → .lmps (the
    // relative form matches path.join('.', '.lmps') from the pre-M6-003 entry).
    rootDir: env.LMPS_HOME || (home === '' ? '.lmps' : `${home}/.lmps`),
    lmsBin: env.LMPS_LMS_BIN ?? env.LMPS_LM_BIN,
    lmBaseUrl: env.LMPS_LM_URL,
    lmToken: env.LMPS_LM_TOKEN ?? null,
    selection,
    mockHealthCheckFailModel: selection === 'mock' ? env.LMPS_E2E_MOCK_HEALTHCHECK_FAIL_MODEL : undefined,
    mockBenchmarkFailModel: selection === 'mock' ? env.LMPS_E2E_MOCK_BENCHMARK_FAIL_MODEL : undefined,
    mockBenchmarkGapMs: selection === 'mock' ? parseOptionalNonNegativeInt(env.LMPS_E2E_MOCK_BENCHMARK_GAP_MS) : undefined,
  };
}
