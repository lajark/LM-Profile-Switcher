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
 */
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
}

const STATUS_TIMEOUT_MS = 10_000;
const LS_TIMEOUT_MS = 30_000;

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

  return { status, listModels };
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