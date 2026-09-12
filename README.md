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

As of **2026-09-11**, the source repositories are public, but there is **no public downloadable GitHub or Gitee Release**. A historical local Windows 0.1.0 packaging run exists from an older source commit; it is maintainer evidence, not a current end-user download. No macOS artifact exists yet. Distributable artifacts (Windows x86_64, macOS arm64 / x86_64 candidates, signing, notarization, and a GitHub Draft/Pre-release) will be added once the relevant build environments and Apple credentials are available.

## Getting started

```text
corepack pnpm install
corepack pnpm run build
corepack pnpm run lmps -- --help
corepack pnpm run lmps -- --json profile list
```

`corepack pnpm run check` runs lint, typecheck, the i18n gate, the TypeScript build, domain-schema generation + freshness, unit tests, and the compliance bundle. It needs no LM Studio connection or model download.

## Real-machine benchmarks

Measured on **2026-09-10** (9B) and locally on **2026-09-12** (27B/35B) across two real-machine sessions: RTX 5060 Ti 16 GB (driver 596.36), Intel Core Ultra 5 225H (14C/14T), 31.4 GiB RAM, Windows 11. LM Studio server at `127.0.0.1:1234`; the 9B runs at `8k context / max GPU offload`, while the 27B/35B runs use the adaptive offload ladder described below (Q4_K_M quantizations). Benchmarks use 3 samples × 64 tokens via `lmps benchmark` by default; the numbers below come from the CLI-measured result JSON.

### Qwen3.5-9B-Q4_K_M (5.2 GB, fully GPU-resident)

| Metric | Baseline | After `optimize` | Δ |
| --- | ---: | ---: | ---: |
| Load time (ms) | 6306 | 6315 | +0.1% |
| TTFT (ms) | 169 | **138** | **−18.3%** |
| Prefill (tok/s) | 189 | **219** | **+15.8%** |
| Decode (tok/s) | 65.17 | 64.84 | −0.5% |
| Peak VRAM (GiB) | 6.61 | 6.60 | −0.1% |

The optimizer picked the low-latency candidate: context 8192→4096, temperature (unset)→0.6, offload unchanged (`max`). Result: ~18% faster first token at unchanged decode throughput.

### Qwen3.8-27B-Q4_K_M (15.7 GB, at the VRAM limit) — adaptive offload candidates + measured calibration

Each "baseline" below is the author-tuned running configuration (**`max` offload, 8192 context, temp 0.7**), not an LM Studio factory default. The table compares it against the optimizer's recommendable offload tier, measured in the same session with the same protocol (3 samples × 64 tokens). The measured peak reflects only the server-reported GPU-resident portion, not total host-memory use.

| 27B metric | `max` (baseline) | offload 0.75 |
| --- | ---: | ---: |
| Load time (ms) | ≈36865 (cold) | ≈11000 (warm) |
| TTFT (ms) | ≈1700 | ≈2160 |
| Decode (tok/s) | **≈9.9** | ≈8.0 |
| Measured peak VRAM (GiB) | ≈0.25 | ≈0.25 |

With adaptive-offload support landed, `lmps optimize` **no longer rejects 27B outright**: it generates offload-tier candidates along a GPU-offload ladder (`0 / 0.25 / 0.50 / 0.75 / off`) and classifies resource-fit — `offload-0` becomes `resource-insufficient` (almost nothing on GPU) while `offload 0.25/0.50/0.75` are `gpu-resident` and recommendable. On this 16 GB host the optimizer's recommendable tiers are not permitted to exceed what `max` already does, so a **higher offload ratio does not raise decode throughput**; the honest result is that the explicit tier lands at or slightly below the `max` baseline (~−20% decode here). The value of `optimize` for this over-VRAM model is runnability/resource-fit, not speed. `benchmark --yes` persists the measured peak (≈0.25 GiB, far below the ≈19.2 GiB `totalMemoryBytes` estimate) as `memoryPeakBytes`, and `optimize --yes` writes a `calibration` audit row (`ratio≈0.013`, `note:'calibrated'`, `confidence:'measured'`).

### Qwen3.6-35B-A3B-Q4_K_M (19.7 GB MoE, beyond VRAM) — adaptive offload candidates + measured calibration

| 35B metric | `max` (baseline) | offload 0.5 |
| --- | ---: | ---: |
| Load time (ms) | ≈45090 (cold) | ≈24000 (warm) |
| TTFT (ms) | ≈596 | ≈710 |
| Decode (tok/s) | **≈27.2** | ≈24.6 |
| Measured peak VRAM (GiB) | ≈0.25 | ≈0.25 |

Similarly, with adaptive-offload support landed, the 35B (MoE) is **no longer rejected outright**: the offload ladder produces `offload-0` → `resource-insufficient` and `offload 0.25/0.50` → `gpu-resident` (recommendable). As with the 27B, on this host a higher offload tier does not improve decode — the explicit tier lands slightly below the `max` baseline (~−10% here); `optimize`'s value is runnability/resource-fit for an over-VRAM model, not speed. `benchmark --yes` calibrates the measured peak (≈0.25 GiB) against the ≈21.4 GiB `totalMemoryBytes` estimate, and the audit row carries `calibration` (`ratio≈0.012`, `note:'calibrated'`, `confidence:'measured'`).

> The 27B/35B figures above are real-machine measurements from 2026-09-12 on an RTX 5060 Ti 16 GB + external drive (local LM Studio session). The measured peak reflects only the server-reported GPU-resident portion, not total host-memory use.

### Measurement conditions and honest notes

- The 9B first baseline run hit a cold disk cache (peak 271 MB / load 23.5 s); a clean re-run went into the table.
- The 27B/35B figures are real-machine measurements from the 2026-09-12 session; they are indicative of behavior under the stated setup rather than a performance guarantee.
- The 27B/35B `max` baseline is an author-tuned running configuration, not an LM Studio factory default; the optimizer's recommendable offload tiers cannot be more aggressive than `max`, so decode did not improve at higher offload on this host (see each table).
- Fix (2026-09-12): numeric offload tiers previously sent a `gpu_offload` key to REST v1 `/load`, which LM Studio rejects with `400 unrecognized_keys`, crashing benchmark; numeric tiers now load via `lms load --gpu <ratio>` (measure still uses the REST chat endpoint), while `max`/`off`/`auto` keep the REST loader.
- **Measured ranking (2026-09-12)**: when a configuration has been benchmarked on this host, `optimize` no longer sorts it by the static heuristic score — the measured candidate is promoted to the top of the list and ranked by its real decode throughput and TTFT. The static score remains the cold-start prior for unmeasured configurations. This closes the loop: after `benchmark --yes`, the next `optimize` surfaces the genuinely fastest measured configuration rather than the highest statically-scored one.

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
