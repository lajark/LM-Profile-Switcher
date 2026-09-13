/**
 * Windows-shell WDIO suite (M6-004 Slice B).
 *
 * Drives the REAL product: tauri-driver -> msedgedriver -> WebView2 ->
 * lmps-desktop.exe (debug build), which itself supervises the real sidecar SEA
 * binary. LMPS_ADAPTER=mock keeps LM Studio out of the loop; LMPS_HOME points
 * at a throwaway per-run directory so the operator's real store is untouched.
 *
 * The Vite dev server is intentionally absent: the shell serves the built
 * frontend (frontend/dist), matching production. Build prerequisites:
 *   corepack pnpm --filter @lmps/desktop run build:frontend
 *   corepack pnpm --filter @lmps/desktop run sidecar:sea
 *   cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Options } from '@wdio/types';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const appBinary = resolve(
  repoRoot,
  'apps',
  'desktop',
  'src-tauri',
  'target',
  'debug',
  'lmps-desktop.exe',
);
const sidecarBinary = resolve(
  repoRoot,
  'apps',
  'desktop',
  'src-tauri',
  'binaries',
  'lmps-sidecar-x86_64-pc-windows-msvc.exe',
);
const driverPath =
  process.env.LMPS_TAURI_DRIVER ?? join(homedir(), '.cargo', 'bin', 'tauri-driver.exe');
const port = Number(process.env.LMPS_SHELL_DRIVER_PORT ?? 4444);

let tauriDriver: ChildProcess | undefined;
let lmpsHome: string | undefined;
let shellPidsBeforeRun = new Set<number>();
let driverExitExpected = false;

type ShellCapability = WebdriverIO.Capabilities & {
  maxInstances?: number;
  'tauri:options'?: { application: string };
};
type WdioConfig = Options.Testrunner & { capabilities: ShellCapability[] };

function assertPrerequisites(): void {
  for (const [label, file] of [
    ['desktop shell (cargo build)', appBinary],
    ['sidecar SEA (sidecar:sea)', sidecarBinary],
    ['tauri-driver (cargo install tauri-driver)', driverPath],
  ] as const) {
    if (!existsSync(file)) {
      throw new Error(`Shell E2E prerequisite missing: ${label} -> ${file}`);
    }
  }
}

/** Download the msedgedriver matching the WebView2 Runtime; returns its exe. */
function provisionNativeDriver(): string {
  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(repoRoot, 'scripts', 'provision-shell-deps.ps1')],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(`msedgedriver provisioning failed:\n${result.stderr}${result.stdout}`);
  }
  const exe = result.stdout.trim().split(/\r?\n/).pop();
  if (!exe || !existsSync(exe)) {
    throw new Error(`Provisioning script did not yield a driver path: ${result.stdout}`);
  }
  return exe;
}

async function waitForDriver(): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/status`);
      if (res.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 300));
  }
  throw new Error(`tauri-driver did not answer on port ${port}: ${String(lastError)}`);
}

function currentShellPids(): Set<number> {
  const result = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      "(Get-CimInstance Win32_Process -Filter \"Name='lmps-desktop.exe'\").ProcessId",
    ],
    { encoding: 'utf8' },
  );
  return new Set(
    result.stdout
      .split(/\r?\n/)
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0),
  );
}

function killNewShellProcesses(): void {
  if (!shellPidsBeforeRun) return;
  const after = currentShellPids();
  const owned = [...after].filter((pid) => !shellPidsBeforeRun.has(pid));
  for (const pid of owned) {
    // /T takes the sidecar child with it; the PID set is diff-scoped so a
    // concurrently running dev shell is never touched.
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8' });
  }
}

function stopDriver(): void {
  driverExitExpected = true;
  if (tauriDriver && !tauriDriver.killed) {
    tauriDriver.kill();
  }
  tauriDriver = undefined;
  killNewShellProcesses();
  if (lmpsHome) {
    rmSync(lmpsHome, { recursive: true, force: true });
    lmpsHome = undefined;
  }
}

export const config: WdioConfig = {
  runner: 'local',
  hostname: '127.0.0.1',
  port,
  specs: [resolve(here, 'src', 'shell', '**', '*.e2e.ts')],
  maxInstances: 1,
  capabilities: [
    {
      maxInstances: 1,
      // tauri-driver speaks the classic JSON-Wire protocol; without this wdio
      // v9 may negotiate BiDi where selectOption-style helpers do not exist.
      'wdio:enforceWebDriverClassic': true,
      'tauri:options': {
        application: appBinary,
      },
    },
  ],

  logLevel: 'warn',
  bail: 0,
  waitforTimeout: 30_000,
  connectionRetryTimeout: 60_000,
  connectionRetryCount: 2,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 120_000,
  },

  onPrepare(): void {
    assertPrerequisites();
    const nativeDriver = provisionNativeDriver();

    // Isolated data root + deterministic adapter, inherited by the worker,
    // tauri-driver, the desktop shell and finally the sidecar SEA.
    lmpsHome = mkdtempSync(join(tmpdir(), 'lmps-shell-e2e-'));
    process.env.LMPS_HOME = lmpsHome;
    process.env.LMPS_ADAPTER = 'mock';
    process.env.LMPS_NATIVE_DRIVER = nativeDriver;
  },

  async beforeSession(): Promise<void> {
    shellPidsBeforeRun = currentShellPids();
    tauriDriver = spawn(
      driverPath,
      ['--port', String(port), '--native-driver', process.env.LMPS_NATIVE_DRIVER ?? ''],
      { stdio: ['ignore', 'inherit', 'inherit'] },
    );
    tauriDriver.on('error', (error) => {
      console.error('tauri-driver error:', error);
      process.exit(1);
    });
    tauriDriver.on('exit', (code) => {
      if (!driverExitExpected) {
        console.error(`tauri-driver exited unexpectedly (${code})`);
        process.exit(1);
      }
    });
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) {
      process.on(signal, () => {
        stopDriver();
        process.exit(1);
      });
    }
    await waitForDriver();
  },

  onComplete(): void {
    stopDriver();
  },
};
