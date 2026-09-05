/**
 * Production wiring for the CLI — with `index.ts` the only module allowed to
 * touch `node:` or `process.`. `createDefaultDeps()` builds the real ProfileStore,
 * the file language store, the i18n service over the shipped locale resources,
 * and the default hardware probe env. Discovery/state/snapshot ports stay null
 * until M1-003/M1-005; the commands honestly report capability unsupported (6).
 */
import { createDefaultProbeEnv } from '@lmps/hardware';
import { createI18n, loadResourceFiles, normalizeLocale, type Locale } from '@lmps/i18n';
import { createDefaultFsys, createDefaultProfileStore } from '@lmps/profile-store';
import { join } from 'node:path';

import { createFileLanguageStore } from './config.js';
import { CliError } from './errors.js';
import type { CliDeps } from './seams.js';

export interface DefaultDepsOptions {
  rootDir?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
}

/** `LMPS_HOME` wins; otherwise `~/.lmps`. The root may hold passthrough secrets → LOCAL-ONLY. */
export function resolveRootDir(options: DefaultDepsOptions = {}): string {
  const env = options.env ?? process.env;
  const home = options.home ?? env.USERPROFILE ?? env.HOME ?? '.';
  return env.LMPS_HOME || join(home, '.lmps');
}

export function createDefaultDeps(options: DefaultDepsOptions = {}): CliDeps {
  const env = options.env ?? process.env;
  const rootDir = resolveRootDir(options);
  const fs = createDefaultFsys();
  const store = createDefaultProfileStore(rootDir);
  const languageStore = createFileLanguageStore(rootDir, fs);

  // i18n persistence calls `void store.set(...)`; failures land here so a
  // `lang` switch can surface them as exit 10 instead of silently dropping.
  let persistenceError: unknown = null;
  const i18n = createI18n({
    resources: loadResourceFiles(),
    store: languageStore,
    persistenceErrorHandler: (error) => {
      persistenceError = error;
    },
  });

  return {
    store,
    t: i18n.t,
    getLocale: () => i18n.getLocale(),
    storedLocale: () => languageStore.get(),
    systemLocale: () => systemLocaleFromEnv(env),
    applyLocale: (locale) => {
      i18n.setLocale(locale);
      if (persistenceError !== null) {
        const error = persistenceError;
        persistenceError = null;
        throw error;
      }
    },
    readStdin: createDefaultReadStdin(),
    readTextFile: (path) => fs.readFileUtf8(path),
    writeTextFile: (path, data) => fs.writeFileUtf8(path, data),
    now: () => new Date().toISOString(),
    probeEnv: createDefaultProbeEnv(),
    discovery: null,
    state: null,
    snapshot: null,
    // The activation runtime needs the LM Studio adapter; it stays unwired
    // until M0-005/M1-003, so `apply` honestly reports capability unsupported.
    activation: null,
    nodeVersion: process.versions.node ?? null,
  };
}

function systemLocaleFromEnv(env: NodeJS.ProcessEnv): Locale | null {
  for (const key of ['LMPS_LANG', 'LC_ALL', 'LC_MESSAGES', 'LANG', 'LANGUAGE'] as const) {
    const value = env[key];
    if (typeof value === 'string' && value.trim() !== '') {
      const normalized = normalizeLocale(value);
      if (normalized !== null) return normalized;
    }
  }
  return null;
}

/**
 * Reads all of stdin. An interactive terminal (isTTY) is a usage error: the CLI
 * has no prompt loop, and hanging a human waiting on EOF is a worse failure.
 */
function createDefaultReadStdin(): () => Promise<string> {
  return async () => {
    if (process.stdin.isTTY === true) {
      throw new CliError('USAGE', 'stdin requested from an interactive terminal', {
        params: { key: 'error.usage', values: { detail: 'stdin is a terminal; pipe a file instead' } },
      });
    }
    let data = '';
    for await (const chunk of process.stdin) data += String(chunk);
    return data;
  };
}