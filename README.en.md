# LM Profile Switcher

**Bootstrap workspace | Version 0.1.0**

LM Profile Switcher is an independent, unofficial community tool for local LM Studio profile management. It is not affiliated with or endorsed by LM Studio.

The repository is currently a bootstrap skeleton. Product behavior is added one atomic task at a time from `TASKS.md`.

## Development

Requirements: Node.js 20 or newer and pnpm 10.15.0 (Corepack is supported).

```text
corepack pnpm install
corepack pnpm run check
```

`check` runs linting, type checking, the i18n gate (locale key parity, generated-key freshness, and a hard-coded user-visible string scan), the TypeScript build, unit tests, and the compliance bundle. Bootstrap checks do not connect to LM Studio or download models.

Final release target: ship both a Windows installer and an installable macOS distribution. The supported macOS architecture, signing, and notarization are decided from M3-004 evidence.

## Internationalization foundation (M0-003)

- `packages/i18n` provides an environment-agnostic i18next core reusable across the CLI, Core Service, and React/Web GUI: language detection and normalization, English fallback, instant switching, injectable persistence, and type-safe translation keys.
- Launch locales are `zh-CN` and `en`, with resources in `locales/<locale>/common.json`; machine-readable JSON output is never localized.
- `corepack pnpm run i18n:check` is the CI gate that validates locale key parity, generated-key freshness, and a hard-coded user-visible string scan; after editing resources, rerun `corepack pnpm run i18n:generate` to rebuild type-safe keys.

## Domain contracts (M0-004)

- `packages/domain` provides pure domain contracts (no Node/Tauri/file-system/network/LM Studio imports, reusable in the WebView): the ten PRD §6 contracts (`HardwareProfile`, `ModelProfile`, `TaskProfile`, `RuntimeProfile`, `GenerationProfile`, `BehaviorProfile`, `LoadEstimate`, `BenchmarkResult`, `ActivationTransaction`, `CapabilityMatrix`) plus the composite `CompositeProfile`.
- Zod is the single source of truth: types, validators, and generated JSON Schemas (`packages/domain/schemas/*.schema.json`, guarded by a `__CHECKSUM__`, never hand-edited). Field constraints follow the published v1 samples under `schemas/`; those samples are not modified.
- Serialization round-trips through JSON and YAML. Unknown-field policy: preserved by default (forward compatible) and explicitly rejected in strict mode for imports; unsupported versioned documents fail with stable error codes instead of being silently reshaped.
- Migrations (`packages/domain/src/migrate.ts`) are pure functions: failures leave the source untouched (rollback-safe), future versions are rejected, and a tool splits composites into independent runtime/generation/behavior contracts.
- `corepack pnpm run domain:generate` (after `build`) regenerates the artifacts; `corepack pnpm run domain:schema:check` is the CI freshness gate.

## Hardware probe (M1-001)

- `packages/hardware` probes the host OS/CPU/RAM/GPU/VRAM/disks/power and returns a domain `HardwareProfile`; every platform capability enters collectors through an injected `ProbeEnv`, so the pure modules are fixture-testable cross-platform with synthetic data only.
- The GPU path tries `nvidia-smi` first and emits `gpus` entries only when both VRAM totals are reliable (user-confirmed policy); otherwise it falls back to a generic adapter enumeration (WMI + registry class key) whose names feed the hardware fingerprint, keeping `gpus: null`.
- Diagnostics are redacted (`redactDiagnostics`) and the fingerprint (`computeHardwareFingerprint`) is built only from stable, non-identifying fields (`os`/`arch`/`cpuModel`/`cores`/`threads`/`totalMemoryBytes`/sorted `gpuNames`/sorted `volumeTotalBytes`).
- `corepack pnpm run hardware:probe` prints a redacted machine JSON snapshot and requires `corepack pnpm run build` first; its output is LOCAL-ONLY and must not be committed.

## Profile store (M1-002)

- `packages/profile-store` persists domain profiles: CRUD, atomic writes (temp + fsync + same-directory rename; any failing step throws a stable `STORE_IO_FAILED` and the original file stays intact), write-ahead backups (default keeps the newest 20, configurable 1–200) and `recover()` startup repair (corrupt main files restored from the newest valid backup, missing mains resurrected from backups, leftover temps removed).
- Storage enters through an injected `Fsys` seam and clock (`ctx.now()`), so the pure modules are offline testable; runtime failures map to `STORE_*` machine codes (`STORE_NOT_FOUND`/`STORE_CORRUPTED`/`STORE_IMPORT_FAILED`…), config errors (e.g. out-of-range backup count) throw plain `RangeError`.
- Import/export supports JSON and YAML: import rejects unknown fields by default (strict), resolves id collisions with `allowRename` and enforces a size limit (`STORE_LIMIT_EXCEEDED`); export is sanitized by default — unknown token/secret-looking keys become `null`, absolute private path segments (`C:\Users\…`, `/home/…`) become `<private>`, domain fields are unaffected, and round trips are consistent.
- An optional `ProfileIndex` interface (`list/get/upsert/remove/invalidate`) ships with the in-memory `createMemoryIndex`; the SQLite-backed index is deferred by confirmed decision — profile files remain the single source of truth.

## CLI (M1-004)

- `apps/cli` ships the `lmps` product command: `profile list/show/create/edit/clone/delete/import/export`, `hardware`, `lang`, and `doctor` are fully implemented; `models/current/snapshot` are injected seams that honestly return exit 6 until M1-003/005 wire them.
- Global flags `--json/--lang/--verbose/--no-color/--timeout`; machine envelope `{product,api,ok,locale,command,data|error}` is stable and never localized; human output goes through i18n keys (`zh-CN`/`en`); exit codes 0/2/3/4/5/6/10 (2/3/5 reserved for M1-005).
- Data root `LMPS_HOME` (default `~/.lmps`) holds the profile store and language persistence; `doctor --bundle` diagnostics are redacted first; full contract: `docs/CLI_SPEC.md`.
- Try it: `corepack pnpm run build` first, then `corepack pnpm run lmps -- --help` or `corepack pnpm run lmps -- --json profile list`.

The files below remain the authoritative product and engineering baseline.

This package is designed for phased execution by AI coding tools such as Claude Code, Codex, Cursor, and TRAE, and for human implementation and review.

## Final decisions

- Formal name: **LM Profile Switcher**
- Short UI name: **LM Switcher**
- CLI command: `lmps`
- Architecture: **TypeScript Core and CLI first, followed by a thin Tauri 2 desktop shell hosting a Web GUI**
- GUI: **React/Web GUI**; CC Switch may inform layout and interaction design, but its code and repository are not dependencies
- Project license: **MIT** (see `LICENSE`)
- LM Studio integration: official TypeScript SDK, native REST API v1, and `lms` CLI behind one Adapter boundary
- Open-source reuse: selective ports are allowed; forks as the product base, Git submodules, Git subtree coupling, runtime fetching, and cross-repository build dependencies are forbidden
- Launch locales: Simplified Chinese and English, with extensible locale packs
- Stable features must never read or modify private LM Studio formats or directories

## Reading order

1. `AGENTS.md`
2. `PROJECT_DISTRIBUTION_POLICY.md`
3. `docs/PRD.en.md`
4. `TASKS.md`
5. `docs/IMPLEMENTATION_PLAN.md`
6. `docs/ARCHITECTURE.md`
7. `docs/OPEN_SOURCE_REUSE_POLICY.md`
8. `docs/TRACEABILITY_MATRIX.md`

> This is an independent, unofficial community tool and is not affiliated with or endorsed by LM Studio.
