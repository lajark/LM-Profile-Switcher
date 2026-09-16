import { describe, expect, it } from 'vitest';
import { CompositeProfileSchema } from '@lmps/domain';
import { createSafeBaselineProfile } from '@lmps/core';

describe('safe baseline factory', () => {
  it('creates valid ephemeral profile data without validation evidence', () => {
    const profile = createSafeBaselineProfile({
      modelKey: 'vendor/empty-7b-q4_k_m',
      family: 'chat',
      quantization: 'Q4_K_M',
      taskType: 'quick-chat',
      now: '2026-09-15T00:00:00.000Z',
    });

    expect(CompositeProfileSchema.safeParse(profile).success).toBe(true);
    expect(profile.id).toMatch(/^draft-[a-z0-9._-]+$/);
    expect(profile.model).toMatchObject({ modelKey: 'vendor/empty-7b-q4_k_m', family: 'chat', quantization: 'Q4_K_M' });
    expect(profile.task).toEqual({ type: 'quick-chat', kind: 'quick-chat' });
    expect(profile.runtime).toEqual({ gpuOffload: 'auto' });
    expect(profile.validation).toBeUndefined();
  });

  it('maps an unknown task type to the custom kind without changing its type', () => {
    const profile = createSafeBaselineProfile({
      modelKey: 'vendor/model',
      family: null,
      quantization: null,
      taskType: 'my-workflow',
      now: '2026-09-15T00:00:00.000Z',
    });
    expect(profile.task).toEqual({ type: 'my-workflow', kind: 'custom' });
  });
  it('rejects an empty model key or task type before creating a profile', () => {
    expect(() => createSafeBaselineProfile({
      modelKey: ' ',
      family: null,
      quantization: null,
      taskType: 'quick-chat',
      now: '2026-09-15T00:00:00.000Z',
    })).toThrow('modelKey and taskType are required');
    expect(() => createSafeBaselineProfile({
      modelKey: 'vendor/model',
      family: null,
      quantization: null,
      taskType: '',
      now: '2026-09-15T00:00:00.000Z',
    })).toThrow('modelKey and taskType are required');
  });
});