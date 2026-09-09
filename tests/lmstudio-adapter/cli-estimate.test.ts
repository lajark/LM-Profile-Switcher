import { describe, expect, it } from 'vitest';

import type { CompositeProfile } from '@lmps/domain';
import {
  createCliAdapter,
  createCliEstimatePort,
  createMockEstimatePort,
  estimateArgs,
  LmStudioError,
  parseLmsEstimateValues,
  ROUGH_ESTIMATE_WARNING,
} from '@lmps/lmstudio-adapter';
import { makeFakeEnv, NOW, SPAWN_OK } from './fixtures.js';

function makeProfile(modelKey: string, runtime: Record<string, unknown> = {}): CompositeProfile {
  return {
    schemaVersion: 2,
    id: `p-${modelKey.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`,
    displayName: { 'zh-CN': '测试', en: 'test' },
    model: { modelKey },
    task: { type: 'chat' },
    runtime,
    generation: {},
    behavior: { mode: 'exclusive' },
    metadata: { createdAt: NOW, updatedAt: NOW },
  } as CompositeProfile;
}

const QWEN_KEY = 'qwen2.5-7b-instruct-q4_k_m.gguf';

describe('parseLmsEstimateValues', () => {
  it('reads a documented `| label | size |` table', () => {
    const stdout = [
      '+----------------------+---------------------+',
      '| Model                | qwen2.5-7b.gguf     |',
      '| Quantization         | Q4_K_M              |',
      '| VRAM usage           | 6.2 GiB             |',
      '| System RAM           | 1.0 GiB             |',
      '+----------------------+---------------------+',
    ].join('\n');
    expect(parseLmsEstimateValues(stdout)).toEqual({
      vramTotalBytes: Math.round(6.2 * 1024 ** 3),
      systemRamBytes: 1024 ** 3,
    });
  });

  it('reads `label: size` lines and decimal GB', () => {
    const stdout = 'VRAM: 4.5 GB\nRAM: 512 MB';
    expect(parseLmsEstimateValues(stdout)).toEqual({
      vramTotalBytes: Math.round(4.5 * 1e9),
      systemRamBytes: 512 * 1e6,
    });
  });

  it('does not mistake the VRAM label for a RAM figure', () => {
    // The ASCII table strips to `VRAM ...`; the trailing `RAM` cell of the
    // *table footer* must not overwrite the real RAM figure.
    const stdout = [
      '| VRAM usage  | 3 GiB |',
      '| System RAM  | 2 GiB |',
      '| VRAM        |       |', // empty value after a VRAM label
    ].join('\n');
    const values = parseLmsEstimateValues(stdout);
    expect(values).toEqual({ vramTotalBytes: 3 * 1024 ** 3, systemRamBytes: 2 * 1024 ** 3 });
  });

  it('reads both figures from a single line without cross-reading', () => {
    const stdout = 'VRAM: 4 GiB · System RAM: 1 GiB';
    expect(parseLmsEstimateValues(stdout)).toEqual({ vramTotalBytes: 4 * 1024 ** 3, systemRamBytes: 1024 ** 3 });
  });

  it('accepts a partial result when only one figure is present', () => {
    expect(parseLmsEstimateValues('GPU memory: 8.0 GiB')).toEqual({
      vramTotalBytes: Math.round(8.0 * 1024 ** 3),
      systemRamBytes: null,
    });
  });

  it('returns null when no confident classification is possible', () => {
    expect(parseLmsEstimateValues('')).toBeNull();
    expect(parseLmsEstimateValues('Model: x.gguf\nQuantization: Q4_K_M')).toBeNull();
    expect(parseLmsEstimateValues('GPU layers: 33/33')).toBeNull();
    expect(parseLmsEstimateValues('garbage 42')).toBeNull();
  });
});

describe('estimateArgs', () => {
  it('estimates the model by default with autoprobe, non-interactively', () => {
    // `--yes` is mandatory for scripting: without it (real host 2026-09-05)
    // `lms load --estimate-only` opens the interactive model selector TUI and
    // a non-TTY CLI hangs until the estimate timeout.
    expect(estimateArgs(makeProfile(QWEN_KEY))).toEqual(['load', QWEN_KEY, '--estimate-only', '--yes']);
  });

  it('passes the profile context length so the estimate matches the load config', () => {
    expect(estimateArgs(makeProfile(QWEN_KEY, { contextLength: 8192 }))).toEqual([
      'load',
      QWEN_KEY,
      '--estimate-only',
      '--yes',
      '--context-length',
      '8192',
    ]);
  });
});

describe('createCliAdapter estimate', () => {
  it('returns an explicit exact estimate with parsed figures', async () => {
    const env = makeFakeEnv({
      runLmsHandler: () => ({
        exitCode: 0,
        stdout: '| VRAM usage | 6.2 GiB |\n| System RAM | 1.0 GiB |',
        stderr: '',
        timedOut: false,
      }),
    });
    const estimate = await createCliAdapter(env).estimate(makeProfile(QWEN_KEY, { contextLength: 8192 }));
    expect(estimate).toMatchObject({
      schemaVersion: 2,
      provider: 'exact',
      modelKey: QWEN_KEY,
      quantization: 'Q4_K_M',
      contextLength: 8192,
      vramTotalBytes: Math.round(6.2 * 1024 ** 3),
      systemRamBytes: 1024 ** 3,
      estimatedAt: NOW,
      warnings: [],
    });
  });

  it('reads the estimate even when lms writes it to stderr (real host 2026-09-05)', async () => {
    // Live host: `lms load --estimate-only --yes` prints the human-readable
    // estimate to stderr with stdout empty; the port must not degrade to rough.
    const env = makeFakeEnv({
      runLmsHandler: () => ({
        exitCode: 0,
        stdout: '',
        stderr: [
          'Model: qwen/qwen3.5-9b',
          'Context Length: 8,192',
          'Estimated GPU Memory:   6.10 GiB',
          'Estimated Total Memory: 6.10 GiB',
          'Confidence: LOW',
        ].join('\n'),
        timedOut: false,
      }),
    });
    const estimate = await createCliAdapter(env).estimate(makeProfile('qwen/qwen3.5-9b', { contextLength: 8192 }));
    expect(estimate.provider).toBe('exact');
    expect(estimate.vramTotalBytes).toBe(Math.round(6.1 * 1024 ** 3));
    expect(estimate.systemRamBytes).toBe(Math.round(6.1 * 1024 ** 3));
  });

  it('classifies a spawn timeout as a timeout error', async () => {
    const env = makeFakeEnv({
      runLmsHandler: () => ({ exitCode: 124, stdout: '', stderr: '', timedOut: true }),
    });
    await expect(createCliAdapter(env).estimate(makeProfile(QWEN_KEY))).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('classifies a non-zero exit (missing binary) as a process error', async () => {
    const env = makeFakeEnv({
      runLmsHandler: () => ({ exitCode: 127, stdout: '', stderr: 'spawn failed: ENOENT', timedOut: false }),
    });
    await expect(createCliAdapter(env).estimate(makeProfile(QWEN_KEY))).rejects.toMatchObject({ kind: 'process' });
  });

  it('classifies unrecognizable output as a parse error', async () => {
    const env = makeFakeEnv({
      runLmsHandler: () => ({ exitCode: 0, stdout: 'Model loaded. nothing else', stderr: '', timedOut: false }),
    });
    await expect(createCliAdapter(env).estimate(makeProfile(QWEN_KEY))).rejects.toMatchObject({ kind: 'parse' });
  });
});

describe('createCliEstimatePort', () => {
  it('returns the exact estimate when the CLI answers', async () => {
    const env = makeFakeEnv({
      runLmsHandler: () => ({ ...SPAWN_OK, stdout: 'VRAM: 6.2 GiB' }),
    });
    const estimate = await createCliEstimatePort(env).estimate(makeProfile(QWEN_KEY));
    expect(estimate.provider).toBe('exact');
    expect(estimate.vramTotalBytes).toBe(Math.round(6.2 * 1024 ** 3));
  });

  it('degrades to an explicit rough estimate on timeout without inventing figures', async () => {
    const env = makeFakeEnv({
      runLmsHandler: () => ({ exitCode: 124, stdout: '', stderr: '', timedOut: true }),
    });
    const estimate = await createCliEstimatePort(env).estimate(makeProfile(QWEN_KEY, { contextLength: 4096 }));
    expect(estimate.provider).toBe('rough');
    expect(estimate.vramTotalBytes).toBeNull();
    expect(estimate.systemRamBytes).toBeNull();
    expect(estimate.contextLength).toBe(4096);
    expect(estimate.warnings).toEqual([ROUGH_ESTIMATE_WARNING]);
  });

  it('degrades on parse drift', async () => {
    const env = makeFakeEnv({
      runLmsHandler: () => ({ exitCode: 0, stdout: 'nothing useful', stderr: '', timedOut: false }),
    });
    const estimate = await createCliEstimatePort(env).estimate(makeProfile(QWEN_KEY));
    expect(estimate.provider).toBe('rough');
  });

  it('rethrows internal errors instead of masking a bug', async () => {
    const env = makeFakeEnv({
      runLmsHandler: () => {
        throw new LmStudioError('boom', { subsystem: 'cli', kind: 'internal' });
      },
    });
    await expect(createCliEstimatePort(env).estimate(makeProfile(QWEN_KEY))).rejects.toMatchObject({ kind: 'internal' });
  });

  it('rethrows unexpected exceptions intact', async () => {
    const env = makeFakeEnv({
      runLmsHandler: () => {
        throw new Error('unexpected blast');
      },
    });
    await expect(createCliEstimatePort(env).estimate(makeProfile(QWEN_KEY))).rejects.toThrow('unexpected blast');
  });
});

describe('createMockEstimatePort', () => {
  it('returns a deterministic rough estimate without touching any host', async () => {
    const estimate = await createMockEstimatePort(() => NOW).estimate(makeProfile(QWEN_KEY, { contextLength: 2048 }));
    expect(estimate).toMatchObject({
      schemaVersion: 2,
      provider: 'rough',
      modelKey: QWEN_KEY,
      contextLength: 2048,
      vramTotalBytes: null,
      systemRamBytes: null,
      estimatedAt: NOW,
      warnings: [ROUGH_ESTIMATE_WARNING],
    });
  });
});