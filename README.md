# LM Profile Switcher

[![CI](https://github.com/lajark/LM-Profile-Switcher/actions/workflows/ci.yml/badge.svg)](https://github.com/lajark/LM-Profile-Switcher/actions/workflows/ci.yml)

[简体中文](README.zh-CN.md) · [Contributing](CONTRIBUTING.md) · [Distribution channels](docs/DISTRIBUTION_CHANNELS.md)

Independent, local-first companion for [LM Studio](https://lmstudio.ai): hardware-aware model profiles, task-based configuration recommendations, bounded benchmarking, and safe one-click switching. It is an **independent, unofficial community project** — not affiliated with or endorsed by LM Studio.

## Features

- **Schema-validated profiles** — versioned `HardwareProfile` / `ModelProfile` / `TaskProfile` / `RuntimeProfile` / `GenerationProfile` / `BehaviorProfile` contracts, persisted as plain JSON/YAML under `LMPS_HOME` (default `~/.lmps`) with atomic writes and write-ahead backups.
- **Hardware-aware recommendations** — local hardware probe (GPU via `nvidia-smi`, generic fallback), deterministic candidate optimizer with a VRAM safety margin, ranked per task kind with bilingual rationale.
- **Benchmark Lite** — bounded, cancellable, fingerprint-bound objective benchmarks (load time, TTFT, prefill, decode tokens/s, peak VRAM) that cleanly restore the previous model afterwards.
- **Measured-feedback loop** — every `benchmark` run records the exact configuration it tested (model, quantization, task type, and six tunable parameters plus the hardware fingerprint) into `logs/benchmarks.ndjson`. On the next `optimize`, candidates whose exact configuration was measured on this host are matched value-for-value against that history and promoted above unmeasured candidates; within the measured group they rank by real decode throughput (70%) blended with inverse TTFT (30%). The static score stays as the cold-start prior, so a real number on this machine always outranks any estimate.
- **Safe activation transaction** — an orchestrated state machine with health check and automatic rollback; one shared `activation.lock` serializes the CLI, tray, Benchmark, hook, and proxy activation paths.
- **Desktop app (Tauri 2)** — a React/Web GUI hosted by a thin Rust shell: profile editor, optimization wizard, benchmark view, hardware panel, and a system tray that drives the same activation transaction as the CLI.
- **Local automation (loopback only)** —
  - `lmps hook`: app/task-driven model switching with persistent token auth and deny-by-default rules;
  - `lmps proxy`: an OpenAI-compatible HTTP surface (`GET /v1/models`, `POST /v1/chat/completions`) mapping virtual model names to profiles via a deny-by-default alias document, with per-session locking and explicit opt-in activation. Both bind to `127.0.0.1` only.
- **i18n** — `zh-CN` and `en` for every user-visible string; `--json` output uses a stable, never-localized machine envelope.
- **Governed distribution** — structural policy scan and secret scan (`policy:scan`) gate every commit, release staging, and the CI pipeline (strict mode).

## Requirements

- Node.js >= 20 and pnpm 10.15.0 (Corepack supported).
- Windows or macOS for the desktop build; the CLI runs anywhere Node.js runs.

## Release status

**0.2.0-beta.1 pre-release published on 2026-09-12**: [GitHub Releases](https://github.com/lajark/LM-Profile-Switcher/releases/tag/v0.2.0-beta.1) hosts a Windows x86_64 NSIS installer (per-user, unsigned) together with `checksums.sha256`, `release-manifest.json`, SBOM, dependency license report, third-party notices, release notes and the MIT license — produced by the automated release workflow (M5-007) from this commit. The release is tagged `v0.2.0-beta.1` on GitHub; Gitee mirrors the source but hosts no downloadable artifact (no Gitee Releases page configured). macOS distribution remains blocked (no build hardware / Apple credentials).

## Getting started

```text
corepack pnpm install
corepack pnpm run build
corepack pnpm run lmps -- --help
corepack pnpm run lmps -- --json profile list
```

`corepack pnpm run check` runs lint, typecheck, the i18n gate, the TypeScript build, domain-schema generation + freshness, unit tests, and the compliance bundle. It needs no LM Studio connection or model download.

## Real-machine benchmarks

Measured on **2026-09-10** (9B, first table) and **2026-09-12** (9B re-run + 27B/35B) in real sessions on this host: RTX 5060 Ti 16 GB (driver 596.36), Intel Core Ultra 5 225H (14C/14T), 31.4 GiB RAM, Windows 11. LM Studio server at `127.0.0.1:1234`; the 9B runs at `8k context / max GPU offload`, while the 27B/35B runs use the adaptive offload ladder described below (Q4_K_M quantizations). Benchmarks use 3 samples × 64 tokens via `lmps benchmark` by default; the numbers below come from the CLI-measured result JSON.

> **Calibration erratum (M6-001, 2026-09-12):** the 0.2.0-beta.1 benchmark implementation reused the pre-load hardware snapshot after loading and inference, and compared absolute VRAM usage with a GPU+system-memory estimate. The 27B/35B calibration values below are therefore historical diagnostics only, not valid resource evidence. Do not use them to raise confidence or relax safety defaults. After upgrading to 0.2.1-beta.1, run `benchmark --yes` again before relying on calibration or measured recommendations; the corrected contract reports synchronized VRAM/system-RAM deltas.

### Qwen3.5-9B-Q4_K_M (5.2 GB, fully GPU-resident)

Re-measured **2026-09-12** (2 samples × 64 tokens):

| Metric | Baseline (max/8k/0.7) | After `optimize` | Δ |
| --- | ---: | ---: | ---: |
| Load time (ms) | 6295 | 6271 | −0.4% |
| TTFT (ms) | 119 | 120.5 | +1.3% |
| Prefill (tok/s) | 160.1 | 159.1 | −0.6% |
| Decode (tok/s) | 63.6 | 63.5 | −0.1% |
| Peak VRAM (GiB) | 0.253 | 0.253 | 0.0% |

The takeaway for a fully GPU-resident 9B: `lmps` itself adds negligible overhead — decode stays at ~63-65 tok/s, peak VRAM identical to a raw host run, and everything stays local. On this class of model the optimizer's real value is not raw speed (the model already runs at the GPU's ceiling) but configuration governance: it documents the chosen settings, keeps them schema-validated, and makes them reproducible via `apply`. (An earlier 2026-09-10 session saw a −18.3% TTFT from a context 8192→4096 candidate; the effect depends on the candidate chosen and is not a stable promise — shown for context.)

### Qwen3.8-27B-Q4_K_M (15.7 GB, at the VRAM limit) — from "won't load" to runnable + measured calibration

Without `lmps`, this 27B would be rejected or tuned by hand. `lmps optimize` turns it into a **runnable, measurable configuration search**:

- **It no longer rejects over-VRAM models.** The GPU-offload ladder (`0 / 0.25 / 0.50 / 0.75 / off`) generates tiered candidates and classifies resource-fit: `offload-0` → `resource-insufficient`, `offload 0.25/0.50/0.75` → `gpu-resident` and recommendable. The user sees *why* each tier is or isn't a fit instead of a cryptic refusal.
- **Historical calibration warning.** The ≈0.25 GiB versus ≈19.2 GiB comparison and its `ratio≈0.013` audit row were produced under the invalid 0.2.0-beta.1 measurement contract described above. They are retained for traceability only; corrected v2 evidence is required before measured feedback is trusted.
- **Honest speed note:** on this 16 GB host the optimizer's tiers cannot exceed what `max` already does, so a higher offload ratio does **not** raise decode: the explicit tier lands at or slightly below the `max` baseline (≈9.9 → ≈8.0 tok/s). For an over-VRAM model the value is runnability + measurement, not speed.

| 27B metric | `max` (baseline) | offload 0.75 |
| --- | ---: | ---: |
| Decode (tok/s) | ≈9.9 | ≈8.0 |
| TTFT (ms) | ≈1700 | ≈2160 |
| Load time (ms) | ≈36865 (cold) | ≈11000 (warm) |
| Measured peak VRAM (GiB) | ≈0.25 | ≈0.25 |

### Qwen3.6-35B-A3B-Q4_K_M (19.7 GB MoE, beyond VRAM) — from "won't load" to runnable + measured calibration

Same story at 35B: previously a hard rejection, now a tiered configuration search. The ladder produces `offload-0` → `resource-insufficient`, `offload 0.25/0.50` → `gpu-resident`; the ≈0.25 GiB versus ≈21.4 GiB calibration comparison is historical and invalid under the 0.2.0-beta.1 contract. As with the 27B, higher offload does not raise decode (≈27.2 → ≈24.6 tok/s) on this host — runnability, not a calibration or speed promise.

| 35B metric | `max` (baseline) | offload 0.5 |
| --- | ---: | ---: |
| Decode (tok/s) | ≈27.2 | ≈24.6 |
| TTFT (ms) | ≈596 | ≈710 |
| Load time (ms) | ≈45090 (cold) | ≈24000 (warm) |
| Measured peak VRAM (GiB) | ≈0.25 | ≈0.25 |

> The 27B/35B figures above are real-machine measurements from 2026-09-12 on an RTX 5060 Ti 16 GB + external drive (local LM Studio session). The measured peak reflects only the server-reported GPU-resident portion, not total host-memory use.

### Measurement conditions and honest notes

- The 9B first baseline run hit a cold disk cache (peak 271 MB / load 23.5 s); a clean re-run went into the table.
- The 27B/35B figures are real-machine measurements from the 2026-09-12 session; they are indicative of behavior under the stated setup rather than a performance guarantee.
- The 27B/35B `max` baseline is an author-tuned running configuration, not an LM Studio factory default; the optimizer's recommendable offload tiers cannot be more aggressive than `max`, so decode did not improve at higher offload on this host (see each table).
- Fix (2026-09-12): numeric offload tiers previously sent a `gpu_offload` key to REST v1 `/load`, which LM Studio rejects with `400 unrecognized_keys`, crashing benchmark; numeric tiers now load via `lms load --gpu <ratio>` (measure still uses the REST chat endpoint), while `max`/`off`/`auto` keep the REST loader.
- **Measured ranking (2026-09-12)**: when a configuration has been benchmarked on this host, `optimize` no longer sorts it by the static heuristic score — the measured candidate is promoted to the top of the list and ranked by its real decode throughput and TTFT. The static score remains the cold-start prior for unmeasured configurations. This closes the loop: after `benchmark --yes`, the next `optimize` surfaces the genuinely fastest measured configuration rather than the highest statically-scored one. Real-machine verification (2026-09-12, RTX 5060 Ti, qwen3.5-9b): `optimize --yes` saves the head candidate, `benchmark` of that saved profile measures decode 64.1 tok/s and records the exact config snapshot (`gpuOffload=0, context 36864, temperature 0.2`); the next `optimize` matches that candidate value-for-value, marks it `MEASURED` (`adjustedTotal=0.70, confidence=high`), and promotes it to the top of the list.

- Screenshots: [profiles](docs/screenshots/screenshot-profiles.png) · [optimize accepted](docs/screenshots/screenshot-optimize-9b.png) · [hardware](docs/screenshots/screenshot-hardware.png).

## Documentation

- `docs/ARCHITECTURE.md` — modules, processes, and adapter design
- `docs/CLI_SPEC.md` — `lmps` command contract, machine envelope, and exit codes
- `docs/SECURITY.md` — threat model, secrets handling, loopback-only binding
- `docs/OPEN_SOURCE_REUSE_POLICY.md` — provenance and license rules for borrowed code
- `docs/TRACEABILITY_MATRIX.md` — requirement–task–test tracing
- `docs/RELEASE_NOTES-0.1.0.md` — notes for the first packaged release
- `PROJECT_DISTRIBUTION_POLICY.md` — file classification and release boundary
- `AGENTS.md` — project instructions and verified commands

## Repository layout

```text
apps/cli                 lmps CLI (thin entry point)
apps/core-service        local sidecar: stdio/pipe/loopback-HTTP IPC, hook and proxy planes
apps/desktop             Tauri 2 shell + React/Web GUI and system tray
packages/benchmark       bounded objective benchmarking
packages/core            use cases, state machines, business rules
packages/domain          pure domain contracts + generated JSON Schemas
packages/hardware        local hardware probing
packages/i18n            locale resources and type-safe keys
packages/lmstudio-adapter  every LM Studio call (SDK / REST v1 / lms CLI) behind one boundary
packages/optimizer       data-driven, bounded candidate generation
packages/profile-store   atomic storage, backups, migrations, import/export
scripts/                 policy scan, release assembly, install verification
```

## License

MIT — see [LICENSE](LICENSE).

> LM Profile Switcher is an independent, unofficial community tool and is not affiliated with or endorsed by LM Studio.
