/**
 * Restricted command runner — the only module that speaks to `child_process`.
 *
 * Every external command is spawned via `execFile` with a static argument
 * array and no shell, always with a timeout and bounded stdout, so a probe can
 * never hang or be tricked into running injected shell syntax.
 */
import { execFile } from 'node:child_process';

import type { ProbeEnv, RunOptions, RunResult } from './probe.js';

export interface ExecFileDefaults {
  timeoutMs?: number;
  maxBuffer?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_BUFFER = 4 * 1024 * 1024;

/**
 * Encodes a PowerShell script as a UTF-16LE base64 `-EncodedCommand`, which is
 * immune to the Windows PowerShell 5.1 OEM code-page decoding of `-Command`.
 */
export function encodeEncodedCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

/**
 * Bootstrap args for a single PowerShell call: UTF-8 console I/O (so CJK
 * adapter/battery strings survive), no profile, no interactive prompt.
 */
export function powerShellArgs(script: string): string[] {
  const header = '[Console]::InputEncoding=[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;';
  return ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodeEncodedCommand(header + script)];
}

export function createExecFileRunner(defaults: ExecFileDefaults = {}): ProbeEnv['run'] {
  return (cmd, args, opts?: RunOptions) =>
    new Promise<RunResult | null>((resolve) => {
      execFile(
        cmd,
        [...args],
        {
          encoding: 'utf8',
          windowsHide: true,
          timeout: opts?.timeoutMs ?? defaults.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          maxBuffer: opts?.maxBuffer ?? defaults.maxBuffer ?? DEFAULT_MAX_BUFFER,
        },
        (error, stdout, stderr) => {
          if (error) {
            if (typeof error.code === 'number') {
              // Non-zero exit: the command ran but reported failure.
              resolve({ ok: false, stdout: toText(stdout), stderr: toText(stderr) });
              return;
            }
            if (error.signal === 'SIGTERM' && error.killed) {
              resolve({ ok: false, stdout: '', stderr: '', timedOut: true });
              return;
            }
            if (error.code === 'ENOENT') {
              // Command not found → nothing to probe.
              resolve(null);
              return;
            }
            // e.g. ERR_CHILD_PROCESS_STDIO_MAXBUFFER — controlled failure.
            resolve({ ok: false, stdout: toText(stdout), stderr: toText(stderr) });
            return;
          }
          resolve({ ok: true, stdout: toText(stdout), stderr: toText(stderr) });
        },
      );
    });
}

function toText(value: string | Buffer): string {
  return typeof value === 'string' ? value : value.toString('utf8');
}