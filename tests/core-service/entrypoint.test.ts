// M6-003: startup settings resolution for the sidecar entrypoint. The pure
// resolveSidecarSettings module parses every argv/env the wiring needs, so
// startup configuration is testable without spawning a process. These tests
// pin the exact precedence and fallback rules the production entry relies on.
import { describe, expect, it } from 'vitest';

import { resolveSidecarSettings, SIDECAR_TRANSPORT_KINDS, type SidecarEnv } from '../../apps/core-service/src/settings.ts';

function env(overrides: Partial<SidecarEnv> = {}): SidecarEnv {
  return overrides;
}

describe('resolveSidecarSettings (M6-003 entrypoint)', () => {
  it('defaults the transport to stdio', () => {
    const settings = resolveSidecarSettings([], env());
    expect(settings.kind).toBe('stdio');
  });

  it('picks the transport from argv[2] ahead of the env variable', () => {
    const settings = resolveSidecarSettings(['node', 'index.js', 'http'], env({ LMPS_SIDECAR_TRANSPORT: 'pipe' }));
    expect(settings.kind).toBe('http');
  });

  it('falls back to the env variable and then to stdio for invalid values', () => {
    expect(resolveSidecarSettings([], env({ LMPS_SIDECAR_TRANSPORT: 'pipe' })).kind).toBe('pipe');
    expect(resolveSidecarSettings([], env({ LMPS_SIDECAR_TRANSPORT: 'bogus' })).kind).toBe('stdio');
  });

  it('exposes the documented transport kinds', () => {
    expect(SIDECAR_TRANSPORT_KINDS).toEqual(['stdio', 'pipe', 'http']);
  });

  it('resolves the data root with LMPS_HOME ahead of the home fallbacks', () => {
    expect(resolveSidecarSettings([], env({ LMPS_HOME: 'D:/scratch' })).rootDir).toBe('D:/scratch');
    expect(resolveSidecarSettings([], env({ USERPROFILE: 'C:/Users/u', HOME: '/home/u' })).rootDir).toBe('C:/Users/u/.lmps');
    expect(resolveSidecarSettings([], env({ HOME: '/home/u' })).rootDir).toBe('/home/u/.lmps');
    expect(resolveSidecarSettings([], env({})).rootDir).toBe('.lmps');
  });

  it('gives the explicit token precedence over the env token', () => {
    const settings = resolveSidecarSettings(['node', 'index.js', 'stdio', 'argv-token'], env({ LMPS_SIDECAR_TOKEN: 'env-token' }));
    expect(settings.token).toBe('argv-token');
  });

  it('keeps the env token when argv does not provide one', () => {
    expect(resolveSidecarSettings([], env({ LMPS_SIDECAR_TOKEN: 'env-token' })).token).toBe('env-token');
    expect(resolveSidecarSettings([], env({})).token).toBeUndefined();
  });

  it('parses the pipe name from argv[4] ahead of the env variable', () => {
    const settings = resolveSidecarSettings(['node', 'index.js', 'pipe', 'tok', '\\\\.\\pipe\\a'], env({ LMPS_SIDECAR_PIPE: '\\\\.\\pipe\\b' }));
    expect(settings.pipeName).toBe('\\\\.\\pipe\\a');
    expect(resolveSidecarSettings([], env({ LMPS_SIDECAR_PIPE: '\\\\.\\pipe\\b' })).pipeName).toBe('\\\\.\\pipe\\b');
  });

  it('parses a valid LMPS_HOOK_PORT for the http transport only', () => {
    expect(resolveSidecarSettings(['n', 'i', 'http'], env({ LMPS_HOOK_PORT: '4321' })).port).toBe(4321);
    // stdio ignores a malformed port (mirrors pre-M6-003 behavior).
    expect(resolveSidecarSettings([], env({ LMPS_HOOK_PORT: 'not-a-port' })).port).toBeUndefined();
  });

  it('treats a malformed LMPS_HOOK_PORT on http as a startup error', () => {
    expect(() => resolveSidecarSettings(['n', 'i', 'http'], env({ LMPS_HOOK_PORT: '999999' }))).toThrow(/invalid LMPS_HOOK_PORT/);
    expect(() => resolveSidecarSettings(['n', 'i', 'http'], env({ LMPS_HOOK_PORT: '0' }))).toThrow(/invalid LMPS_HOOK_PORT/);
  });

  it('resolves the lms executable with LMPS_LMS_BIN ahead of the legacy LMPS_LM_BIN', () => {
    const settings = resolveSidecarSettings([], env({ LMPS_LMS_BIN: 'C:/lms/new', LMPS_LM_BIN: 'C:/lms/old' }));
    expect(settings.lmsBin).toBe('C:/lms/new');
    expect(resolveSidecarSettings([], env({ LMPS_LM_BIN: 'C:/lms/old' })).lmsBin).toBe('C:/lms/old');
    expect(resolveSidecarSettings([], env({})).lmsBin).toBeUndefined();
  });

  it('passes the raw LM Studio URL and token (token null when unset)', () => {
    const settings = resolveSidecarSettings([], env({ LMPS_LM_URL: 'http://127.0.0.1:1234', LMPS_LM_TOKEN: 'sekrit' }));
    expect(settings.lmBaseUrl).toBe('http://127.0.0.1:1234');
    expect(settings.lmToken).toBe('sekrit');
    expect(resolveSidecarSettings([], env({})).lmToken).toBeNull();
  });

  it('parses Mock-only failure controls without exposing tokens', () => {
    const settings = resolveSidecarSettings([], env({
      LMPS_ADAPTER: 'mock',
      LMPS_E2E_MOCK_HEALTHCHECK_FAIL_MODEL: 'vendor/fail',
      LMPS_E2E_MOCK_BENCHMARK_FAIL_MODEL: 'vendor/fail',
      LMPS_E2E_MOCK_BENCHMARK_GAP_MS: '25',
    }));
    expect(settings.mockHealthCheckFailModel).toBe('vendor/fail');
    expect(settings.mockBenchmarkFailModel).toBe('vendor/fail');
    expect(settings.mockBenchmarkGapMs).toBe(25);
  });

  it('rejects an invalid Mock benchmark gap', () => {
    expect(() => resolveSidecarSettings([], env({ LMPS_ADAPTER: 'mock', LMPS_E2E_MOCK_BENCHMARK_GAP_MS: '-1' }))).toThrow(
      /invalid LMPS_E2E_MOCK_BENCHMARK_GAP_MS/,
    );
  });
  it('ignores Mock-only controls in automatic adapter mode', () => {
    const settings = resolveSidecarSettings([], env({
      LMPS_E2E_MOCK_HEALTHCHECK_FAIL_MODEL: 'vendor/fail',
      LMPS_E2E_MOCK_BENCHMARK_FAIL_MODEL: 'vendor/fail',
      LMPS_E2E_MOCK_BENCHMARK_GAP_MS: 'not-read',
    }));
    expect(settings.selection).toBe('auto');
    expect(settings.mockHealthCheckFailModel).toBeUndefined();
    expect(settings.mockBenchmarkFailModel).toBeUndefined();
    expect(settings.mockBenchmarkGapMs).toBeUndefined();
  });
  it('selects mock only for the exact LMPS_ADAPTER=mock switch', () => {
    expect(resolveSidecarSettings([], env({ LMPS_ADAPTER: 'mock' })).selection).toBe('mock');
    expect(resolveSidecarSettings([], env({ LMPS_ADAPTER: 'MOCK' })).selection).toBe('auto');
    expect(resolveSidecarSettings([], env({})).selection).toBe('auto');
  });
});
