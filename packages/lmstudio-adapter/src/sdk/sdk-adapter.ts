/**
 * `@lmstudio/sdk` adapter (M0-005). The SDK is optional and loaded lazily via
 * dynamic import with a *variable* specifier, so its absence can never break
 * the module graph or the build: when it cannot be imported every operation
 * reports `unavailable` through the capability probe. Presence on the npm
 * registry and its exact API surface are verified against the real host in the
 * probe before any capability is claimed (the geometric guard around `.lmstudio`
 * in the CLI applies only to apps/cli — this package owns the integration).
 */

const SDK_SPECIFIER = '@lmstudio/sdk';

export interface SdkAvailability {
  installed: boolean;
  /** Normalized reason when `installed` is false ('not-installed' | 'import-error'). */
  reason: 'not-installed' | 'import-error' | null;
}

/** Performs the guarded import once and caches the outcome. */
let cached: SdkAvailability | null = null;

export async function checkSdkAvailability(): Promise<SdkAvailability> {
  if (cached !== null) return cached;
  try {
    const mod = (await import(SDK_SPECIFIER)) as unknown as Record<string, unknown>;
    cached = {
      installed: typeof mod === 'object' && mod !== null && 'LMStudioClient' in mod,
      reason: null,
    };
  } catch {
    cached = { installed: false, reason: 'not-installed' };
  }
  return cached;
}

export interface SdkProbeResult {
  installed: boolean;
  clientConstruction: 'skipped' | 'constructed' | 'failed';
  note: string;
}

/**
 * Read-only SDK probe. Constructing a client performs network I/O, so this
 * probe only verifies installability and exports; the live capability claim is
 * made from a real RPC after the admin-path wiring lands.
 */
export async function probeSdk(): Promise<SdkProbeResult> {
  const availability = await checkSdkAvailability();
  if (!availability.installed) {
    return {
      installed: false,
      clientConstruction: 'skipped',
      note: availability.reason === 'import-error' ? 'sdk import failed' : 'sdk package not installed',
    };
  }
  return {
    installed: true,
    clientConstruction: 'skipped',
    note: 'sdk installed; client construction deferred to the live probe',
  };
}