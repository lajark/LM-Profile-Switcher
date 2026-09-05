/**
 * `lms` CLI adapter (M0-005): covers the read / status paths the REST API does
 * not expose (server status, engine version) and serves as a fallback reader
 * when REST is unreachable but the binary works. Write paths (load/unload) are
 * deliberately delegated to the REST adapter by the router: `lms load` exists
 * but adds a subprocess hop and per-call cost for identical effect. M1-006
 * adds the estimate path here.
 *
 * CLI surface mapped from the live binary on 2026-09-05 (fact, not guess):
 * `lms status --json` does NOT exist — `status` prints human text
 * (`Server:  OFF`), and JSON output is `ls --json` only. `--detailed` is
 * deprecated. The probe caught this drift; the adapter ships the corrected
 * verbs.
 *
 * M1-006 adds the estimate path: `lms load <modelKey> --estimate-only` for the
 * official resource estimate, parsed leniently (see `parseLmsEstimateValues`).
 * The exact output contract is NOT verified on a real machine yet — the parse
 * understands the documented table/`label:` shapes and returns null on anything
 * it cannot confidently classify, so the estimate port falls back to an
 * explicitly-labeled rough estimate instead of guessing.
 */
import { SCHEMA_VERSION, type CompositeProfile, type LoadEstimate } from '@lmps/domain';

import type { LmStudioEnv } from '../env.js';
import { LmStudioError } from '../errors.js';
import type { ModelIdentity } from '../model-names.js';
import { parseModelIdentity } from '../model-names.js';

export interface CliStatusResult {
  serverRunning: boolean;
  version: string | null;
}

export interface CliLms {
  status(): Promise<CliStatusResult>;
  listModels(): Promise<ModelIdentity[]>;
  /** Official resource estimate for a profile via `lms load --estimate-only`. */
  estimate(profile: CompositeProfile): Promise<LoadEstimate>;
}

const STATUS_TIMEOUT_MS = 10_000;
const LS_TIMEOUT_MS = 30_000;
/**
 * `--estimate-only` may need to wake the daemon (like `lms ls` does) on a cold
 * server; 30s mirrors the LS wake budget while staying bounded.
 */
export const ESTIMATE_TIMEOUT_MS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

export function createCliAdapter(env: LmStudioEnv): CliLms {
  async function status(): Promise<CliStatusResult> {
    const result = await env.runLms(['status'], STATUS_TIMEOUT_MS);
    if (result.timedOut || result.exitCode === 124) {
      throw new LmStudioError('lms status timed out', { subsystem: 'cli', kind: 'timeout' });
    }
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new LmStudioError(`lms status exited ${result.exitCode}`, {
        subsystem: 'cli',
        kind: 'process',
      });
    }
    const parsed = parseLmsStatus(result.stdout);
    if (parsed === null) {
      throw new LmStudioError('lms status returned unrecognizable output', {
        subsystem: 'cli',
        kind: 'parse',
      });
    }
    return parsed;
  }

  async function listModels(): Promise<ModelIdentity[]> {
    const result = await env.runLms(['ls', '--json'], LS_TIMEOUT_MS);
    if (result.timedOut || result.exitCode === 124) {
      throw new LmStudioError('lms ls timed out', { subsystem: 'cli', kind: 'timeout' });
    }
    if (result.exitCode !== 0) {
      throw new LmStudioError(`lms ls exited ${result.exitCode}`, {
        subsystem: 'cli',
        kind: 'process',
      });
    }
    const keys = parseLmsLs(result.stdout);
    return keys.map(parseModelIdentity);
  }

  async function estimate(profile: CompositeProfile): Promise<LoadEstimate> {
    const result = await env.runLms(estimateArgs(profile), ESTIMATE_TIMEOUT_MS);
    if (result.timedOut || result.exitCode === 124) {
      throw new LmStudioError('lms load --estimate-only timed out', {
        subsystem: 'cli',
        kind: 'timeout',
      });
    }
    if (result.exitCode !== 0) {
      throw new LmStudioError(`lms load --estimate-only exited ${result.exitCode}`, {
        subsystem: 'cli',
        kind: 'process',
      });
    }
    const values = parseLmsEstimateValues(result.stdout);
    if (values === null) {
      throw new LmStudioError('lms load --estimate-only returned unrecognizable output', {
        subsystem: 'cli',
        kind: 'parse',
      });
    }
    const identity = parseModelIdentity(profile.model.modelKey);
    const gpuOffload = profile.runtime.gpuOffload;
    return {
      schemaVersion: SCHEMA_VERSION,
      provider: 'exact',
      modelKey: profile.model.modelKey,
      quantization: identity.quantization,
      contextLength: profile.runtime.contextLength ?? null,
      gpuOffload: typeof gpuOffload === 'number' ? gpuOffload : null,
      vramTotalBytes: values.vramTotalBytes,
      systemRamBytes: values.systemRamBytes,
      hardwareFingerprint: null,
      lmStudioVersion: null,
      estimatedAt: env.now(),
      warnings: [],
    };
  }

  return { status, listModels, estimate };
}

/**
 * Arg vector for the official estimate. Mirrors the loader flags so the
 * estimate answers the same configuration that `apply` would load; `--json` is
 * deliberately not used — `lms status --json` drift (2026-09-05) showed the
 * binary only documents `ls --json`, and the parser accepts human output.
 */
export function estimateArgs(profile: CompositeProfile): string[] {
  const args = ['load', profile.model.modelKey, '--estimate-only'];
  const contextLength = profile.runtime.contextLength;
  if (typeof contextLength === 'number' && contextLength > 0) {
    args.push('--context-length', String(contextLength));
  }
  return args;
}

/**
 * Lenient parser for the human `lms status` output observed on the real host
 * (2026-09-05), e.g. `Server:  OFF` / `(i) To start the server...`. `ON` and
 * `running` mean the local API server is up; `OFF`/`stopped`/`not running`
 * mean it is not. Anything ambiguous → null so the probe records drift instead
 * of guessing.
 */
export function parseLmsStatus(stdout: string): CliStatusResult | null {
  const text = stdout.trim();
  if (text === '') return null;
  // `not running` must not feed the `on` branch: lookbehind keeps a negated
  // "running"/"started" from counting as a positive state.
  const on = /\b(?:ON|(?<!not )running|(?<!not )started)\b/i.test(text);
  const off = /\b(?:OFF|stopped|not (?:running|started))\b/i.test(text);
  if (on && off) return null;
  return { serverRunning: on, version: null };
}

/** Lenient parser for `lms ls --json`: an array or a wrapper with `data`/`models`. */
export function parseLmsLs(stdout: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch {
    return [];
  }
  if (Array.isArray(parsed)) {
    return parsed
      .filter(isRecord)
      .map((row) => asNonEmptyString(row.id) ?? asNonEmptyString(row.path))
      .filter((key): key is string => key !== null);
  }
  if (isRecord(parsed)) {
    const candidates = Array.isArray(parsed.data) ? parsed.data : Array.isArray(parsed.models) ? parsed.models : [];
    return candidates
      .filter(isRecord)
      .map((row) => asNonEmptyString(row.id) ?? asNonEmptyString(row.path))
      .filter((key): key is string => key !== null);
  }
  return [];
}

const MEMORY_VALUE_RE = /(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB|KiB|MiB|GiB|TiB)\b/i;

const BYTES_PER_UNIT: Record<string, number> = {
  b: 1,
  kb: 1_000,
  mb: 1_000 ** 2,
  gb: 1_000 ** 3,
  tb: 1_000 ** 4,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  tib: 1024 ** 4,
};

function sizeToBytes(text: string): number | null {
  const match = text.match(MEMORY_VALUE_RE);
  if (match === null) return null;
  const [, rawValue, unitRaw] = match;
  const unit = (unitRaw ?? '').toLowerCase();
  const multiplier = BYTES_PER_UNIT[unit];
  if (multiplier === undefined || rawValue === undefined) return null;
  return Math.round(Number(rawValue) * multiplier);
}

/**
 * Reads a VRAM or RAM figure from the tail of a line after the label, e.g.
 * `| VRAM usage | 6.2 GiB |` or `VRAM: 6.2 GB`. Scanning only the tail keeps a
 * single line that lists both figures (`VRAM: 4 GiB | System RAM: 1 GiB`) from
 * cross-reading the first number for the second field. Returns null when the
 * tail has no size token.
 */
function figureAfterLabel(line: string, label: RegExp): number | null {
  const match = line.match(label);
  if (match === null || match.index === undefined) return null;
  return sizeToBytes(line.slice(match.index + match[0].length));
}

const VRAM_LABEL_RE = /(?:vram|graphics|gpu)\b/i;

/**
 * System-RAM label test. `VRAM` never matches (the `\b` needs a word boundary
 * before `ram`, and VRAM has the letter V in front), and `GPU/graphics memory`
 * is VRAM, not system RAM — only a plain `memory`/`ram`/`system ram` label
 * counts.
 */
function hasRamLabel(line: string): boolean {
  const lower = line.toLowerCase();
  if (/(?:gpu|graphics|video|vram)\s+memory\b/.test(lower)) return false;
  return /\b(?:system\s*ram|memory|ram)\b/.test(lower);
}

/**
 * Lenient classifier for `lms load --estimate-only` output (M1-006). The real
 * output contract is NOT yet captured on a live host — the parser understands
 * the documented shapes (`| label | size |` table cells and `label: size` lines,
 * VRAM/GPU and RAM/memory labels) and returns null when nothing can be
 * classified with confidence, so drift degrades to a labeled rough estimate
 * instead of a fabricated exact one.
 */
export function parseLmsEstimateValues(
  stdout: string,
): { vramTotalBytes: number | null; systemRamBytes: number | null } | null {
  let vramTotalBytes: number | null = null;
  let systemRamBytes: number | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    if (vramTotalBytes === null && VRAM_LABEL_RE.test(line)) {
      vramTotalBytes = figureAfterLabel(line, VRAM_LABEL_RE);
    }
    if (systemRamBytes === null && hasRamLabel(line)) {
      systemRamBytes = figureAfterLabel(line, /\bmemory\b|\bram\b|\bsystem\s*ram\b/i);
    }
  }
  if (vramTotalBytes === null && systemRamBytes === null) return null;
  return { vramTotalBytes, systemRamBytes };
}