/**
 * Injection seams for the CLI (M1-004). Anything that touches Node, the network
 * or LM Studio enters through these ports so the command modules stay pure and
 * fixture-testable. models/current/snapshot run on their own ports; production
 * `deps.ts` wires them to null until M1-003/M1-005, and the commands honestly
 * report CAPABILITY_UNSUPPORTED (exit 6) instead of pretending to be live.
 */
import type {
  ActivationLock,
  ActivationRuntime,
  ActivationRunner,
  BenchmarkService,
  EstimatePort,
  RecommendationService,
  RunnerContext,
  TransactionLogSink,
} from '@lmps/core';
import type { HookRulesDocument, VirtualAliasesDocument } from '@lmps/domain';
import type { ProbeEnv } from '@lmps/hardware';
import type { Locale, TranslationFunction } from '@lmps/i18n';
import type { ProfileStore } from '@lmps/profile-store';

import type { ExitCode } from './exit-codes.js';

export interface ModelSummary {
  key: string;
  family: string | null;
  quantization: string | null;
  parametersB: number | null;
}

export interface DiscoveryPort {
  listModels(): Promise<ModelSummary[]>;
}

export interface ActiveState {
  profileId: string | null;
  modelKey: string | null;
  since: string | null;
}

export interface StatePort {
  getActive(): Promise<ActiveState>;
}

export interface SnapshotData {
  profileId: string;
  at: string;
  captured: Record<string, unknown>;
}

export interface SnapshotPort {
  capture(): Promise<SnapshotData>;
}

/**
 * Activation transaction ports (M1-005): the LM Studio runtime behind a switch,
 * the mutual-exclusion lock, the estimator, the redacted log sink and the
 * injected context. Production `deps.ts` keeps this null until the adapter
 * lands (M0-005/M1-003); `apply` then honestly reports capability unsupported.
 */
export interface ActivationSeam {
  runtime: ActivationRuntime;
  lock: ActivationLock;
  estimate: EstimatePort;
  log: TransactionLogSink;
  context: RunnerContext;
  /** Prebuilt runner; tests stub the whole state machine with it. */
  runner?: ActivationRunner;
}

/**
 * Candidate optimizer seam (M2-002): the core `RecommendationService` plus the
 * audit sink that records every `optimize --yes` save. Production `deps.ts`
 * wires it; a null seam makes `optimize` honestly report capability unsupported.
 */
export interface RecommendationSeam {
  service: RecommendationService;
  /** Appends one redacted optimization-application record (ndjson line). */
  audit(entry: Record<string, unknown>): void;
}

/**
 * Benchmark seam (M2-003): the core `BenchmarkService`. Every run result is
 * persisted by the service's log sink (ndjson) inside the seam, so the command
 * only calls `service.run`; a null seam makes `benchmark` honestly report
 * capability unsupported (exit 6).
 */
export interface BenchmarkSeam {
  service: BenchmarkService;
}

/**
 * Local hook configuration port (M4-001): the files the core-service http
 * transport lives on — rules (app/task → profile mapping), the persistent
 * Bearer token and the loopback rendezvous file. Purely local; the CLI never
 * talks to LM Studio for these. A corrupt rules file surfaces as a USAGE
 * CliError so `lmps hook rules validate` can report the issues instead.
 */
/**
 * Virtual-alias configuration port (M4-002): the single file the core-service
 * OpenAI-compatible proxy lives on — `<rootDir>/hooks/aliases.json`. Purely
 * local; the CLI never talks to LM Studio for this. A corrupt aliases file
 * surfaces as a USAGE CliError so `lmps proxy aliases validate` can report the
 * issues instead. Mirrors HookConfigPort's read/write half; the proxy front is
 * served only by core-service, so there is no token or rendezvous to manage.
 */
export interface AliasConfigPort {
  /** Absolute aliases file path (for user-facing error messages). */
  aliasesPath(): string;
  /** Raw aliases file contents; missing file → null. */
  readAliasesRaw(): unknown | null;
  /** Strict-parsed aliases; missing → null; non-conforming → CliError (USAGE). */
  readAliases(): VirtualAliasesDocument | null;
  /** Atomic replace of the aliases file. */
  writeAliases(document: VirtualAliasesDocument): void;
  /** True only when aliases exist and their global switch is explicitly off. */
  disabled(): boolean;
}

export interface HookConfigPort {
  /** Absolute rules file path (for user-facing error messages). */
  rulesPath(): string;
  /** Raw rules file contents; missing file → null. */
  readRulesRaw(): unknown | null;
  /** Strict-parsed rules; missing → null; non-conforming → CliError (USAGE). */
  readRules(): HookRulesDocument | null;
  /** Atomic replace of the rules file. */
  writeRules(document: HookRulesDocument): void;
  /** True only when rules exist and their global switch is explicitly off. */
  disabled(): boolean;
  /** Persistent hook token; null when never initialized. */
  readToken(): string | null;
  /** Regenerates and persists the hook token, returning the new value. */
  rotateToken(): string;
  /** Loopback rendezvous; null when the http transport has not run. */
  readAddress(): Record<string, unknown> | null;
}

/** What one command produces. `literal` bypasses the machine envelope for both modes. */
export interface CommandOutput {
  text: string;
  data?: unknown;
  literal?: string;
  /** Non-zero transaction exit code (apply maps activation outcomes to 2/3/5). */
  exitCode?: ExitCode;
}

/** Everything a command needs; `createDefaultDeps()` is the only production wiring. */
export interface CliDeps {
  store: ProfileStore;
  t: TranslationFunction;
  getLocale(): Locale;
  /** Reads the persisted language (config.json); missing file → null. */
  storedLocale(): Locale | null;
  /** System environment language, wired for the process this CLI runs in. */
  systemLocale(): Locale | null;
  /** Persists and applies a locale; throws when the persistence boundary fails. */
  applyLocale(locale: Locale): void;
  readStdin(): Promise<string>;
  readTextFile(path: string): string;
  writeTextFile(path: string, data: string): void;
  now(): string;
  probeEnv: ProbeEnv;
  discovery: DiscoveryPort | null;
  state: StatePort | null;
  snapshot: SnapshotPort | null;
  activation: ActivationSeam | null;
  recommendation: RecommendationSeam | null;
  benchmark: BenchmarkSeam | null;
  /** Local hook config (M4-001); null makes hook.* report capability unsupported. */
  hookConfig: HookConfigPort | null;
  /** Local alias config (M4-002); null makes proxy.* report capability unsupported. */
  aliasConfig: AliasConfigPort | null;
  nodeVersion: string | null;
}