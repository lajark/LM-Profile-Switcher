import { describe, expect, it } from 'vitest';

import { createCliAdapter, loadArgs, parseLmsLs, parseLmsStatus } from '@lmps/lmstudio-adapter';
import { makeFakeEnv, NOW } from './fixtures.js';

describe('parseLmsStatus', () => {
  it('reads the human Server: ON/OFF line as the running state', () => {
    expect(parseLmsStatus('Server:  ON\n(i) To start/stop the server, run `lms server start`')).toEqual({
      serverRunning: true,
      version: null,
    });
    expect(parseLmsStatus('Server:  OFF')).toEqual({ serverRunning: false, version: null });
  });

  it('accepts running / stopped phrasing without Server:', () => {
    expect(parseLmsStatus('The local inference server is running')).toEqual({
      serverRunning: true,
      version: null,
    });
    expect(parseLmsStatus('The server is not running')).toEqual({ serverRunning: false, version: null });
  });

  it('returns null for empty or self-contradictory output', () => {
    expect(parseLmsStatus('')).toBeNull();
    expect(parseLmsStatus('Server: ON\nServer: OFF')).toBeNull();
  });
});

describe('parseLmsLs', () => {
  it('extracts ids/paths from an array payload', () => {
    const stdout = JSON.stringify([
      { id: 'mistral-7b.Q4_K_M.gguf' },
      { path: 'C:\\models\\codestral-22b.gguf' },
      { name: 'skipped' },
    ]);
    expect(parseLmsLs(stdout)).toEqual(['mistral-7b.Q4_K_M.gguf', 'C:\\models\\codestral-22b.gguf']);
  });

  it('extracts ids from a {data:[…]} wrapper', () => {
    expect(parseLmsLs(JSON.stringify({ data: [{ id: 'a' }, { id: 'b' }] }))).toEqual(['a', 'b']);
  });

  it('returns [] for garbage or empty payloads', () => {
    expect(parseLmsLs('garbage')).toEqual([]);
    expect(parseLmsLs('{}')).toEqual([]);
    expect(parseLmsLs('[]')).toEqual([]);
  });
});

describe('createCliAdapter', () => {
  it('surfaces the server state from the human lms status output', async () => {
    const env = makeFakeEnv({
      runLmsHandler: (args) => ({
        exitCode: 0,
        stdout: args.join(' ') === 'status' ? 'Server:  ON' : '[]',
        stderr: '',
        timedOut: false,
      }),
    });
    const adapter = createCliAdapter(env);
    await expect(adapter.status()).resolves.toEqual({ serverRunning: true, version: null });
  });

  it('lists model identities from lms ls --json', async () => {
    const env = makeFakeEnv({
      runLmsHandler: (args) => ({
        exitCode: 0,
        stdout:
          args.join(' ') === 'ls --json'
            ? JSON.stringify([{ id: 'mistral-7b-instruct.Q4_K_M.gguf' }, { id: 'codestral-22b.Q8_0.gguf' }])
            : '[]',
        stderr: '',
        timedOut: false,
      }),
    });
    const adapter = createCliAdapter(env);
    const models = await adapter.listModels();
    expect(models[0]).toMatchObject({ family: 'mistral', quantization: 'Q4_K_M', parametersB: 7 });
    expect(models[1]).toMatchObject({ family: 'codestral', parametersB: 22 });
  });

  it('classifies binary absence as a process error', async () => {
    const env = makeFakeEnv({
      runLmsHandler: () => ({ exitCode: 127, stdout: '', stderr: 'spawn failed: ENOENT', timedOut: false }),
    });
    const adapter = createCliAdapter(env);
    await expect(adapter.status()).rejects.toMatchObject({ kind: 'process' });
    await expect(adapter.listModels()).rejects.toMatchObject({ kind: 'process' });
  });
});

describe('loadArgs', () => {
  it('maps a numeric offload tier and context to lms load flags', () => {
    expect(loadArgs(makeLmsProfile('qwen/qwen3.8-27b', { contextLength: 8192, gpuOffload: 0.75 }))).toEqual([
      'load',
      'qwen/qwen3.8-27b',
      '--context-length',
      '8192',
      '--gpu',
      '0.75',
    ]);
  });

  it('maps max/off to the CLI fraction and omits the flag for auto', () => {
    expect(loadArgs(makeLmsProfile('qwen/qwen3.6-35b-a3b', { gpuOffload: 'max' }))).toEqual([
      'load',
      'qwen/qwen3.6-35b-a3b',
      '--gpu',
      '1',
    ]);
    expect(loadArgs(makeLmsProfile('qwen/qwen3.6-35b-a3b', { gpuOffload: 'off' }))).toEqual([
      'load',
      'qwen/qwen3.6-35b-a3b',
      '--gpu',
      '0',
    ]);
    expect(loadArgs(makeLmsProfile('qwen/qwen3.6-35b-a3b', { gpuOffload: 'auto' }))).toEqual([
      'load',
      'qwen/qwen3.6-35b-a3b',
    ]);
  });
});

function makeLmsProfile(modelKey: string, runtime: Record<string, unknown>): Parameters<typeof loadArgs>[0] {
  return {
    schemaVersion: 2,
    id: `profile-${modelKey.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`,
    displayName: { 'zh-CN': '测试', en: 'test' },
    model: { modelKey },
    task: { type: 'chat' },
    runtime,
    generation: {},
    behavior: { mode: 'exclusive' },
    metadata: { createdAt: NOW, updatedAt: NOW },
  };
}