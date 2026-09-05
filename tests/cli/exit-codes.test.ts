import { describe, expect, it } from 'vitest';
import { DomainError } from '@lmps/domain';
import { ProfileStoreError } from '@lmps/profile-store';
import { LocaleResourceError } from '@lmps/i18n';
import { ActivationError } from '@lmps/core';

import { CliError } from '../../apps/cli/src/errors.ts';
import { EXIT, exitCodeForActivation, exitCodeForError } from '../../apps/cli/src/exit-codes.ts';

describe('EXIT code constants (CLI_SPEC)', () => {
  it('exposes the documented exit table', () => {
    expect(EXIT).toEqual({
      SUCCESS: 0,
      USER_CANCELLED: 2,
      ACTIVATION_RECOVERED: 3,
      VALIDATION_OR_PREFLIGHT: 4,
      ACTIVATION_FAILED: 5,
      CAPABILITY_UNSUPPORTED: 6,
      INTERNAL: 10,
    });
  });

  it('does not reuse any value', () => {
    const values = Object.values(EXIT);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('exitCodeForActivation (M1-005)', () => {
  it.each([
    ['active', 'active', EXIT.SUCCESS],
    ['canceled', 'canceled', EXIT.USER_CANCELLED],
    ['failed-but-recovered', 'failed-but-recovered', EXIT.ACTIVATION_RECOVERED],
    ['failed', 'failed', EXIT.ACTIVATION_FAILED],
  ])('maps outcome %s → %i', (_name, status, expected) => {
    expect(exitCodeForActivation(status as 'active')).toBe(expected);
  });
});

describe('exitCodeForError', () => {
  it.each([
    ['CliError USAGE', new CliError('USAGE', 'bad usage'), EXIT.VALIDATION_OR_PREFLIGHT],
    [
      'CliError CAPABILITY_UNSUPPORTED',
      new CliError('CAPABILITY_UNSUPPORTED', 'not wired', { params: { field: 'models' } }),
      EXIT.CAPABILITY_UNSUPPORTED,
    ],
    ['CliError INTERNAL', new CliError('INTERNAL', 'boom'), EXIT.INTERNAL],
    [
      'ACTIVATION_PREFLIGHT',
      new ActivationError('ACTIVATION_PREFLIGHT', 'preflight failed'),
      EXIT.VALIDATION_OR_PREFLIGHT,
    ],
    [
      'ACTIVATION_LOCK_BUSY',
      new ActivationError('ACTIVATION_LOCK_BUSY', 'busy'),
      EXIT.VALIDATION_OR_PREFLIGHT,
    ],
    ['ACTIVATION_CANCELED', new ActivationError('ACTIVATION_CANCELED', 'cancelled'), EXIT.USER_CANCELLED],
    [
      'ACTIVATION_STEP_FAILED (thrown unexpectedly)',
      new ActivationError('ACTIVATION_STEP_FAILED', 'step failed'),
      EXIT.INTERNAL,
    ],
    [
      'STORE_NOT_FOUND',
      new ProfileStoreError('STORE_NOT_FOUND', 'profile does not exist'),
      EXIT.VALIDATION_OR_PREFLIGHT,
    ],
    [
      'STORE_ALREADY_EXISTS',
      new ProfileStoreError('STORE_ALREADY_EXISTS', 'already exists'),
      EXIT.VALIDATION_OR_PREFLIGHT,
    ],
    [
      'STORE_INVALID_ID',
      new ProfileStoreError('STORE_INVALID_ID', 'bad id'),
      EXIT.VALIDATION_OR_PREFLIGHT,
    ],
    [
      'STORE_IMPORT_FAILED',
      new ProfileStoreError('STORE_IMPORT_FAILED', 'import failed'),
      EXIT.VALIDATION_OR_PREFLIGHT,
    ],
    [
      'STORE_LIMIT_EXCEEDED',
      new ProfileStoreError('STORE_LIMIT_EXCEEDED', 'too large'),
      EXIT.VALIDATION_OR_PREFLIGHT,
    ],
    [
      'STORE_CORRUPTED',
      new ProfileStoreError('STORE_CORRUPTED', 'corrupted'),
      EXIT.INTERNAL,
    ],
    [
      'STORE_IO_FAILED',
      new ProfileStoreError('STORE_IO_FAILED', 'io failed'),
      EXIT.INTERNAL,
    ],
    ['DomainError', new DomainError('DOMAIN_VALIDATION_FAILED', 'invalid'), EXIT.VALIDATION_OR_PREFLIGHT],
    [
      'LocaleResourceError',
      new LocaleResourceError('LOCALE_KEY_MISMATCH', 'missing keys'),
      EXIT.INTERNAL,
    ],
    ['unknown Error', new Error('boom'), EXIT.INTERNAL],
    ['non-Error value', 'boom', EXIT.INTERNAL],
  ])('%s → %i', (_name, error, expected) => {
    expect(exitCodeForError(error)).toBe(expected);
  });
});