import { describe, expect, it } from 'vitest';
import { probeHardware } from '@lmps/hardware';
import {
  coresJson,
  makeFakeProbeEnv,
  nvidiaSmiSingleGpu,
  okResult,
  volumeJsonArray,
} from '../hardware/fixtures';

import { runCli } from '../../apps/cli/src/run.ts';
import { envelopeOf, makeCliHarness } from './helpers';

describe('hardware command', () => {
  it('prints a bilingual human summary', async () => {
    const { deps } = makeCliHarness({
      probeEnv: makeFakeProbeEnv({
        nvidiaSmi: okResult(nvidiaSmiSingleGpu),
        cores: okResult(coresJson),
        volumes: okResult(volumeJsonArray),
      }),
    });
    const result = await runCli(['hardware'], deps);
    expect(result.exitCode).toBe(0);
    expect(result.text).toContain('Synthetic RTX 9000');
    expect(result.text).toContain('MEM:');
    expect(result.text).toContain('DISK X:\\: 1 TiB');
    expect(result.text).toContain('DISK Y:\\: 2 TiB');
    expect(result.stderr).toBe('');
  });

  it('reports unavailable sections without failing', async () => {
    const { deps } = makeCliHarness(); // every probe fails by default
    const result = await runCli(['hardware'], deps);
    expect(result.exitCode).toBe(0);
    expect(result.text).toContain('GPU: unknown');
  });

  it('returns the full probe profile as machine data', async () => {
    const fake = makeFakeProbeEnv({
      nvidiaSmi: okResult(nvidiaSmiSingleGpu),
      cores: okResult(coresJson),
      volumes: okResult(volumeJsonArray),
    });
    const { deps } = makeCliHarness({ probeEnv: fake });
    const result = await runCli(['--json', 'hardware'], deps);
    expect(result.exitCode).toBe(0);
    const envelope = envelopeOf(result.text);
    expect(envelope.command).toBe('hardware');
    expect(envelope.data).toEqual(await probeHardware(fake));
  });

  it('keeps machine output stable across locales', async () => {
    const fake = makeFakeProbeEnv({});
    const zh = makeCliHarness({ probeEnv: fake });
    const en = makeCliHarness({ probeEnv: makeFakeProbeEnv({}) });
    const zhResult = await runCli(['--json', '--lang', 'zh-CN', 'hardware'], zh.deps);
    const enResult = await runCli(['--json', 'hardware'], en.deps);
    expect(envelopeOf(zhResult.text).data).toEqual(envelopeOf(enResult.text).data);
    expect(envelopeOf(zhResult.text).locale).toBe('zh-CN');
  });
});