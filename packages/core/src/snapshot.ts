/**
 * Point-in-time capture of the runtime state (M1-005, wires the CLI `snapshot`
 * port shape): active state plus the effective configuration of an optional
 * target profile, redacted before it can be persisted anywhere.
 */
import type { CompositeProfile } from '@lmps/domain';

import type { ActivationRuntime, RunnerContext } from './ports.js';
import { redactEffectiveConfig } from './redact.js';

export interface CapturedSnapshot {
  profileId: string;
  at: string;
  captured: Record<string, unknown>;
}

async function readEffectiveBestEffort(
  runtime: ActivationRuntime,
  profile: CompositeProfile,
): Promise<Record<string, unknown> | null> {
  try {
    return await runtime.readEffectiveConfig(profile);
  } catch {
    return null;
  }
}

export async function captureSnapshot(
  ctx: RunnerContext,
  runtime: ActivationRuntime,
  profile?: CompositeProfile,
): Promise<CapturedSnapshot> {
  const active = await runtime.getActiveState();
  const at = ctx.now();
  const effective = profile === undefined ? null : await readEffectiveBestEffort(runtime, profile);
  // redactEffectiveConfig deep-copies to plain JSON-compatible records; the
  // cast is safe because the snapshot itself is a plain record by construction.
  const captured = redactEffectiveConfig({ active, effective }) as Record<string, unknown>;
  return { profileId: profile?.id ?? active.profileId ?? 'none', at, captured };
}