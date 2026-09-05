#!/usr/bin/env node
/**
 * CLI entry point. Writes are the only I/O here: everything upstream produces a
 * `RunCliResult` and this file pushes it out. Init failures (store unavailable)
 * render a minimal machine envelope with no resources loaded (zero CJK) and
 * exit 10; all other exit codes come from the command pipeline.
 */
import { createDefaultDeps } from './deps.js';
import { runCli } from './run.js';

async function main(): Promise<void> {
  let deps;
  try {
    deps = createDefaultDeps();
  } catch {
    const envelope = JSON.stringify(
      { product: 'lmps', api: 1, ok: false, locale: 'en', command: null, error: { code: 'INTERNAL' } },
      null,
      2,
    );
    process.stdout.write(`${envelope}\n`);
    process.exitCode = 10;
    return;
  }

  // Ctrl+C cancels a running activation transaction (M1-005). The signal is
  // wired only to an AbortController; the runner converts it to exit 2. Other
  // commands ignore it, so an accidental Ctrl+C during `profile list` still
  // completes normally.
  const controller = new AbortController();
  process.on('SIGINT', () => controller.abort());

  const result = await runCli(process.argv.slice(2), deps, controller.signal);
  if (result.text !== '') process.stdout.write(`${result.text}\n`);
  if (result.stderr !== '') process.stderr.write(`${result.stderr}\n`);
  process.exitCode = result.exitCode;
}

void main();