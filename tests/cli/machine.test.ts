import { describe, expect, it } from 'vitest';
import { ActivationError } from '@lmps/core';
import { DomainError } from '@lmps/domain';
import { ProfileStoreError } from '@lmps/profile-store';

import { CliError } from '../../apps/cli/src/errors.ts';
import {
  errorEnvelope,
  machineErrorFor,
  renderEnvelope,
  successEnvelope,
} from '../../apps/cli/src/machine.ts';

describe('machine envelope (CLI_SPEC §envelope)', () => {
  it('builds a stable success envelope', () => {
    expect(successEnvelope('zh-CN', 'lang', { locale: 'zh-CN' })).toEqual({
      product: 'lmps',
      api: 1,
      ok: true,
      locale: 'zh-CN',
      command: 'lang',
      data: { locale: 'zh-CN' },
    });
  });

  it('renders a deterministic JSON document', () => {
    const text = renderEnvelope(successEnvelope('en', 'profile list', { count: 1 }));
    expect(text).toBe(JSON.stringify({ ...successEnvelope('en', 'profile list', { count: 1 }) }, null, 2));
    expect(JSON.parse(text)).toEqual({
      product: 'lmps',
      api: 1,
      ok: true,
      locale: 'en',
      command: 'profile list',
      data: { count: 1 },
    });
  });

  it('maps a CliError to a machine error code', () => {
    const error = new CliError('CAPABILITY_UNSUPPORTED', 'not wired', { params: { field: 'models' } });
    expect(machineErrorFor(error)).toEqual({ code: 'CAPABILITY_UNSUPPORTED', detail: undefined });
  });

  it('passes stable store codes through the machine error', () => {
    const error = new ProfileStoreError('STORE_IMPORT_FAILED', 'import failed', {
      detail: 'document failed validation',
    });
    expect(machineErrorFor(error)).toEqual({ code: 'STORE_IMPORT_FAILED', detail: 'document failed validation' });
  });

  it('passes activation codes through the machine error', () => {
    expect(machineErrorFor(new ActivationError('ACTIVATION_LOCK_BUSY', 'busy'))).toEqual({
      code: 'ACTIVATION_LOCK_BUSY',
      detail: undefined,
    });
  });

  it('passes domain codes through', () => {
    expect(machineErrorFor(new DomainError('DOMAIN_VALIDATION_FAILED', 'invalid'))).toEqual({
      code: 'DOMAIN_VALIDATION_FAILED',
      detail: undefined,
    });
  });

  it('never leaks unknown error text in the machine code', () => {
    expect(machineErrorFor(new Error('C:\\Users\\alice\\secret'))).toEqual({
      code: 'INTERNAL',
      detail: undefined,
    });
  });

  it('wraps machine errors in an envelope with command context', () => {
    const envelope = errorEnvelope('en', 'models', 'CAPABILITY_UNSUPPORTED', 'models');
    expect(envelope).toEqual({
      product: 'lmps',
      api: 1,
      ok: false,
      locale: 'en',
      command: 'models',
      error: { code: 'CAPABILITY_UNSUPPORTED', detail: 'models' },
    });
  });
});