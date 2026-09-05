/**
 * The single producer of machine-readable output. Field names and envelope shape
 * are part of the stable CLI contract (CLI_SPEC): never localize anything here.
 * Error codes pass through the underlying stable code (STORE_*, DOMAIN_*,
 * LOCALE_*, USAGE, CAPABILITY_UNSUPPORTED, INTERNAL); unknown errors are
 * collapsed to INTERNAL without leaking their message or path details.
 */
import { isActivationError } from '@lmps/core';
import { isDomainError } from '@lmps/domain';
import { LocaleResourceError } from '@lmps/i18n';
import { isProfileStoreError } from '@lmps/profile-store';

import { isCliError } from './errors.js';

export interface MachineEnvelope {
  product: 'lmps';
  api: 1;
  ok: boolean;
  locale: string;
  command: string | null;
  data?: unknown;
  error?: { code: string; detail?: string };
}

export function successEnvelope(locale: string, command: string | null, data?: unknown): MachineEnvelope {
  const envelope: MachineEnvelope = { product: 'lmps', api: 1, ok: true, locale, command };
  if (data !== undefined) envelope.data = data;
  return envelope;
}

export function errorEnvelope(
  locale: string,
  command: string | null,
  code: string,
  detail?: string,
): MachineEnvelope {
  const envelope: MachineEnvelope = { product: 'lmps', api: 1, ok: false, locale, command };
  envelope.error = detail === undefined ? { code } : { code, detail };
  return envelope;
}

export function machineErrorFor(error: unknown): { code: string; detail?: string } {
  if (isCliError(error)) {
    return { code: error.code, detail: error.detail };
  }
  if (isActivationError(error)) {
    return { code: error.code, detail: error.detail };
  }
  if (isProfileStoreError(error)) {
    return { code: error.code, detail: error.detail ?? error.message };
  }
  if (isDomainError(error)) {
    return { code: error.code, detail: error.detail };
  }
  if (error instanceof LocaleResourceError) {
    return { code: error.code, detail: error.message };
  }
  // Unknown internals never surface their raw message (it may carry paths).
  return { code: 'INTERNAL' };
}

export function renderEnvelope(envelope: MachineEnvelope): string {
  return JSON.stringify(envelope, null, 2);
}