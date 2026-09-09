// In-memory seam harness for the M1-004 CLI suite. Every CLI dependency is
// injected with synthetic data: a FakeFs-backed ProfileStore, an i18n service
// bound to the real locale resources, a fake ProbeEnv and unwired discovery.
// Nothing here touches the real filesystem or the user home directory.
import { createProfileStore, type ProfileStore } from '@lmps/profile-store';
import { createI18n, loadResourceFiles, type I18nService } from '@lmps/i18n';
import type { ProbeEnv } from '@lmps/hardware';

import { createFileLanguageStore } from '../../apps/cli/src/config.ts';
import { createAliasConfigStore, createHookConfigStore } from '../../apps/cli/src/deps.ts';
import type { CliDeps } from '../../apps/cli/src/seams.ts';
import { makeFakeProbeEnv } from '../hardware/fixtures';
import { BACKUP_DIR, FakeFs, PROFILE_DIR, makeClock } from '../profile-store/fixtures';

/** Virtual root for the fake profile store and language config. */
export const CLI_ROOT = '/cli-root';

export interface CliHarness {
  deps: CliDeps;
  fs: FakeFs;
  store: ProfileStore;
  i18n: I18nService;
}

/**
 * Builds an isolated CLI harness. Default seams: empty store, English locale,
 * empty stdin, an all-fails ProbeEnv and null discovery/state/snapshot ports.
 * Overrides replace individual seams (e.g. `deps.readStdin` for `--file -`).
 */
export function makeCliHarness(overrides: Partial<CliDeps> = {}): CliHarness {
  const fs = new FakeFs();
  const store = createProfileStore({
    fs,
    now: makeClock(),
    profileDir: PROFILE_DIR,
    backupDir: BACKUP_DIR,
  });
  const languageStore = createFileLanguageStore(CLI_ROOT, fs);
  const i18n = createI18n({ resources: loadResourceFiles(), store: languageStore });

  const deps: CliDeps = {
    store,
    t: i18n.t,
    getLocale: () => i18n.getLocale(),
    storedLocale: () => languageStore.get(),
    systemLocale: () => null,
    applyLocale: (locale) => i18n.setLocale(locale),
    readStdin: async () => '',
    readTextFile: (path) => fs.readFileUtf8(path),
    writeTextFile: (path, data) => fs.writeFileUtf8(path, data),
    now: () => '2026-08-22T01:02:04.000Z',
    probeEnv: makeFakeProbeEnv() as ProbeEnv,
    discovery: null,
    state: null,
    snapshot: null,
    activation: null,
    recommendation: null,
    benchmark: null,
    hookConfig: createHookConfigStore(fs, CLI_ROOT),
    aliasConfig: createAliasConfigStore(fs, CLI_ROOT),
    nodeVersion: '24.13.1',
  };

  return { deps: { ...deps, ...overrides }, fs, store, i18n };
}

/** Parses `runCli` stdout as a machine envelope (JSON). */
export function envelopeOf(text: string): {
  product: string;
  api: number;
  ok: boolean;
  locale: string;
  command: string | null;
  data?: unknown;
  error?: { code: string; detail?: string };
} {
  return JSON.parse(text) as {
    product: string;
    api: number;
    ok: boolean;
    locale: string;
    command: string | null;
    data?: unknown;
    error?: { code: string; detail?: string };
  };
}