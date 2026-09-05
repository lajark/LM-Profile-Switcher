import { describe, expect, it } from 'vitest';
import { ACTIVATION_ERROR_CODES, ActivationError, isActivationError } from '@lmps/core';

describe('ActivationError', () => {
  it('exposes a closed set of stable machine codes', () => {
    expect(ACTIVATION_ERROR_CODES).toEqual([
      'ACTIVATION_PREFLIGHT',
      'ACTIVATION_LOCK_BUSY',
      'ACTIVATION_STEP_FAILED',
      'ACTIVATION_TIMEOUT',
      'ACTIVATION_CANCELED',
      'ACTIVATION_ROLLBACK_FAILED',
    ]);
  });

  it('carries code, stage and detail', () => {
    const error = new ActivationError('ACTIVATION_CANCELED', 'cancelled', {
      stage: 'loading',
      detail: 'user pressed ctrl-c',
    });
    expect(error.code).toBe('ACTIVATION_CANCELED');
    expect(error.stage).toBe('loading');
    expect(error.detail).toBe('user pressed ctrl-c');
    expect(isActivationError(error)).toBe(true);
  });

  it('treats plain Errors as non-activation errors', () => {
    expect(isActivationError(new Error('nope'))).toBe(false);
    expect(isActivationError('string')).toBe(false);
    expect(isActivationError(undefined)).toBe(false);
  });

  it('constructs without options', () => {
    const error = new ActivationError('ACTIVATION_LOCK_BUSY', 'busy');
    expect(error.stage).toBeUndefined();
    expect(error.detail).toBeUndefined();
  });
});