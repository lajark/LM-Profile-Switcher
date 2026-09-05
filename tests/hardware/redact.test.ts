// Redaction tests: diagnostics must never leak host, user, home, env values or
// serial-number-like strings. Synthetic values only.
import { hasRedactionPlaceholders, redactDiagnostics, type RedactContext } from '@lmps/hardware';
import { describe, expect, it } from 'vitest';

const ctx: RedactContext = {
  homeDir: 'C:\\Users\\lajar',
  hostname: 'LAPTOP-DEMO01',
  username: 'lajar',
  env: {
    LMPS_TOKEN: 'supersecrettokenvalue',
    SHORT: 'ab',
  },
};

describe('redactDiagnostics', () => {
  it('replaces the home directory with a placeholder', () => {
    expect(redactDiagnostics('config at C:\\Users\\lajar\\.lmps', ctx)).toBe('config at <home>\\.lmps');
  });

  it('replaces the hostname with a placeholder', () => {
    expect(redactDiagnostics('server LAPTOP-DEMO01 reported', ctx)).toBe('server <host> reported');
  });

  it('collapses a full home-dir prefix even when more path follows', () => {
    expect(redactDiagnostics('C:\\Users\\lajar\\AppData\\Roaming\\app', ctx)).toBe(
      '<home>\\AppData\\Roaming\\app',
    );
  });

  it('redacts any other user-profile segment, not only the current user', () => {
    expect(redactDiagnostics('D:\\Users\\bob\\docs\\file', ctx)).toBe(
      'D:\\Users\\<user>\\docs\\file',
    );
  });

  it('replaces long env values with a keyed placeholder', () => {
    expect(redactDiagnostics('token=supersecrettokenvalue here', ctx)).toBe('token=<env:LMPS_TOKEN> here');
  });

  it('does not replace very short values (avoid over-redaction)', () => {
    expect(redactDiagnostics('short ab value', ctx)).toBe('short ab value');
  });

  it('redacts serial-number-like fragments', () => {
    expect(redactDiagnostics('SerialNumber: 12345-ABCDE-67890', ctx)).toContain('<serial>');
  });

  it('leaves unrelated content untouched (incl. CJK)', () => {
    expect(redactDiagnostics('模型加载完成 42ms', ctx)).toBe('模型加载完成 42ms');
  });

  it('is idempotent', () => {
    const once = redactDiagnostics('C:\\Users\\lajar token=supersecrettokenvalue LAPTOP-DEMO01', ctx);
    expect(redactDiagnostics(once, ctx)).toBe(once);
  });

  it('exposes no placeholder when nothing matched', () => {
    expect(hasRedactionPlaceholders('hello')).toBe(false);
  });

  it('detects placeholders once redaction has run', () => {
    expect(hasRedactionPlaceholders(redactDiagnostics('host LAPTOP-DEMO01', ctx))).toBe(true);
  });
});