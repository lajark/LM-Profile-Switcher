/**
 * Resource-fit classification (M5-001, PRD FR-07 / CONTEXT.md): the five
 * backward-compatible classes a candidate can receive. The classification seam
 * itself lives in `@lmps/optimizer` (pure data-driven rules); this module only
 * pins the machine vocabulary so schemas, adapters and the CLI agree on it.
 *
 * - gpu-resident: fits VRAM after the GPU reserve — model primarily on GPU.
 * - hybrid-memory: partial GPU offload with host-memory spill, fits total budget.
 * - host-memory: zero/near-zero GPU offload, fits host memory.
 * - resource-unknown: hardware/estimate/capability evidence is missing.
 * - resource-insufficient: even the lowest offload cannot fit GPU + host.
 */
import { z } from 'zod';

export const RESOURCE_FITS = [
  'gpu-resident',
  'hybrid-memory',
  'host-memory',
  'resource-unknown',
  'resource-insufficient',
] as const;

export const ResourceFitSchema = z.enum(RESOURCE_FITS);

export type ResourceFit = z.infer<typeof ResourceFitSchema>;
