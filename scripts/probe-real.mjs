#!/usr/bin/env node
/**
 * Local-only real-machine capability probe (M0-005). Requires the gate
 * `LMPS_REAL=1` (refuses otherwise, exit 2) and a built adapter
 * (`corepack pnpm run build` first). Probes LM Studio through REST, `lms` and
 * the optional SDK, writes a redacted two-segment capability record to
 * `~/.lmps/realm/capability-matrix.json` and appends to `history.ndjson`.
 *
 * Environment:
 *   LMPS_REAL_LM_URL    REST base URL (default http://127.0.0.1:1234)
 *   LMPS_REAL_LM_TOKEN  optional REST bearer token — SECRET, redacted as
 *                       `<env:LMPS_REAL_LM_TOKEN>` in every record
 *   LMPS_REAL_LMS_BIN   `lms` executable (default `lms`)
 *
 * Everything written here is LOCAL-ONLY per PROJECT_DISTRIBUTION_POLICY §3.3:
 * never commit `~/.lmps/realm/` or paste probe output into the repo.
 */
import { mkdirSync, existsSync, appendFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GATE = process.env.LMPS_REAL;
if (GATE !== '1') {
  console.error('[probe:real] refused: LMPS_REAL=1 is required (real-machine gate)');
  process.exit(2);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const adapterDist = resolve(__dirname, '../packages/lmstudio-adapter/dist/index.js');
const hardwareDist = resolve(__dirname, '../packages/hardware/dist/index.js');

if (!existsSync(adapterDist) || !existsSync(hardwareDist)) {
  console.error('[probe:real] dist not found — run `corepack pnpm run build` first.');
  process.exit(1);
}

const { createNodeLmStudioEnv, probeCapabilities } = await import(pathToFileURL(adapterDist).href);
const { redactDiagnostics } = await import(pathToFileURL(hardwareDist).href);

const url = process.env.LMPS_REAL_LM_URL ?? 'http://127.0.0.1:1234';
const token = process.env.LMPS_REAL_LM_TOKEN ?? null;
const lmsBin = process.env.LMPS_REAL_LMS_BIN ?? 'lms';

// Context for redaction: each env value of length ≥ 4 is replaced by its
// `<env:NAME>` placeholder wherever it appears.
const REDACT_CTX = {
  homeDir: homedir(),
  hostname: process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? undefined,
  username: process.env.USERNAME ?? process.env.USER ?? undefined,
  env: {
    LMPS_REAL_LM_URL: url,
    LMPS_REAL_LM_TOKEN: token ?? '',
    LMPS_REAL_LMS_BIN: lmsBin,
  },
};

function redact(text) {
  return redactDiagnostics(text, REDACT_CTX);
}

const realmDir = join(homedir(), '.lmps', 'realm');

try {
  mkdirSync(realmDir, { recursive: true });
  const env = createNodeLmStudioEnv({ baseUrl: url, token, lmsBin });
  const result = await probeCapabilities(env, { force: true });

  const record = {
    kind: 'capability-matrix',
    probedAt: result.ops.probedAt,
    matrices: result.matrices,
    ops: result.ops,
  };
  const payload = redact(JSON.stringify(record, null, 2));

  const matrixPath = join(realmDir, 'capability-matrix.json');
  const historyPath = join(realmDir, 'history.ndjson');
  writeFileSync(matrixPath, payload + '\n', 'utf8');
  appendFileSync(historyPath, redact(JSON.stringify(record)) + '\n', 'utf8');

  process.stdout.write(payload + '\n');
  console.error(`[probe:real] wrote ${matrixPath}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[probe:real] failed: ${redact(message)}`);
  process.exit(1);
}