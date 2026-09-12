# ADR-0004: Synchronized Resource-Usage Evidence for Benchmark Calibration

- Status: Accepted
- Date: 2026-09-12
- Supersedes: none (corrects the M5-003 calibration interpretation)

## Context

The 0.2.0-beta.1 benchmark path reused the pre-load hardware snapshot after
loading and inference. It also compared an absolute per-GPU VRAM-used value with
an estimate that represented GPU plus system RAM. The resulting calibration
could not establish a valid whole-system relationship. Published 27B/35B
calibration rows therefore remain historical records, not usable resource
evidence.

Calibration must be conservative, explainable and compatible with profiles and
audit logs already on disk. A missing or incomplete host measurement must never
be silently reinterpreted as a safe result.

## Decision

- Capture a baseline before loading, a fresh host snapshot after the load
  attempt, and a fresh snapshot after every inference sample. No later stage may
  reuse the baseline as its observation.
- Derive non-negative deltas for aggregate GPU VRAM-used and system-RAM-used
  values. `totalBytes` is emitted only when both deltas were available at the
  same observation; otherwise evidence is `partial` or `unavailable`.
- Persist the versioned `ResourceUsageEvidence` v1 object using the
  `host-snapshot-delta` method. `BenchmarkMetrics.resourceUsage` and
  `ValidationInfo.resourceUsage` are additive optional fields.
- Keep `memoryPeakBytes` as the legacy absolute-VRAM field for compatibility,
  but never use it for Total Memory calibration.
- Interpret calibration with `calibrationVersion: 2`. Only complete v1 evidence
  can be compared with a whole-footprint estimate. An observed value below an
  estimate cannot increase confidence or relax safety defaults; an observed
  overrun may lower confidence and mark degradation.
- Preserve old profiles and audit rows byte-for-byte. A record without complete
  v1 evidence returns `relation: unavailable` and
  `rebenchmarkRequired: true`; it is not auto-migrated or used to endorse a
  recommendation.

## Alternatives

- **Reuse the baseline snapshot** — rejected because it cannot observe load or
  inference deltas and was the source of the 0.2.0-beta.1 defect.
- **Compare absolute VRAM with Total Memory** — rejected as a unit/quantity
  mismatch; VRAM-only hosts produce no valid total-footprint evidence.
- **Migrate historical rows heuristically** — rejected because the missing
  sampling points cannot be reconstructed without inventing data.
- **Treat low observations as improved confidence** — rejected because noisy or
  incomplete probes could weaken the safety boundary.

## Consequences

Positive:

- Calibration compares like-for-like synchronized deltas and exposes evidence
  quality to CLI, desktop and audit consumers.
- Multi-GPU aggregation, missing fields, negative counter noise, cancellation
  and probe failures have deterministic conservative outcomes.
- Existing profile and audit data remains readable and recoverable.

Trade-offs:

- Each benchmark performs additional hardware probes, so runs may be slightly
  slower and can produce partial evidence on hosts without both memory views.
- Users with legacy benchmark records must run Benchmark again before resource
  calibration can be applied.

## Testing hooks

- `packages/benchmark/src/resource-usage.ts` is a pure delta builder covered by
  complete, partial, unavailable, multi-GPU and negative-noise tests.
- `createBenchmarkService` tests assert baseline/post-load/per-sample probe
  ordering, cancellation and probe-failure classification.
- Optimizer tests assert v2 relation/quality fields, conservative confidence and
  legacy/partial `rebenchmarkRequired` behavior.
