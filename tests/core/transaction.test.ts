// policy-scan:fixture — sk-live-secret redaction fixture (asserts not.toContain + '[redacted]' tombstone); exemption in scripts/lib/policy-scan-exemptions.json
import { describe, expect, it } from 'vitest';
import type { ActivationTransaction } from '@lmps/domain';
import {
  assertValidTransaction,
  beginTransaction,
  closeStage,
  finishTransaction,
  openStage,
  recordError,
  redactEffectiveConfig,
  redactTransaction,
  resolvePolicy,
  stageNames,
} from '@lmps/core';

import { ALPHA, NOW } from './fixtures';

function defaultTx(): ActivationTransaction {
  return beginTransaction({
    id: 'tx-1',
    targetProfileId: 'alpha',
    previousProfileId: null,
    policy: { mode: 'exclusive', rollback: 'best-effort' },
    now: NOW,
  });
}

describe('transaction construction', () => {
  it('begins conforming to the strict domain schema', () => {
    const tx = defaultTx();
    assertValidTransaction(tx);
    expect(tx.status).toBe('idle');
    expect(tx.stages).toEqual([{ name: 'idle', startedAt: NOW, outcome: 'completed' }]);
    expect(tx.errors).toEqual([]);
    expect(tx.finishedAt).toBeNull();
  });

  it('aggregates stage names', () => {
    const tx = defaultTx();
    openStage(tx, 'estimating', NOW);
    expect(stageNames(tx)).toEqual(['idle', 'estimating']);
  });

  it('closes the most recent open stage', () => {
    const tx = defaultTx();
    openStage(tx, 'estimating', NOW);
    closeStage(tx, 'estimating', 'completed', NOW);
    expect(tx.stages[1]).toEqual({ name: 'estimating', startedAt: NOW, endedAt: NOW, outcome: 'completed' });
  });

  it('records a missing stage defensively', () => {
    const tx = defaultTx();
    closeStage(tx, 'restoring-previous-profile', 'failed', NOW);
    expect(tx.stages.at(-1)).toEqual({
      name: 'restoring-previous-profile',
      startedAt: NOW,
      endedAt: NOW,
      outcome: 'failed',
    });
  });

  it('finishes a transaction with status and finishedAt', () => {
    const tx = defaultTx();
    finishTransaction(tx, 'active', NOW);
    expect(tx.status).toBe('active');
    expect(tx.finishedAt).toBe(NOW);
    assertValidTransaction(tx);
  });
});

describe('policy resolution', () => {
  it('defaults rollback to best-effort', () => {
    const profile = structuredClone(ALPHA);
    delete profile.behavior.rollback;
    expect(resolvePolicy(profile)).toEqual({ mode: 'exclusive', rollback: 'best-effort' });
  });

  it('passes an explicit rollback through', () => {
    const profile = { ...ALPHA, behavior: { mode: 'coexist', rollback: 'always' } };
    expect(resolvePolicy(profile)).toEqual({ mode: 'coexist', rollback: 'always' });
  });
});

describe('redaction', () => {
  it('redacts secret keys and private paths from an effective config', () => {
    const input = {
      runtime: { contextLength: 8192 },
      credentials: { apiKey: 'sk-live-secret' },
      filePath: 'C:\\Users\\alice\\.lmps\\models\\weird.bin',
      role: 'admin',
    };
    const redacted = redactEffectiveConfig(input);
    expect(redacted).toEqual({
      runtime: { contextLength: 8192 },
      credentials: { apiKey: '[redacted]' },
      filePath: '<private>',
      role: 'admin',
    });
    expect(JSON.stringify(redacted)).not.toContain('sk-live-secret');
    expect(JSON.stringify(redacted)).not.toContain('alice');
  });

  it('redacts error details at insertion time and in later copies', () => {
    // recordError runs redactDetail on the way in, so no private path can ever
    // reach the transaction; redactTransaction re-copies for the log sink.
    const tx = defaultTx();
    recordError(tx, 'ACTIVATION_STEP_FAILED', NOW, 'failed loading C:\\Users\\alice\\secret.bin');
    expect(tx.errors[0]?.detail).toBe('failed loading <private>');
    expect(JSON.stringify(tx)).not.toContain('alice');

    const copy = redactTransaction(tx);
    expect(copy.errors[0]?.detail).toBe('failed loading <private>');
  });

  it('skips empty detail fields', () => {
    const tx = defaultTx();
    recordError(tx, 'ACTIVATION_TIMEOUT', NOW, null);
    expect(tx.errors).toEqual([{ code: 'ACTIVATION_TIMEOUT', at: NOW }]);
  });
});