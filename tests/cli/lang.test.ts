import { describe, expect, it } from 'vitest';

import { runCli } from '../../apps/cli/src/run.ts';
import { envelopeOf, makeCliHarness } from './helpers';

describe('lang command', () => {
  it('shows the effective language', async () => {
    const { deps } = makeCliHarness();
    const result = await runCli(['lang'], deps);
    expect(result.exitCode).toBe(0);
    expect(result.locale).toBe('en');
    expect(result.text).toContain('Current language: en');
    expect(result.stderr).toBe('');
  });

  it('reports the language in machine JSON', async () => {
    const { deps } = makeCliHarness();
    const result = await runCli(['--json', 'lang'], deps);
    const envelope = envelopeOf(result.text);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('lang');
    expect(envelope.data).toEqual({ locale: 'en' });
  });

  it('switches and persists the language', async () => {
    const { deps, fs } = makeCliHarness();
    const result = await runCli(['lang', 'zh-CN'], deps);
    expect(result.exitCode).toBe(0);
    expect(result.locale).toBe('zh-CN');
    expect(result.text).toContain('已切换');

    const config = JSON.parse(fs.readFileUtf8('/cli-root/config.json'));
    expect(config.locale).toBe('zh-CN');
  });

  it('normalizes spelling variants when persisting', async () => {
    const { deps, fs } = makeCliHarness();
    await runCli(['lang', 'zh'], deps);
    expect(JSON.parse(fs.readFileUtf8('/cli-root/config.json')).locale).toBe('zh-CN');
  });

  it('rejects an unsupported language with exit 4', async () => {
    const { deps } = makeCliHarness();
    const result = await runCli(['lang', 'gibberish'], deps);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain('Invalid language: gibberish');
    expect(result.text).toBe('');
  });

  it('returns a machine envelope for an invalid language', async () => {
    const { deps } = makeCliHarness();
    const result = await runCli(['--json', 'lang', 'gibberish'], deps);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toBe('');
    const envelope = envelopeOf(result.text);
    expect(envelope.ok).toBe(false);
    expect(envelope.error?.code).toBe('USAGE');
  });

  it('honors a stored language before the system default', async () => {
    const { deps, fs, i18n } = makeCliHarness();
    fs.writeFileUtf8('/cli-root/config.json', JSON.stringify({ locale: 'zh-CN' }));
    expect(i18n.getLocale()).toBe('en'); // constructed before the file existed
    const result = await runCli(['lang'], deps);
    expect(result.locale).toBe('zh-CN');
    expect(result.text).toContain('当前语言');
  });
});