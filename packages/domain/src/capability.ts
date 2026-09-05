/**
 * CapabilityMatrix: what an LM Studio adapter can apply precisely today
 * (PRD FR-03). Probed per adapter (SDK / REST / CLI), cached with a TTL and
 * invalidated on version or engine change. Unsupported fields must never be
 * silently dropped or mis-applied — the UI surfaces exact/degraded/unavailable.
 */
import { z } from 'zod';

import { isoDateTime } from './iso-date.js';
import { SCHEMA_VERSION } from './version.js';

export const ADAPTER_SOURCES = ['sdk', 'rest', 'cli'] as const;

export const CapabilityEntrySchema = z
  .object({
    /** Profile field path this capacity refers to, e.g. `runtime.flashAttention`. */
    field: z.string().min(1),
    support: z.enum(['exact', 'degraded', 'unavailable', 'unknown']),
    note: z.string().nullable().optional(),
  })
  .passthrough();

const CapabilityMatrixDefinition = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  adapter: z.enum(ADAPTER_SOURCES),
  apiVersion: z.string().nullable().optional(),
  lmStudioVersion: z.string().nullable().optional(),
  engineVersion: z.string().nullable().optional(),
  probedAt: isoDateTime('probedAt'),
  cacheTtlSeconds: z.number().int().min(1),
  capabilities: z.array(CapabilityEntrySchema),
});

export const CapabilityMatrixSchema = CapabilityMatrixDefinition.passthrough();
export const StrictCapabilityMatrixSchema = CapabilityMatrixDefinition.strict();

export type CapabilityMatrix = z.infer<typeof CapabilityMatrixSchema>;
export type CapabilityEntry = z.infer<typeof CapabilityEntrySchema>;