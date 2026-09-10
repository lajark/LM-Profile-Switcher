# LM Profile Switcher

[简体中文](README.zh-CN.md)

Independent, local-first companion for [LM Studio](https://lmstudio.ai): hardware-aware model profiles, task-based configuration recommendations, bounded benchmarking, and safe one-click switching. It is an **independent, unofficial community project** — not affiliated with or endorsed by LM Studio.

## Features

- **Schema-validated profiles** — versioned `HardwareProfile` / `ModelProfile` / `TaskProfile` / `RuntimeProfile` / `GenerationProfile` / `BehaviorProfile` contracts, persisted as plain JSON/YAML under `LMPS_HOME` (default `~/.lmps`) with atomic writes and write-ahead backups.
- **Hardware-aware recommendations** — local hardware probe (GPU via `nvidia-smi`, generic fallback), deterministic candidate optimizer with a VRAM safety margin, ranked per task kind with bilingual rationale.
- **Benchmark Lite** — bounded, cancellable, fingerprint-bound objective benchmarks (load time, TTFT, prefill, decode tokens/s, peak VRAM) that cleanly restore the previous model afterwards.
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

## Getting started

```text
corepack pnpm install
corepack pnpm run build
corepack pnpm run lmps -- --help
corepack pnpm run lmps -- --json profile list
```

`corepack pnpm run check` runs lint, typecheck, the i18n gate, the TypeScript build, domain-schema generation + freshness, unit tests, and the compliance bundle. It needs no LM Studio connection or model download.

## Real-machine benchmarks

Measured on **2026-09-10** on this machine: RTX 5060 Ti 16 GB (driver 596.36), Intel Core Ultra 5 225H (14C/14T), 31.4 GiB RAM, Windows 11. LM Studio server at `127.0.0.1:1234`; every profile runs at `8k context / max GPU offload` (Q4_K_M quantizations). Benchmark settings: 3 samples × 64 tokens via `lmps benchmark`; the numbers below come from the CLI-measured result JSON.

### Qwen3.5-9B-Q4_K_M (5.2 GB, fully GPU-resident)

| Metric | Baseline | After `optimize` | Δ |
| --- | ---: | ---: | ---: |
| Load time (ms) | 6306 | 6315 | +0.1% |
| TTFT (ms) | 169 | **138** | **−18.3%** |
| Prefill (tok/s) | 189 | **219** | **+15.8%** |
| Decode (tok/s) | 65.17 | 64.84 | −0.5% |
| Peak VRAM (GiB) | 6.61 | 6.60 | −0.1% |

The optimizer picked the low-latency candidate: context 8192→4096, temperature (unset)→0.6, offload unchanged (`max`). Result: ~18% faster first token at unchanged decode throughput.

### Qwen3.8-27B-Q4_K_M (15.7 GB, at the VRAM limit) — rejected on purpose

| Metric | Baseline |
| --- | ---: |
| Load time (ms) | 49 244 |
| TTFT (ms) | 5733 |
| Decode (tok/s) | 2.24 |
| Peak VRAM (GiB) | 6.61* |

`lmps optimize` **rejected all candidates**: every quick-chat draft keeps `gpuOffload: max`, and the exact VRAM estimate for 15.7 GB of weights ± KV cache exceeds the 16 GB card, so the optimizer refuses (deny-by-default) instead of recommending an unsafe load. *Peak is the GPU/CPU spill portion — the model only runs via system-RAM overflow.

### Qwen3.6-35B-A3B-Q4_K_M (19.7 GB MoE, beyond VRAM) — rejected on purpose

| Metric | Baseline |
| --- | ---: |
| Load time (ms) | 45 475 |
| TTFT (ms) | 621 |
| Decode (tok/s) | 31.92 |
| Peak VRAM (GiB) | 3.48 |

`lmps optimize` **rejected all candidates** here too: the max-offload estimate counts the full 19.7 GB against 16 GB VRAM. Note the model *does* run in practice — MoE models only keep the ~3 B active experts resident (3.48 GiB peak) — so this rejection is the conservative side of the safety gate, not a limitation fixable in this release.

### Honest notes

- The 9B first baseline run hit a cold disk cache (peak 271 MB / load 23.5 s); a clean re-run went into the table.
- The 27B/35B rejections are intended data points for the deny-by-default safety gate.

- Screenshots: [profiles](docs/screenshots/screenshot-profiles.png) · [optimize accepted](docs/screenshots/screenshot-optimize-9b.png) · [optimize rejected](docs/screenshots/screenshot-optimize-27b-rejected.png) · [hardware](docs/screenshots/screenshot-hardware.png).

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