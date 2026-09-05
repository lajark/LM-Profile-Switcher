/**
 * Hand-rolled argument parsing for the `lmps` CLI (M1-004). No command-parsing
 * dependency: global flags are recognized anywhere, the first bare word is the
 * command, everything else flows to the per-command parser. Machine stability
 * matters more than ergonomics, so every parse error has a stable exit code.
 */
import { CliError } from './errors.js';

export type FlagKind = 'boolean' | 'string';

export interface ParsedCli {
  json: boolean;
  /** Raw --lang value; normalized later (never trusted here). */
  lang: string | null;
  verbose: boolean;
  noColor: boolean;
  /** Parsed but not enforced until discovery wiring lands (CLI_SPEC). */
  timeoutMs: number | null;
  help: boolean;
  command: string | null;
  args: string[];
  raw: string[];
}

export function parseArgs(argv: readonly string[]): ParsedCli {
  const parsed: ParsedCli = {
    json: false,
    lang: null,
    verbose: false,
    noColor: false,
    timeoutMs: null,
    help: false,
    command: null,
    args: [],
    raw: [...argv],
  };

  let index = 0;
  while (index < argv.length) {
    const arg = argv[index];
    if (arg === undefined) break;
    if (arg === '--json') {
      parsed.json = true;
      index += 1;
    } else if (arg === '--verbose') {
      parsed.verbose = true;
      index += 1;
    } else if (arg === '--no-color') {
      parsed.noColor = true;
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      index += 1;
    } else if (arg === '--lang') {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new CliError('USAGE', '--lang requires a value', { detail: '--lang requires a value' });
      }
      parsed.lang = value;
      index += 2;
    } else if (arg === '--timeout') {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new CliError('USAGE', '--timeout requires a value', { detail: '--timeout requires a value' });
      }
      parsed.timeoutMs = parseTimeout(value);
      index += 2;
    } else if (arg.startsWith('--lang=')) {
      parsed.lang = arg.slice('--lang='.length);
      index += 1;
    } else if (arg.startsWith('--timeout=')) {
      parsed.timeoutMs = parseTimeout(arg.slice('--timeout='.length));
      index += 1;
    } else if (parsed.command === null && !arg.startsWith('-')) {
      parsed.command = arg;
      index += 1;
    } else {
      parsed.args.push(arg);
      index += 1;
    }
  }
  return parsed;
}

function parseTimeout(value: string): number {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms < 0) {
    throw new CliError('USAGE', '--timeout must be a non-negative number of milliseconds', {
      detail: `invalid --timeout value: ${value}`,
    });
  }
  return Math.round(ms);
}

export interface CommandSpec {
  /** Long flag names → value kind. */
  flags?: Record<string, FlagKind>;
  /** Short aliases for value flags (e.g. `-o` → `output`). */
  short?: Record<string, string>;
  /** Maximum positional arguments accepted; more is a usage error. */
  maxPositional?: number;
}

export interface ParsedCommand {
  command: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

/**
 * Parses the trailing arguments of one subcommand against its little spec.
 * Unknown flags, missing values and too many positional arguments throw USAGE.
 */
export function parseCommandArgs(spec: CommandSpec, args: readonly string[]): ParsedCommand {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  const kinds = spec.flags ?? {};

  let index = 0;
  while (index < args.length) {
    const arg = args[index];
    if (arg === undefined) break;
    if (arg === '--') {
      positionals.push(...args.slice(index + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      const kind = kinds[name];
      if (kind === undefined) {
        throw new CliError('USAGE', 'unknown flag', { detail: `unknown flag: ${name}` });
      }
      if (kind === 'boolean') {
        if (eq !== -1) throw new CliError('USAGE', 'boolean flag takes no value', { detail: `--${name} takes no value` });
        flags[name] = true;
        index += 1;
      } else {
        const value = eq === -1 ? args[index + 1] : arg.slice(eq + 1);
        if (value === undefined) throw new CliError('USAGE', 'flag requires a value', { detail: `--${name} requires a value` });
        flags[name] = value;
        index += eq === -1 ? 2 : 1;
      }
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && spec.short !== undefined) {
      const target = spec.short[arg];
      if (target === undefined) {
        throw new CliError('USAGE', 'unknown short flag', { detail: `unknown flag: ${arg}` });
      }
      const value = args[index + 1];
      if (value === undefined) throw new CliError('USAGE', 'short flag requires a value', { detail: `${arg} requires a value` });
      flags[target] = value;
      index += 2;
      continue;
    }
    positionals.push(arg);
    index += 1;
  }

  const max = spec.maxPositional ?? Infinity;
  if (positionals.length > max) {
    throw new CliError('USAGE', 'too many arguments', {
      detail: `expected at most ${max === Infinity ? 'unbounded' : `${max}`} positional argument(s), got ${positionals.length}`,
    });
  }
  return { command: positionals[0] ?? '', positionals, flags };
}