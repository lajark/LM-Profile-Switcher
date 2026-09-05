/**
 * HardwareProfile: a snapshot of the host environment a profile was measured
 * against (PRD FR-02). Any single probe may fail without blocking — failed
 * values stay `null`/`unknown` and callers fall back to conservative choices.
 */
import { z } from 'zod';

import { isoDateTime } from './iso-date.js';
import { SCHEMA_VERSION } from './version.js';

export const GpuInfoSchema = z
  .object({
    name: z.string().min(1),
    driverVersion: z.string().nullable().optional(),
    vramTotalBytes: z.number().int().min(0),
    vramAvailableBytes: z.number().int().min(0),
  })
  .passthrough();

export const VolumeInfoSchema = z
  .object({
    mount: z.string().min(1),
    totalBytes: z.number().int().min(0),
    availableBytes: z.number().int().min(0),
  })
  .passthrough();

const HardwareProfileDefinition = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  os: z.string().nullable().optional(),
  cpu: z
    .object({
      model: z.string().nullable().optional(),
      cores: z.number().int().min(1).nullable().optional(),
      threads: z.number().int().min(1).nullable().optional(),
    })
    .nullable()
    .optional(),
  memory: z
    .object({
      totalBytes: z.number().int().min(0).nullable().optional(),
      availableBytes: z.number().int().min(0).nullable().optional(),
    })
    .nullable()
    .optional(),
  gpus: z.array(GpuInfoSchema).nullable().optional(),
  volumes: z.array(VolumeInfoSchema).nullable().optional(),
  power: z
    .object({
      onBattery: z.boolean(),
    })
    .nullable()
    .optional(),
  versions: z
    .object({
      lmStudio: z.string().nullable().optional(),
      daemon: z.string().nullable().optional(),
      server: z.string().nullable().optional(),
      runtime: z.string().nullable().optional(),
      api: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  hardwareFingerprint: z.string().nullable().optional(),
  probedAt: isoDateTime('probedAt'),
});

export const HardwareProfileSchema = HardwareProfileDefinition.passthrough();
export const StrictHardwareProfileSchema = HardwareProfileDefinition.strict();

export type HardwareProfile = z.infer<typeof HardwareProfileSchema>;
export type GpuInfo = z.infer<typeof GpuInfoSchema>;
export type VolumeInfo = z.infer<typeof VolumeInfoSchema>;