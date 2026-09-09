/**
 * EstimatePort for the LM Studio host (M1-006). Tries the official
 * `lms load --estimate-only` path first; any failure to reach the engine or to
 * parse its answer degrades to an explicitly-labeled `rough` estimate
 * (see `rough-estimate.ts`). `internal` errors and unexpected exceptions
 * rethrow — a bug must not be papered over as a rough estimate.
 */
import type { EstimatePort } from '@lmps/core';

import { createCliAdapter } from '../cli/cli-adapter.js';
import type { LmStudioEnv } from '../env.js';
import { isLmStudioError } from '../errors.js';
import { roughEstimateFor } from './rough-estimate.js';

export function createCliEstimatePort(env: LmStudioEnv): EstimatePort {
  const cli = createCliAdapter(env);
  return {
    async estimate(profile) {
      try {
        return await cli.estimate(profile);
      } catch (error) {
        if (isLmStudioError(error) && error.kind === 'internal') throw error;
        if (!isLmStudioError(error)) throw error;
        return roughEstimateFor(profile, env.now());
      }
    },
  };
}

/**
 * Deterministic estimate for the explicit mock path (LMPS_ADAPTER=mock). The
 * official port spawns the host `lms` binary for zero benefit under mock, so
 * this returns the honest rough estimate (provider 'rough', no measured
 * figures) — the same labeled fallback the official port degrades to.
 */
export function createMockEstimatePort(now: () => string = () => new Date().toISOString()): EstimatePort {
  return {
    async estimate(profile) {
      return roughEstimateFor(profile, now());
    },
  };
}