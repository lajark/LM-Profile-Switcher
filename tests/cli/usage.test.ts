import { describe, expect, it } from 'vitest';

import { runCli } from '../../apps/cli/src/run.ts';
import { envelopeOf, makeCliHarness } from './helpers';

describe('CLI usage and dispatch', () => {
  it('prints the bilingual usage with exit 0 for --help', async () => {
    const { deps } = makeCliHarness();
    const result = await runCli(['--help'], deps);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.locale).toBe('en');
    expect(result.text).toContain('Usage: lmps');
    expect(result.text).toContain('profile list');
    expect(result.text).toContain('apply <id>');
    expect(result.text).toContain('--yes');
    expect(result.text).toContain('--timeout');

    const zh = await runCli(['--lang', 'zh-CN', '--help'], deps);
    expect(zh.locale).toBe('zh-CN');
    expect(zh.text).toContain('用法：lmps');
    expect(zh.text).toContain('apply <id>');
  });

  it('fails with usage on stderr when no command is given', async () => {
    const { deps } = makeCliHarness();
    const result = await runCli([], deps);
    expect(result.exitCode).toBe(4);
    expect(result.text).toBe('');
    expect(result.stderr).toContain('No command given');
    expect(result.stderr).toContain('lmps --help');
  });

  it('returns a machine error envelope for a bare --json call', async () => {
    const { deps } = makeCliHarness();
    const result = await runCli(['--json'], deps);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toBe('');
    const envelope = envelopeOf(result.text);
    expect(envelope.ok).toBe(false);
    expect(envelope.product).toBe('lmps');
    expect(envelope.api).toBe(1);
    expect(envelope.error?.code).toBe('USAGE');
    expect(envelope.command).toBeNull();
  });

  it('rejects an unknown command on stderr', async () => {
    const { deps } = makeCliHarness();
    const result = await runCli(['frobnicate'], deps);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain('Unknown command: frobnicate');
    expect(result.text).toBe('');
  });

  it('rejects an unknown command with a machine envelope', async () => {
    const { deps } = makeCliHarness();
    const result = await runCli(['--json', 'frobnicate'], deps);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toBe('');
    const envelope = envelopeOf(result.text);
    expect(envelope.command).toBe('frobnicate');
    expect(envelope.error?.code).toBe('USAGE');
  });

  it('rejects stray flags without a command', async () => {
    const { deps } = makeCliHarness();
    const result = await runCli(['--bogus'], deps);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain('Invalid usage');
  });
});