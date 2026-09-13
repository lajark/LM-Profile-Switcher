#!/usr/bin/env node
/**
 * Local-only real-machine activation smoke (M0-005 facilities; full execution
 * lands with M1-005 wiring in task (f)). Requires `LMPS_REAL=1` (else exit 2)
 * and a built workspace. Runs the canonical sequence against the live host:
 *
 *   probe → resolve adapter → list models → current state →
 *   readEffectiveConfig → load → healthCheck → unload
 *
 * Model under test: `LMPS_REAL_MODEL`, else the first discovered model key.
 * Success/failure is appended to `~/.lmps/realm/history.ndjson` (redacted,
 * LOCAL-ONLY). A run that would load a model requires explicit opt-in — this
 * script always performs load/unload by design, so only run it when a real
 * switch is intended.
 */
import { mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GATE = process.env.LMPS_REAL;
if (GATE !== '1') {
  console.error('[smoke:real] refused: LMPS_REAL=1 is required (real-machine gate)');
  process.exit(2);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const adapterDist = resolve(__dirname, '../packages/lmstudio-adapter/dist/index.js');
const domainDist = resolve(__dirname, '../packages/domain/dist/index.js');
const hardwareDist = resolve(__dirname, '../packages/hardware/dist/index.js');

if (!existsSync(adapterDist) || !existsSync(domainDist) || !existsSync(hardwareDist)) {
  console.error('[smoke:real] dist not found — run `corepack pnpm run build` first.');
  process.exit(1);
}

const [
  { createNodeLmStudioEnv, probeCapabilities, resolveAdapters },
  { CompositeProfileSchema, LoadEstimateSchema, SCHEMA_VERSION },
  { redactDiagnostics },
] = await Promise.all([
  import(pathToFileURL(adapterDist).href),
  import(pathToFileURL(domainDist).href),
  import(pathToFileURL(hardwareDist).href),
]);

const url = process.env.LMPS_REAL_LM_URL ?? 'http://127.0.0.1:1234';
const token = process.env.LMPS_REAL_LM_TOKEN ?? null;
const lmsBin = process.env.LMPS_REAL_LMS_BIN ?? 'lms';
const requestedModel = process.env.LMPS_REAL_MODEL ?? null;

const REDACT_CTX = {
  homeDir: homedir(),
  hostname: process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? undefined,
  username: process.env.USERNAME ?? process.env.USER ?? undefined,
  env: {
    LMPS_REAL_LM_URL: url,
    LMPS_REAL_LM_TOKEN: token ?? '',
    LMPS_REAL_LMS_BIN: lmsBin,
    LMPS_REAL_MODEL: requestedModel ?? '',
  },
};

function redact(text) {
  return redactDiagnostics(text, REDACT_CTX);
}

const realmDir = join(homedir(), '.lmps', 'realm');

function syntheticProfile(modelKey, nowIso) {
  return CompositeProfileSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    id: 'smoke-real',
    displayName: { 'zh-CN': '真机冒烟', en: 'real smoke' },
    model: { modelKey },
    task: { type: 'smoke' },
    runtime: {},
    generation: {},
    behavior: { mode: 'exclusive' },
    metadata: { createdAt: nowIso, updatedAt: nowIso },
  });
}

function roughEstimate(modelKey, nowIso) {
  return LoadEstimateSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    provider: 'rough',
    modelKey,
    vramTotalBytes: null,
    systemRamBytes: null,
    estimatedAt: nowIso,
  });
}

try {
  mkdirSync(realmDir, { recursive: true });
  const now = () => new Date().toISOString();
  const env = createNodeLmStudioEnv({ baseUrl: url, token, lmsBin });
  const probe = await probeCapabilities(env, { force: true });
  const bundle = resolveAdapters(env, probe);

  const models = await bundle.discovery.listModels();
  if (models.length === 0) {
    throw new Error('no models on the host (LMPS_REAL_MODEL or discovered list empty)');
  }
  const modelKey = requestedModel ?? models[0].modelKey;
  if (requestedModel !== null && !models.some((m) => m.modelKey === requestedModel)) {
    throw new Error(`LMPS_REAL_MODEL "${requestedModel}" not found on host`);
  }

  const profile = syntheticProfile(modelKey, now());
  const estimate = roughEstimate(modelKey, now());

  const active = await bundle.runtime.getActiveState();
  const effective = await bundle.runtime.readEffectiveConfig(profile);
  const echo = await bundle.runtime.load(profile, estimate);
  await bundle.runtime.healthCheck(profile);
  await bundle.runtime.unload();

  const record = {
    kind: 'smoke-real',
    ok: true,
    probedAt: probe.ops.probedAt,
    modelKey,
    steps: {
      list: models.length,
      current: active,
      readEffectiveConfig: effective,
      loadEcho: echo,
      unload: true,
    },
  };
  appendFileSync(join(realmDir, 'history.ndjson'), redact(JSON.stringify(record)) + '\n', 'utf8');
  process.stdout.write(redact(JSON.stringify(record, null, 2)) + '\n');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const record = { kind: 'smoke-real', ok: false, error: redact(message) };
  try {
    appendFileSync(join(realmDir, 'history.ndjson'), redact(JSON.stringify(record)) + '\n', 'utf8');
  } catch {
    // Recording is best-effort; the failure must still surface below.
  }
  console.error(`[smoke:real] failed: ${redact(message)}`);
  process.exit(1);
}