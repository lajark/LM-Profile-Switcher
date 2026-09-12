import { describe, expect, it } from 'vitest';
import { ResourceUsageEvidenceSchema, StrictResourceUsageEvidenceSchema } from '@lmps/domain';

describe('ResourceUsageEvidenceSchema', () => {
  it('accepts the versioned synchronized delta shape', () => {
    const evidence = {
      schemaVersion: 1,
      method: 'host-snapshot-delta',
      sampleCount: 2,
      completeness: 'complete',
      peakDelta: { vramBytes: 1, systemRamBytes: 2, totalBytes: 3 },
    };
    expect(StrictResourceUsageEvidenceSchema.safeParse(evidence).success).toBe(true);
    expect(ResourceUsageEvidenceSchema.safeParse(evidence).success).toBe(true);
  });

  it('keeps resource usage optional for legacy benchmark/profile records', () => {
    expect(ResourceUsageEvidenceSchema.safeParse(undefined).success).toBe(false);
  });
});
