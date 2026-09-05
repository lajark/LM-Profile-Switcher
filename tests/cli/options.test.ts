import { describe, expect, it } from 'vitest';

import { parseArgs, parseCommandArgs } from '../../apps/cli/src/options.ts';
import { isCliError } from '../../apps/cli/src/errors.ts';

describe('parseArgs (global flags)', () => {
  it('parses an empty invocation', () => {
    expect(parseArgs([])).toEqual({
      json: false,
      lang: null,
      verbose: false,
      noColor: false,
      timeoutMs: null,
      help: false,
      command: null,
      args: [],
      raw: [],
    });
  });

  it('takes the first bare word as the command', () => {
    const parsed = parseArgs(['profile', 'list']);
    expect(parsed.command).toBe('profile');
    expect(parsed.args).toEqual(['list']);
  });

  it('accepts global flags in any position', () => {
    const before = parseArgs(['--json', '--lang', 'zh-CN', 'lang']);
    expect(before.json).toBe(true);
    expect(before.lang).toBe('zh-CN');
    expect(before.command).toBe('lang');

    const after = parseArgs(['lang', '--json', '--lang=en']);
    expect(after.command).toBe('lang');
    expect(after.json).toBe(true);
    expect(after.lang).toBe('en');
    expect(after.args).toEqual([]);
  });

  it('supports --lang=value and --timeout=value forms', () => {
    const parsed = parseArgs(['--lang=zh', '--timeout=12000', 'hardware']);
    expect(parsed.lang).toBe('zh');
    expect(parsed.timeoutMs).toBe(12000);
  });

  it('parses boolean flags --verbose/--no-color/--help/-h', () => {
    const parsed = parseArgs(['--verbose', '--no-color', '--help']);
    expect(parsed.verbose).toBe(true);
    expect(parsed.noColor).toBe(true);
    expect(parsed.help).toBe(true);

    expect(parseArgs(['-h']).help).toBe(true);
  });

  it('leaves unknown flags for the subcommand parser', () => {
    const parsed = parseArgs(['profile', '--model', 'xyz']);
    expect(parsed.command).toBe('profile');
    expect(parsed.args).toEqual(['--model', 'xyz']);
  });

  it('rejects a missing --lang value', () => {
    try {
      parseArgs(['--lang']);
      expect.unreachable();
    } catch (error) {
      expect(isCliError(error)).toBe(true);
    }
  });

  it('rejects a non-numeric --timeout', () => {
    try {
      parseArgs(['--timeout', 'soon']);
      expect.unreachable();
    } catch (error) {
      expect(isCliError(error)).toBe(true);
    }
  });
});

describe('parseCommandArgs (subcommand flags)', () => {
  const spec = {
    flags: { format: 'string', yes: 'boolean', 'allow-rename': 'boolean' },
    short: { '-o': 'output' },
    maxPositional: 2,
  } as const;

  it('extracts known string/boolean flags and positionals', () => {
    const parsed = parseCommandArgs(spec, ['alpha', '--format', 'yaml', '--yes']);
    expect(parsed.positionals).toEqual(['alpha']);
    expect(parsed.flags).toEqual({ format: 'yaml', yes: true });
  });

  it('supports --flag=value and short -o values', () => {
    const parsed = parseCommandArgs(spec, ['alpha', '--format=json', '-o', 'out.json']);
    expect(parsed.flags).toEqual({ format: 'json', output: 'out.json' });
  });

  it('rejects unknown flags', () => {
    try {
      parseCommandArgs(spec, ['alpha', '--bogus']);
      expect.unreachable();
    } catch (error) {
      expect(isCliError(error)).toBe(true);
    }
  });

  it('rejects a missing string flag value', () => {
    try {
      parseCommandArgs(spec, ['alpha', '--format']);
      expect.unreachable();
    } catch (error) {
      expect(isCliError(error)).toBe(true);
    }
  });

  it('rejects too many positional arguments', () => {
    try {
      parseCommandArgs(spec, ['a', 'b', 'c']);
      expect.unreachable();
    } catch (error) {
      expect(isCliError(error)).toBe(true);
    }
  });
});