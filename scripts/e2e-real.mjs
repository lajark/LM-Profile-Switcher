#!/usr/bin/env node
/**
 * Real-machine end-to-end test (E2E) — local-only, gated by `LMPS_REAL=1`
 * (matching `scripts/smoke-real.mjs`). Requires the built CLI
 * (`corepack pnpm run build`) and a running LM Studio server on `LMPS_REAL_LM_URL`
 * (default http://127.0.0.1:1234). Runs the canonical product workflow against
 * the live host through the real adapter:
 *
 *   hardware probe → create profile → optimize (real estimate/candidates) →
 *   benchmark --yes (real inference) → optimize --yes (calibration audit) →
 *   apply --yes (real activation + health check)
 *
 * The REST inference path requires an LM Studio API token; it is read ONLY from
 * the `LMPS_LM_TOKEN` environment variable and never written to this script,
 * logs, argv, or the repo. A per-benchmark x N token budget is left to the
 * caller. Results are appended to `~/.lmps/realm/e2e-history.ndjson` (redacted,
 * LOCAL-ONLY). `LMPS_E2E_MODEL` selects the model key (default: first discovered
 * LLM). Any assertion failure exits 1; without the gate it exits 2.
 */
import { appendFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const GATE = process.env.LMPS_REAL;
if (GATE !== '1') {
  console.error('[e2e] refused: LMPS_REAL=1 is required (real-machine gate)');
  process.exit(2);
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'apps', 'cli', 'dist', 'index.js');
if (!existsSync(CLI)) {
  console.error('[e2e] CLI dist not found — run `corepack pnpm run build` first.');
  process.exit(1);
}

const URL = process.env.LMPS_REAL_LM_URL ?? 'http://127.0.0.1:1234';
const TOKEN = process.env.LMPS_LM_TOKEN ?? null;
const MODEL = process.env.LMPS_E2E_MODEL ?? null;
const SAMPLES = Number(process.env.LMPS_E2E_SAMPLES ?? 1);
const MAX_TOKENS = Number(process.env.LMPS_E2E_MAX_TOKENS ?? 32);

const HOME = mkdtempSync(join(tmpdir(), 'lmps-e2e-'));
const historyPath = join(homedir(), '.lmps', 'realm', 'history.ndjson');

/** Run a CLI command, capturing stdout JSON + the process exit code. */
function cli(args, { withToken = false } = {}) {
  const env = { ...process.env, LMPS_HOME: HOME };
  if (withToken && TOKEN !== null) env.LMPS_LM_TOKEN = TOKEN;
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, env, encoding: 'utf8', shell: false });
  return { exit: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function assert(cond, msg) {
  if (!cond) throw new Error(`[e2e] assertion failed: ${msg}`);
}

const appendHistory = (record) => {
  try { appendFileSync(historyPath, JSON.stringify(record) + '\n', 'utf8'); } catch { /* best-effort */ }
};

function main() {
  const startedAt = new Date().toISOString();
  const steps = {};
  try {
    // ---- 1. hardware probe ------------------------------------------------
    const hw = parseJson(cli(['hardware', '--json']).stdout)?.data;
    assert(hw?.gpus?.length > 0, 'no discrete GPU discovered');
    assert(hw.memory?.totalBytes > 0, 'no memory probe');
    steps.hardware = { gpus: hw.gpus.map((g) => g.name), ramGiB: +(hw.memory.totalBytes / 2 ** 30).toFixed(1) };

    // ---- 2. create profile (reuse first discovered LLM) --------------------
    const models = parseJson(cli(['models', '--json']).stdout)?.data?.models ?? [];
    assert(models.length > 0, 'no models listed on host');
    const modelKey = MODEL ?? models[0].key;
    assert(models.some((m) => m.key === modelKey), `model ${modelKey} not on host`);
    const id = `e2e-${Date.now()}`;
    const file = join(HOME, 'e2e-profile.json');
    writeFileSync(
      file,
      JSON.stringify({
        schemaVersion: 2,
        id,
        displayName: { 'zh-CN': 'E2E 真机', en: 'e2e real' },
        description: { en: 'real-machine E2E profile' },
        model: { modelKey, family: modelKey.split('/')[0] ?? null, architecture: 'dense' },
        task: { type: 'coding', kind: 'coding', typicalInputTokens: 1000 },
        runtime: { contextLength: 4096, gpuOffload: 'max' },
        generation: { temperature: 0.7 },
        behavior: { mode: 'exclusive', rollback: 'best-effort' },
        validation: { source: 'manual' },
        metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      }),
      'utf8',
    );
    const created = cli(['profile', 'create', '--name', id, '--file', file]);
    assert(created.exit === 0, `profile create failed (${created.exit}): ${created.stderr}`);
    steps.create = { id };

    // ---- 3. optimize (real estimate / candidates) -------------------------
    const opt = parseJson(cli(['optimize', id, '--json']).stdout)?.data?.recommendation;
    assert(opt?.candidates?.length >= 1, 'no candidates generated');
    steps.optimize = { candidates: opt.candidates.length, warnings: opt.warnings };

    // ---- 4. benchmark --yes (real inference, needs token) -----------------
    assert(TOKEN !== null, 'benchmark requires LMPS_LM_TOKEN (real REST inference)');
    const bm = parseJson(cli(['benchmark', id, '--samples', String(SAMPLES), '--max-tokens', String(MAX_TOKENS), '--allow-battery', '--yes', '--json'], { withToken: true }).stdout)?.data;
    assert(bm?.result?.status === 'completed', `benchmark not completed: ${bm?.result?.status}`);
    assert(bm.validated === true, 'benchmark --yes did not stamp validation');
    steps.benchmark = { decode: bm.result.metrics.decodeTokensPerSecond, peakGiB: +(bm.result.metrics.memoryPeakBytes / 2 ** 30).toFixed(3), validated: bm.validated };

    // ---- 5a. optimize --yes (calibration audit) ---------------------------
    const optYes = parseJson(cli(['optimize', id, '--yes', '--json']).stdout)?.data;
    assert(optYes?.savedProfileId, 'optimize --yes did not save');
    steps.optimizeYes = { saved: optYes.savedProfileId };

    // ---- 5b. apply --yes (real activation + health check) -----------------
    const applyJson = cli(['apply', id, '--yes', '--json'], { withToken: true }).stdout;
    const tx = parseJson(applyJson)?.data?.transaction;
    assert(tx?.status === 'active', `activation not active: ${tx?.status}`);
    steps.apply = { status: tx.status, stages: tx.stages.map((s) => s.name) };

    const record = { kind: 'e2e-real', ok: true, startedAt, url: URL, steps };
    appendHistory(record);
    console.log(JSON.stringify(record, null, 2));
  } catch (error) {
    const record = { kind: 'e2e-real', ok: false, startedAt, steps, error: error.message };
    appendHistory(record);
    console.error(`[e2e] failed: ${error.message}`);
    process.exit(1);
  } finally {
    rmSync(HOME, { recursive: true, force: true });
  }
}

main();