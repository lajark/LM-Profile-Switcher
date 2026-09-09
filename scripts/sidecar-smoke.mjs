#!/usr/bin/env node
/**
 * Local-only real-machine sidecar smoke (M0-006 spike; completes the REST-auth
 * evidence left open by M0-005/M1-003). Requires `LMPS_REAL=1` (else exit 2)
 * and a built SEA sidecar.
 *
 * Spawns the actual packaged SEA executable over the stdio transport — the
 * channel adopted in ADR-0003 — performs the per-session token handshake, then
 * calls `probeCapabilities`, `adapterProbe` and `sdkInfo` against the live
 * host. The LM token (SECRET) travels only inside the child environment as
 * `LMPS_LM_TOKEN`; it never appears in frames, stdout, stderr or this script.
 * Redacted record -> ~/.lmps/realm/m0-006-sidecar-smoke.json (LOCAL-ONLY).
 *
 * Env: LMPS_REAL=1, LMPS_REAL_LM_URL (default http://127.0.0.1:1234),
 *      LMPS_REAL_LM_TOKEN (SECRET), LMPS_REAL_LMS_BIN (default lms),
 *      LMPS_SIDECAR_EXE (default the repo SEA artifact).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GATE = process.env.LMPS_REAL;
if (GATE !== '1') {
  console.error('[sidecar-smoke] refused: LMPS_REAL=1 is required (real-machine gate)');
  process.exit(2);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_EXE = resolve(
  __dirname,
  '..',
  'apps',
  'desktop',
  'src-tauri',
  'binaries',
  'lmps-sidecar-x86_64-pc-windows-msvc.exe',
);
const exePath = process.env.LMPS_SIDECAR_EXE ?? DEFAULT_EXE;
if (!existsSync(exePath)) {
  console.error(`[sidecar-smoke] SEA sidecar not found: ${exePath}`);
  process.exit(1);
}

const hardwareDist = resolve(__dirname, '../packages/hardware/dist/index.js');
const { redactDiagnostics } = await import(pathToFileURL(hardwareDist).href);

const url = process.env.LMPS_REAL_LM_URL ?? 'http://127.0.0.1:1234';
const token = process.env.LMPS_REAL_LM_TOKEN ?? null;
const lmsBin = process.env.LMPS_REAL_LMS_BIN ?? 'lms';

const REDACT_CTX = {
  homeDir: homedir(),
  hostname: process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? undefined,
  username: process.env.USERNAME ?? process.env.USER ?? undefined,
  env: {
    LMPS_LM_URL: url,
    LMPS_LM_TOKEN: token ?? '',
    LMPS_LM_BIN: lmsBin,
  },
};

function redact(text) {
  return redactDiagnostics(text, REDACT_CTX);
}

function sessionToken() {
  return `lmps-smoke-${[...Array(16)].map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;
}

const realmDir = join(homedir(), '.lmps', 'realm');
mkdirSync(realmDir, { recursive: true });

function main() {
  return new Promise((resolveResult) => {
    const argvToken = sessionToken();
    const child = spawn(exePath, ['stdio', argvToken], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, LMPS_LM_URL: url, LMPS_LM_TOKEN: token ?? '', LMPS_LM_BIN: lmsBin },
    });

    let stderrLog = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderrLog += chunk;
    });

    const stdout = createInterface({ input: child.stdout, crlfDelay: Infinity });
    const pending = new Map();

    function waitFrame(id, timeoutMs = 120_000) {
      return new Promise((resolveFrame, rejectFrame) => {
        const timer = setTimeout(
          () => rejectFrame(new Error(`timeout waiting for frame id ${id}`)),
          timeoutMs,
        );
        pending.set(id, (frame) => {
          clearTimeout(timer);
          pending.delete(id);
          resolveFrame(frame);
        });
      });
    }

    function send(line) {
      child.stdin.write(`${line}\n`);
    }

    stdout.on('line', (line) => {
      let frame;
      try {
        frame = JSON.parse(line);
      } catch {
        return;
      }
      const waiter = pending.get(frame['id']);
      if (waiter !== undefined) waiter(frame);
    });

    const readyPromise = new Promise((resolveReady, rejectReady) => {
      const timer = setTimeout(() => rejectReady(new Error('sidecar ready timeout')), 20_000);
      const onReady = (line) => {
        try {
          const frame = JSON.parse(line);
          if (frame['event'] === 'ready') {
            clearTimeout(timer);
            stdout.off('line', onReady);
            resolveReady(frame);
          }
        } catch {
          /* framing noise before ready is ignored */
        }
      };
      stdout.on('line', onReady);
      child.on('spawn', () => {});
      child.once('error', (error) => {
        clearTimeout(timer);
        rejectReady(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        rejectReady(new Error(`sidecar exited early (code ${code}) before ready`));
      });
    });

    (async () => {
      await readyPromise;
      const authReply = waitFrame(-1);
      send(JSON.stringify({ jsonrpc: '2.0', auth: true, token: argvToken }));
      const auth = await authReply;
      if (auth['error'] !== undefined) {
        throw new Error(`sidecar auth refused: ${JSON.stringify(auth['error'])}`);
      }
      if (auth['result']?.authenticated !== true) {
        throw new Error(`sidecar auth unexpected reply: ${JSON.stringify(auth)}`);
      }

      const request = (id, method, params) => {
        const reply = waitFrame(id);
        send(JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} }));
        return reply;
      };

      const sdk = await request(1, 'sdkInfo');
      const probe = await request(2, 'probeCapabilities', {});
      const adapter = await request(3, 'adapterProbe');
      if (sdk['error'] !== undefined || probe['error'] !== undefined || adapter['error'] !== undefined) {
        const which = [['sdkInfo', sdk], ['probeCapabilities', probe], ['adapterProbe', adapter]]
          .filter(([, f]) => f['error'] !== undefined)
          .map(([m, f]) => `${m}:${JSON.stringify(f['error'])}`)
          .join('; ');
        throw new Error(`sidecar RPC error: ${which}`);
      }

      resolveResult({
        ok: true,
        transport: 'stdio',
        seaExe: exePath,
        wire: {
          authAuthenticated: auth['result'],
          sdkInfo: sdk['result'],
          probeCapabilities: probe['result'],
          adapterProbe: adapter['result'],
        },
        generatedAt: new Date().toISOString(),
      });
    })().catch((error) => {
      resolveResult({
        ok: false,
        transport: 'stdio',
        seaExe: exePath,
        error: redact(error instanceof Error ? error.message : String(error)),
        stderrTail: redact(stderrLog.slice(-2000)),
        generatedAt: new Date().toISOString(),
      });
    }).finally(() => {
      child.kill();
    });
  });
}

const record = await main();
const guardRecord = JSON.parse(redact(JSON.stringify(record, null, 2)));
writeFileSync(join(realmDir, 'm0-006-sidecar-smoke.json'), JSON.stringify(guardRecord, null, 2) + '\n', 'utf8');

if (record.ok) {
  const wire = record.wire;
  const probeOps = wire.probeCapabilities?.ops ?? {};
  const adapterResult = wire.adapterProbe ?? {};
  console.log(
    redact(
      JSON.stringify(
        {
          ok: true,
          sdkInfo: wire.sdkInfo,
          restStatus: probeOps.restStatus ?? probeOps.status ?? 'n/a',
          capabilities: wire.probeCapabilities?.matrices,
          modelCount: adapterResult.modelCount,
        },
        null,
        2,
      ),
    ),
  );
} else {
  console.error(`[sidecar-smoke] failed: ${record.error}`);
  process.exit(1);
}