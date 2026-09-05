import { describe, expect, it } from 'vitest';
import { runCli } from '../../apps/cli/src/run.ts';
import { envelopeOf, makeCliHarness } from '../cli/helpers';
import { validProfile } from '../profile-store/fixtures';

describe('CLI locale resolution and machine-JSON stability (M1-004)', () => {
  it('prints the Chinese usage when --lang zh-CN is requested', async () => {
    const { deps } = makeCliHarness();
    const result = await runCli(['--lang', 'zh-CN', '--help'], deps);
    expect(result.locale).toBe('zh-CN');
    expect(result.exitCode).toBe(0);
    expect(result.text).toContain('用法：lmps');
  });

  it('prints the English usage when --lang en is requested', async () => {
    const { deps } = makeCliHarness();
    const result = await runCli(['--lang', 'en', '--help'], deps);
    expect(result.locale).toBe('en');
    expect(result.text).toContain('Usage: lmps');
  });

  it('falls back to English for an unsupported language', async () => {
    const { deps } = makeCliHarness();
    const result = await runCli(['--lang', 'fr', '--json', 'lang'], deps);
    expect(result.locale).toBe('en');
    expect(envelopeOf(result.text).locale).toBe('en');
  });

  it('normalizes regional spellings of supported languages', async () => {
    const { deps } = makeCliHarness();
    const simplified = await runCli(['--lang', 'zh', '--json', 'lang'], deps);
    expect(simplified.locale).toBe('zh-CN');

    const upper = await runCli(['--lang', 'EN', '--json', 'lang'], deps);
    expect(upper.locale).toBe('en');
  });

  it('keeps machine JSON field names and values unlocalized', async () => {
    const zh = await runCli(['--json', '--lang', 'zh-CN', 'profile', 'list'], makeCliHarness().deps);
    const en = await runCli(['--json', '--lang', 'en', 'profile', 'list'], makeCliHarness().deps);

    expect(envelopeOf(zh.text).locale).toBe('zh-CN');
    expect(envelopeOf(en.text).locale).toBe('en');
    expect(envelopeOf(zh.text).data).toEqual({ count: 0, profiles: [] });
    expect(envelopeOf(zh.text).data).toEqual(envelopeOf(en.text).data);
    // Machine output must not carry localized prose.
    expect(zh.text).not.toContain('欢迎');
    expect(en.text).not.toContain('Welcome');
  });

  it('leaves machine data byte-identical across locales for profile list', async () => {
    const zh = makeCliHarness();
    zh.store.create(validProfile('alpha'));
    const en = makeCliHarness();
    en.store.create(validProfile('alpha'));

    const zhResult = await runCli(['--json', '--lang', 'zh-CN', 'profile', 'list'], zh.deps);
    const enResult = await runCli(['--json', 'profile', 'list'], en.deps);
    expect(envelopeOf(zhResult.text).data).toEqual(envelopeOf(enResult.text).data);
    expect(envelopeOf(zhResult.text).locale).toBe('zh-CN');
  });
});