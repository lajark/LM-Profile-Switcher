import { describe, expect, it } from 'vitest';

import { runCli } from '../../apps/cli/src/run.ts';
import { envelopeOf, makeCliHarness } from './helpers';

describe('capability seams (models/current/snapshot)', () => {
  it('reports models as capability unsupported (exit 6) when not wired', async () => {
    const { deps } = makeCliHarness();
    const result = await runCli(['models'], deps);
    expect(result.exitCode).toBe(6);
    expect(result.stderr).toContain('does not support');
    expect(result.stderr).toContain('models');
    expect(result.text).toBe('');
  });

  it('returns a machine CAPABILITY_UNSUPPORTED envelope with empty stderr', async () => {
    const { deps } = makeCliHarness();
    const result = await runCli(['--json', 'models'], deps);
    expect(result.exitCode).toBe(6);
    expect(result.stderr).toBe('');
    const envelope = envelopeOf(result.text);
    expect(envelope.ok).toBe(false);
    expect(envelope.command).toBe('models');
    expect(envelope.error?.code).toBe('CAPABILITY_UNSUPPORTED');
    expect(envelope.error?.detail).toBe('models');
  });

  it('lists models once discovery is wired', async () => {
    const { deps } = makeCliHarness({
      discovery: {
        listModels: async () => [
          { key: 'synthetic/test-model', family: 'gpt-test', quantization: 'q4', parametersB: 7 },
        ],
      },
    });
    const result = await runCli(['--json', 'models'], deps);
    expect(result.exitCode).toBe(0);
    const envelope = envelopeOf(result.text);
    expect(envelope.data).toEqual({
      models: [{ key: 'synthetic/test-model', family: 'gpt-test', quantization: 'q4', parametersB: 7 }],
    });
  });

  it('reports current as capability unsupported (exit 6) when not wired', async () => {
    const { deps } = makeCliHarness();
    const result = await runCli(['current'], deps);
    expect(result.exitCode).toBe(6);
    const json = await runCli(['--json', 'current'], deps);
    expect(envelopeOf(json.text).error?.code).toBe('CAPABILITY_UNSUPPORTED');
  });

  it('shows the active state once the state port is wired', async () => {
    const { deps } = makeCliHarness({
      state: { getActive: async () => ({ profileId: 'alpha', modelKey: 'synthetic/test-model', since: '2026-08-22T01:02:03.000Z' }) },
    });
    const result = await runCli(['--json', 'current'], deps);
    expect(result.exitCode).toBe(0);
    const envelope = envelopeOf(result.text);
    expect(envelope.data).toEqual({
      active: { profileId: 'alpha', modelKey: 'synthetic/test-model', since: '2026-08-22T01:02:03.000Z' },
    });
  });

  it('reports snapshot as capability unsupported (exit 6) when not wired', async () => {
    const { deps } = makeCliHarness();
    const result = await runCli(['snapshot'], deps);
    expect(result.exitCode).toBe(6);
    const json = await runCli(['--json', 'snapshot'], deps);
    expect(envelopeOf(json.text).error?.code).toBe('CAPABILITY_UNSUPPORTED');
  });

  it('captures a snapshot once the port is wired', async () => {
    const { deps } = makeCliHarness({
      snapshot: {
        capture: async () => ({
          profileId: 'alpha',
          at: '2026-08-22T01:02:05.000Z',
          captured: { runtime: { contextLength: 8192 } },
        }),
      },
    });
    const result = await runCli(['--json', 'snapshot'], deps);
    expect(result.exitCode).toBe(0);
    const envelope = envelopeOf(result.text);
    expect(envelope.data).toEqual({
      snapshot: {
        profileId: 'alpha',
        at: '2026-08-22T01:02:05.000Z',
        captured: { runtime: { contextLength: 8192 } },
      },
    });
  });
});