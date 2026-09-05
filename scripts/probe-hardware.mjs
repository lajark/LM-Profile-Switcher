#!/usr/bin/env node
/**
 * Local-only hardware probe for this machine. Prints a redacted machine JSON
 * snapshot (schemaVersion/os/cpu/memory/gpus/volumes/power/fingerprint) to
 * stdout. Requires `corepack pnpm -w run build` first: this imports the built
 * `@lmps/hardware` dist, never the TS sources.
 *
 * Output must NOT be committed, copied into fixtures, or pasted into docs —
 * raw probe values are LOCAL-ONLY per PROJECT_DISTRIBUTION_POLICY §3.3.
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const hardwareDist = resolve(__dirname, '../packages/hardware/dist/index.js');

if (!existsSync(hardwareDist)) {
  console.error(
    '[hardware:probe] dist not found — run `corepack pnpm -w run build` first: ' +
      hardwareDist,
  );
  process.exit(1);
}

const { createDefaultProbeEnv, probeHardware, redactDiagnostics } = await import(
  pathToFileURL(hardwareDist).href,
);

try {
  const env = createDefaultProbeEnv();
  const profile = await probeHardware(env);

  const snapshot = {
    schemaVersion: profile.schemaVersion,
    os: profile.os,
    cpu: profile.cpu,
    memory: profile.memory,
    gpus: profile.gpus,
    volumes: profile.volumes,
    power: profile.power,
    versions: profile.versions,
    hardwareFingerprint: profile.hardwareFingerprint,
    probedAt: profile.probedAt,
  };

  // All snapshot fields come from our curated list, so no home/host/user/env
  // context is needed; the serial-number pattern stays as the defensive net.
  const redacted = redactDiagnostics(JSON.stringify(snapshot, null, 2), {});

  process.stdout.write(redacted + '\n');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[hardware:probe] failed: ${redactDiagnostics(message, {})}`);
  process.exit(1);
}