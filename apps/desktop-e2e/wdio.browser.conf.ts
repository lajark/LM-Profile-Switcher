/**
 * Browser-mode WDIO suite (M6-004 Slice A).
 *
 * Drives the REAL frontend (served by the desktop app's own Vite config) in a
 * normal browser at /e2e.html, where the in-memory fake sidecar replaces Tauri
 * IPC. Deterministic, no native shell, no LM Studio, no real data root.
 *
 * Lifecycle: the Vite dev server is started programmatically in onPrepare and
 * closed in onComplete, so the suite owns its prerequisite (a blank page from
 * a missing dev server can never produce a false pass).
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import type { Options } from '@wdio/types';

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(here, '..', 'desktop');
const isWindows = process.platform === 'win32';
const headless = process.env.LMPS_E2E_HEADLESS === '1' || process.env.CI === 'true';
const browserName = process.env.LMPS_E2E_BROWSER ?? (isWindows ? 'MicrosoftEdge' : 'chrome');

let viteServer: ViteDevServer | undefined;

// In @wdio/types v9 the capabilities requirement is split into
// WithRequestedTestrunnerCapabilities; intersect it for a complete config type.
type WdioConfig = Options.Testrunner & { capabilities: WebdriverIO.Capabilities[] };

export const config: WdioConfig = {
  runner: 'local',
  specs: [resolve(here, 'src', 'browser', '**', '*.e2e.ts')],
  maxInstances: 1,
  capabilities: [
    {
      browserName,
      // Classic WebDriver keeps the suite independent of BiDi/WebView2 event
      // ordering differences; the app under test uses no BiDi-only features.
      'wdio:enforceWebDriverClassic': true,
      ...(headless
        ? browserName === 'MicrosoftEdge'
          ? { 'ms:edgeOptions': { args: ['--headless=new', '--disable-gpu'] } }
          : { 'goog:chromeOptions': { args: ['--headless=new', '--disable-gpu'] } }
        : {}),
    },
  ],

  logLevel: 'warn',
  bail: 0,
  baseUrl: 'http://localhost:1420',
  waitforTimeout: 10_000,
  connectionRetryTimeout: 30_000,
  connectionRetryCount: 1,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 60_000,
  },

  async onPrepare(): Promise<void> {
    viteServer = await createServer({
      // Vite resolves a relative `root` against process cwd (the e2e package
      // when wdio launches), NOT the config file directory; pin it absolutely.
      root: resolve(desktopRoot, 'frontend'),
      configFile: resolve(desktopRoot, 'frontend', 'vite.config.ts'),
      logLevel: 'warn',
      server: { port: 1420, strictPort: true },
    });
    viteServer = await viteServer.listen();
  },

  async before(): Promise<void> {
    await browser.setWindowSize(1280, 800);
  },

  async onComplete(): Promise<void> {
    await viteServer?.close();
    viteServer = undefined;
  },
};
