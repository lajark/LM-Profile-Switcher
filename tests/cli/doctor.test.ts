import { describe, expect, it } from 'vitest';
import { okResult, nvidiaSmiSingleGpu, coresJson, volumeJsonArray } from '../hardware/fixtures';

import { runCli } from '../../apps/cli/src/run.ts';
import { envelopeOf, makeCliHarness } from './helpers';

describe('doctor command', () => {
  it('reports all checks OK and exits 0', async () => {
    const { deps } = makeCliHarness();
    const result = await runCli(['doctor'], deps);
    expect(result.exitCode).toBe(0);
    expect(result.text).toContain('environment check');
    expect(result.text).toContain('[OK]');
    expect(result.text).not.toContain('[FAIL]');
  });

  it('reports a machine summary with per-check detail', async () => {
    const { deps } = makeCliHarness();
    const result = await runCli(['--json', 'doctor'], deps);
    expect(result.exitCode).toBe(0);
    const envelope = envelopeOf(result.text);
    expect(envelope.ok).toBe(true);
    const data = envelope.data as {
      checks: Array<{ id: string; ok: boolean }>;
      warnings: string[];
      summary: { ok: boolean };
    };
    expect(data.warnings).toEqual(['discovery']);
    expect(data.summary.ok).toBe(true);
    expect(data.checks.map((check) => check.id)).toEqual([
      'store',
      'config',
      'locale',
      'node',
      'discovery',
      'hardware',
    ]);
    expect(data.checks.find((check) => check.id === 'store')?.ok).toBe(true);
    expect(data.checks.find((check) => check.id === 'discovery')).toMatchObject({ ok: true });
  });

  it('marks a corrupted language config as a failing check but keeps exit 0', async () => {
    const { deps, fs } = makeCliHarness();
    fs.writeFileUtf8('/cli-root/config.json', '{oops');
    const human = await runCli(['doctor'], deps);
    expect(human.exitCode).toBe(0);
    expect(human.text).toContain('[FAIL]');
    // Unrecoverable internals still surface in the machine envelope only when --json.
    const json = await runCli(['--json', 'doctor'], deps);
    const envelope = envelopeOf(json.text);
    const data = envelope.data as { checks: Array<{ id: string; ok: boolean }>; summary: { ok: boolean } };
    expect(data.checks.find((check) => check.id === 'config')?.ok).toBe(false);
    expect(data.summary.ok).toBe(false);
    expect(json.exitCode).toBe(0);
  });

  it('flags an unsupported node version as a failing check', async () => {
    const { deps } = makeCliHarness({ nodeVersion: '16.20.2' });
    const result = await runCli(['--json', 'doctor'], deps);
    const envelope = envelopeOf(result.text);
    const data = envelope.data as { checks: Array<{ id: string; ok: boolean }>; summary: { ok: boolean } };
    expect(data.checks.find((check) => check.id === 'node')?.ok).toBe(false);
    expect(data.summary.ok).toBe(false);
    expect(result.exitCode).toBe(0);
  });

  it('notes a wired discovery as a non-warning check', async () => {
    const { deps } = makeCliHarness({ discovery: { listModels: async () => [] } });
    const result = await runCli(['--json', 'doctor'], deps);
    const envelope = envelopeOf(result.text);
    const data = envelope.data as { warnings: string[] };
    expect(data.warnings).toEqual([]);
  });

  it('appends a redacted LOCAL-ONLY diagnostics bundle with --bundle', async () => {
    const { deps } = makeCliHarness({
      probeEnv: {
        os: {
          platform: () => 'win32',
          release: () => '10.0.26000',
          version: () => 'Windows 11 Pro',
          arch: () => 'x64',
          cpus: () => [{ model: 'Synthetic CPU 1' }],
          totalmem: () => 34_359_738_368,
          freemem: () => 17_179_869_184,
          homeRoot: () => 'C:/',
        },
        run: async (cmd, args) => {
          if (cmd === 'nvidia-smi') return okResult(nvidiaSmiSingleGpu);
          if (cmd === 'powershell.exe') {
            const script = Buffer.from(args[args.length - 1] ?? '', 'base64').toString('utf16le');
            if (script.includes('Win32_Processor')) return okResult(coresJson);
            if (script.includes('Win32_LogicalDisk')) return okResult(volumeJsonArray);
            return null;
          }
          return null;
        },
        statfs: () => null,
        digest: (data) => `d:${data.length}`,
        now: () => '2026-08-22T01:02:03.000Z',
      },
    });
    const human = await runCli(['doctor', '--bundle'], deps);
    expect(human.text).toContain('LOCAL-ONLY');

    const json = await runCli(['--json', 'doctor', '--bundle'], deps);
    const envelope = envelopeOf(json.text);
    const data = envelope.data as { diagnostics: { nodeVersion: string; hardware: { os: string } } };
    expect(data.diagnostics.nodeVersion).toBe('24.13.1');
    expect(data.diagnostics.hardware.os).toBeTruthy();
  });
});