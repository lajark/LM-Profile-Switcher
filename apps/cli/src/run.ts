/**
 * `runCli(argv, deps)`: the CLI dispatch engine. Pure module — no Node
 * built-ins, no process/console access; `index.ts`/`deps.ts` carry all wiring.
 * The locale is
 * resolved at runtime (--lang → persisted config.json → system env → default)
 * and applied before any command renders, so a config written after startup is
 * honored. Output streams are isolated: `text` is stdout (human success or the
 * machine envelope), `stderr` carries human errors and verbose diagnostics.
 */
import { isActivationError } from '@lmps/core';
import { isDomainError } from '@lmps/domain';
import { DEFAULT_LOCALE, LocaleResourceError, normalizeLocale, type Locale } from '@lmps/i18n';
import { isProfileStoreError } from '@lmps/profile-store';

import { runApplyCommand } from './commands/apply.js';
import { runCurrentCommand } from './commands/current.js';
import { runDoctorCommand } from './commands/doctor.js';
import { runHardwareCommand } from './commands/hardware.js';
import { runHelpCommand } from './commands/help.js';
import { runLangCommand } from './commands/lang.js';
import { runModelsCommand } from './commands/models.js';
import { runProfileCommand } from './commands/profile.js';
import { runSnapshotCommand } from './commands/snapshot.js';
import { isCliError } from './errors.js';
import { EXIT, exitCodeForError, type ExitCode } from './exit-codes.js';
import { errorEnvelope, machineErrorFor, renderEnvelope, successEnvelope } from './machine.js';
import { parseArgs } from './options.js';
import type { CliDeps, CommandOutput } from './seams.js';

export interface RunCliResult {
  text: string;
  stderr: string;
  locale: Locale;
  exitCode: ExitCode;
}

const KNOWN_COMMANDS = new Set(['profile', 'apply', 'models', 'current', 'snapshot', 'hardware', 'lang', 'doctor']);

export async function runCli(argv: readonly string[], deps: CliDeps, signal?: AbortSignal): Promise<RunCliResult> {
  const startedAtMs = Date.now();

  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    // Global flags failed (--lang value missing, bad --timeout): the requested
    // language is unknowable, so fall back to stored → system → default.
    resolveAndApplyLocale(deps, null);
    return { text: '', stderr: humanErrorText(error, deps), locale: deps.getLocale(), exitCode: exitCodeForError(error) };
  }

  const json = parsed.json;
  const command = parsed.command;
  resolveAndApplyLocale(deps, parsed.lang);

  if (parsed.help || command === 'help') {
    // Help always renders as human text; even --json --help prints the usage.
    const result = runHelpCommand(deps);
    return finish(deps, result, { json: false, command: 'help', verbose: parsed.verbose, ms: Date.now() - startedAtMs });
  }

  if (command === null) {
    const exitCode = EXIT.VALIDATION_OR_PREFLIGHT;
    if (json) {
      return { text: renderEnvelope(errorEnvelope(deps.getLocale(), null, 'USAGE')), stderr: '', locale: deps.getLocale(), exitCode };
    }
    const message =
      parsed.args.length === 0
        ? deps.t('cli.noCommand')
        : deps.t('error.usage', { detail: parsed.args.join(' ') });
    return { text: '', stderr: message, locale: deps.getLocale(), exitCode };
  }

  // `command` is non-null past this point; the envelope/verbose label renders
  // `profile <sub>` as "profile <sub>" and every other command by its bare name.
  const commandLabel =
    command === 'profile' && parsed.args[0] !== undefined && !parsed.args[0].startsWith('-')
      ? `profile ${parsed.args[0]}`
      : command;

  if (!KNOWN_COMMANDS.has(command)) {
    const exitCode = EXIT.VALIDATION_OR_PREFLIGHT;
    if (json) {
      return {
        text: renderEnvelope(errorEnvelope(deps.getLocale(), commandLabel, 'USAGE', `unknown command: ${command}`)),
        stderr: '',
        locale: deps.getLocale(),
        exitCode,
      };
    }
    return { text: '', stderr: deps.t('error.unknownCommand', { command }), locale: deps.getLocale(), exitCode };
  }

  try {
    const result = await dispatchCommand(command, deps, parsed.args, {
      timeoutMs: parsed.timeoutMs,
      signal,
    });
    return finish(deps, result, { json, command: commandLabel, verbose: parsed.verbose, ms: Date.now() - startedAtMs });
  } catch (error) {
    const exitCode = exitCodeForError(error);
    if (json) {
      const machine = machineErrorFor(error);
      return {
        text: renderEnvelope(errorEnvelope(deps.getLocale(), commandLabel, machine.code, machine.detail)),
        stderr: '',
        locale: deps.getLocale(),
        exitCode,
      };
    }
    const base = humanErrorText(error, deps);
    const stderr = parsed.verbose
      ? `${base}\n${deps.t('verbose.line', { command: commandLabel, locale: deps.getLocale(), ms: String(Date.now() - startedAtMs) })}`
      : base;
    return { text: '', stderr, locale: deps.getLocale(), exitCode };
  }
}

interface DispatchContext {
  timeoutMs: number | null;
  signal?: AbortSignal;
}

async function dispatchCommand(
  command: string,
  deps: CliDeps,
  args: readonly string[],
  context: DispatchContext,
): Promise<CommandOutput> {
  switch (command) {
    case 'profile':
      return runProfileCommand(deps, args);
    case 'apply':
      return runApplyCommand(deps, args, context);
    case 'models':
      return runModelsCommand(deps, args);
    case 'current':
      return runCurrentCommand(deps, args);
    case 'snapshot':
      return runSnapshotCommand(deps, args);
    case 'hardware':
      return runHardwareCommand(deps);
    case 'lang':
      return runLangCommand(deps, args);
    case 'doctor':
      return runDoctorCommand(deps, args);
  }
  // Unreachable: dispatch is only reached for KNOWN_COMMANDS.
  throw new Error(`no handler for command: ${command}`);
}

interface FinishOptions {
  json: boolean;
  command: string;
  verbose: boolean;
  ms: number;
}

function finish(deps: CliDeps, output: CommandOutput, options: FinishOptions): RunCliResult {
  const locale = deps.getLocale();
  // apply reports the transaction outcome (0/2/3/5); every other command is a
  // plain success. The machine envelope's ok flag describes the run, not the
  // transaction result, so a recovered/failed apply still exits 3/5.
  const exitCode = output.exitCode ?? EXIT.SUCCESS;
  if (options.json) {
    if (output.literal !== undefined) {
      // `profile export` / `profile edit` templates print the document verbatim
      // in machine mode too; the envelope must never wrap a raw document.
      return { text: output.literal, stderr: '', locale, exitCode };
    }
    return {
      text: renderEnvelope(successEnvelope(locale, options.command, output.data)),
      stderr: '',
      locale,
      exitCode,
    };
  }
  const stderr = options.verbose
    ? deps.t('verbose.line', { command: options.command, locale, ms: String(options.ms) })
    : '';
  return { text: output.text, stderr, locale, exitCode };
}

/**
 * Resolves the effective locale (--lang → stored → system → default), applies
 * it when it differs from the current one, and returns it. A corrupt config
 * falls back instead of crashing the CLI (doctor reports the write path).
 */
function resolveAndApplyLocale(deps: CliDeps, requested: string | null): Locale {
  const resolved = resolveLocale(deps, requested);
  if (resolved !== deps.getLocale()) {
    try {
      deps.applyLocale(resolved);
    } catch {
      // Persistence failure: `lang` surfaces it as exit 10; other commands keep
      // the resolved locale for rendering.
    }
  }
  return resolved;
}

function resolveLocale(deps: CliDeps, requested: string | null): Locale {
  if (requested !== null) {
    const normalized = normalizeLocale(requested);
    if (normalized !== null) return normalized;
  }
  // Missing or corrupt config.json both mean "no stored language".
  const stored = readStoredLocale(deps);
  if (stored !== null) return stored;
  const system = deps.systemLocale();
  if (system !== null) {
    const normalized = normalizeLocale(system);
    if (normalized !== null) return normalized;
  }
  return DEFAULT_LOCALE;
}

function readStoredLocale(deps: CliDeps): Locale | null {
  try {
    return deps.storedLocale();
  } catch {
    return null;
  }
}

/** Maps any thrown error to localized human text; never leaks paths or values. */
function humanErrorText(error: unknown, deps: CliDeps): string {
  if (isCliError(error)) {
    switch (error.code) {
      case 'CAPABILITY_UNSUPPORTED':
        return deps.t('error.capabilityUnsupported', { field: error.detail ?? '' });
      case 'INTERNAL':
        return deps.t('error.internal');
      default: {
        if (error.params?.key !== undefined) {
          return deps.t(error.params.key, error.params.values ?? {});
        }
        return deps.t('error.usage', { detail: error.detail ?? error.message });
      }
    }
  }
  if (isActivationError(error)) {
    switch (error.code) {
      case 'ACTIVATION_LOCK_BUSY':
        return deps.t('error.lockBusy');
      case 'ACTIVATION_PREFLIGHT':
        return deps.t('error.activationPreflight', { detail: error.detail ?? '' });
      case 'ACTIVATION_CANCELED':
        return deps.t('apply.canceled');
      default:
        return deps.t('error.activationStepFailed', { detail: error.detail ?? error.code });
    }
  }
  if (isProfileStoreError(error)) {
    switch (error.code) {
      case 'STORE_NOT_FOUND':
        return deps.t('error.profileNotFound');
      case 'STORE_ALREADY_EXISTS':
        return deps.t('error.profileExists');
      case 'STORE_INVALID_ID':
        return deps.t('error.badId');
      case 'STORE_IMPORT_FAILED':
        return deps.t('error.importFailed');
      default:
        return exitCodeForError(error) === EXIT.VALIDATION_OR_PREFLIGHT
          ? deps.t('error.validationFailed')
          : deps.t('error.internal');
    }
  }
  if (isDomainError(error)) return deps.t('error.validationFailed');
  if (error instanceof LocaleResourceError) return deps.t('error.internal');
  return deps.t('error.internal');
}