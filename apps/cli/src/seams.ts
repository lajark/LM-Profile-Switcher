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
  EstimatePort,
  RecommendationService,
  RunnerContext,
  TransactionLogSink,
} from '@lmps/core';
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
  nodeVersion: string | null;
}