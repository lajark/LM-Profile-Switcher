// Real runner tests (cross-platform): the execFile runner must report success,
// non-zero exit, timeout and maxBuffer truncation without ever using a shell.
import { createExecFileRunner } from '@lmps/hardware';
import { describe, expect, it } from 'vitest';

const run = createExecFileRunner({ timeoutMs: 5000, maxBuffer: 4096 });

const HELPERS = {
  ok: ['-e', 'process.stdout.write("hello")'],
  fail: ['-e', 'process.exit(3)'],
  hang: ['-e', 'setTimeout(() => {}, 60000)'],
  flood: ['-e', 'process.stdout.write("x".repeat(1 << 20))'],
};

describe('createExecFileRunner', () => {
  it('reports ok:true with captured stdout', async () => {
    const result = await run(process.execPath, HELPERS.ok);
    expect(result?.ok).toBe(true);
    expect(result?.stdout).toBe('hello');
  });

  it('reports ok:false on non-zero exit but never throws', async () => {
    const result = await run(process.execPath, HELPERS.fail, { timeoutMs: 2000 });
    expect(result?.ok).toBe(false);
  });

  it('flags a timeout instead of hanging', async () => {
    const result = await run(process.execPath, HELPERS.hang, { timeoutMs: 250 });
    expect(result?.ok).toBe(false);
    expect(result?.timedOut).toBe(true);
  });

  it('handles maxBuffer overflow as a controlled failure', async () => {
    const result = await run(process.execPath, HELPERS.flood, { maxBuffer: 1024 });
    expect(result?.ok).toBe(false);
    expect(result).not.toBeNull();
  });

  it('returns null when the command cannot be spawned', async () => {
    const result = await run('definitely-not-a-real-command-xyz', []);
    expect(result).toBeNull();
  });
});