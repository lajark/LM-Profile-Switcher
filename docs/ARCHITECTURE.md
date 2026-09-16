# Architecture / 架构设计

## 1. Decision

The product uses a **TypeScript Core + CLI-first architecture**, with a **React/Web GUI hosted by a thin Tauri 2 desktop shell** added after the core is proven.

选择 TypeScript Core 的原因：

- LM Studio 官方 TypeScript SDK 暴露高级加载配置；
- CLI、Optimizer、Adapter 和 i18n 可在同一运行时复用；
- AI 编程工具对 TypeScript 单元测试和重构支持成熟。

Tauri WebView 承载 React/Web GUI，但不直接执行 Node 业务逻辑，因此桌面端通过打包的 Core Service Sidecar 与 Core 通信。M0-006 已完成技术 Spike 并由 ADR-0003 接受 stdio JSON-RPC 作为桌面生产传输；后续改动必须通过对应测试 seam 验证，不得重新引入未决传输选型。

Benchmark calibration follows the synchronized host-snapshot contract in
[ADR-0004](adr/0004-resource-usage-evidence.md): a pre-load baseline and fresh
post-load/post-sample observations produce versioned VRAM/system-RAM deltas.
Legacy absolute `memoryPeakBytes` remains readable but is not a Total Memory
calibration input.

## 2. Repository Shape

```text
apps/
  cli/
  core-service/
  desktop/
packages/
  domain/
  core/
  lmstudio-adapter/
  hardware/
  profile-store/
  optimizer/
  benchmark/
  i18n/
  logging/
schemas/
locales/
vendor/
docs/
```

## 3. Dependency Direction

```text
Presentation
  apps/cli, apps/desktop, local hook
          ↓
Application
  packages/core use cases and state machines
          ↓
Domain + Ports
  packages/domain
          ↓
Infrastructure
  adapter, hardware, store, benchmark, logging
```

No reverse dependency is allowed.

## 3.1 Model-first desktop information flow

The desktop information architecture is model-first: hardware discovery → LM Studio readiness → discovered model list → selected model → scenario (TaskProfile) → configuration profiles and benchmark history. The home screen target presents models, search, preparation state, and current runtime state; profiles are shown inside the selected model context. M7-003 exposes this read projection through Core buildModelContext and the Sidecar models.context RPC. ProfileStore listEntries keeps valid records and reports unclassifiable legacy files as needs-organization without guessing. UI and Rust remain presentation/integration layers and must reuse the existing Core, Adapter Router, Optimizer, Benchmark, and activation transaction. M7-005 now wires the model-first home/context, default-profile actions, the no-profile safe-default start/preparation path, and the model-context OptimizationLoopService prepare/save/set-default workspace; offline browser fixtures cover explicit no-default selection, safe start plus first-profile save, candidate cancellation, and optimization refusal; the Windows-shell production-bundle Mock seam covers explicit optimization cancellation, failed benchmark evidence with saving disabled, and activation health-check failure with previous-model recovery. The real LM Studio desktop safe-start/load/switch flow now passes in the 2026-09-16 release-candidate review; GUI failure injection/rollback and the independent native OS DPI matrix remain pending.

### 3.2 Model context capability boundary

Core owns the adapter-neutral model/scenario projection and evidence labels. The Sidecar wiring reads only documented Adapter discovery, hardware probe, runtime state, and the existing benchmark ndjson log, then supplies those snapshots to Core. The RPC is additive; existing profile CRUD, import/export, CLI, Hook, Proxy, and activation contracts are unchanged. The projection reports hardware, LM Studio, discovery, and runtime states separately so an internal adapter connection cannot be mistaken for LM Studio readiness.

### 3.3 Optimization and default-selection boundary
M7-004 adds `packages/core/src/optimization-loop.ts` as the single orchestration seam for one model and one Scenario. It runs an injected safety preflight before the existing BenchmarkService baseline phase, delegates bounded candidate generation to RecommendationService, records explicit `run`/`skip`/`not-run` phases, and refuses to save failed or canceled candidate evidence. Save, set-default, Benchmark, and activation remain separate actions.
The default choice is persisted by `packages/profile-store/src/defaults.ts` in a versioned JSON index keyed by model and task type. It is written atomically and rejects malformed, duplicate, missing, or mismatched entries; it never infers a default from profile names or timestamps. M7-005 exposes the model-context, default-selection, no-profile safe-default/preparation, and OptimizationLoopService prepare/save seams through the GUI/Sidecar without duplicating their rules. The workspace keeps save, set-default, Benchmark, and activation as separate actions; the ephemeral safe baseline is never persisted until an explicit candidate save; offline browser and Mock Windows-shell coverage now exercises safe start, first-profile save, canceled candidates, optimizer refusal, failed optimization evidence and activation recovery; the offline regression gate and real safe-start/load/switch flow are complete; GUI failure injection/rollback and the independent native OS DPI matrix remain follow-ups.

## 3.4 Application icon resources

The desktop icon family has one editable SVG under apps/desktop/src-tauri/icons. The existing Tauri CLI renders the accent and two monochrome palettes at eight sizes; scripts/generate-icons.mjs assembles and verifies the ICO without adding dependencies. The 256px frame is first because Tauri decodes the first ICO entry for the default window image. NSIS installer/uninstaller use the same ICO, generated shortcuts inherit the executable icon, and the tray embeds a dedicated 32px PNG at compile time. Icon presentation carries no model/runtime business state. Native installation and OS theme/DPI acceptance remain separate from offline resource verification.

## 4. Core Service Sidecar

Responsibilities:

- expose typed local IPC for desktop;
- own the TypeScript Core process;
- enforce a single activation lock;
- authenticate each desktop session with a random token;
- bind only to local IPC or loopback;
- shut down with the desktop unless configured as a background service.

The production desktop transport is **stdio JSON-RPC**, accepted by ADR-0003 after the M0-006 packaging and lifecycle spike. The Rust shell owns the child-process supervisor and forwards the authenticated request stream; the TypeScript sidecar owns protocol dispatch and Core wiring. Loopback HTTP remains an explicit local adapter/proxy surface, not the desktop control channel.

The transport boundary is kept behind a testable startup seam so tests can exercise spawn, ready/auth handshake, request cancellation, shutdown, crash/restart and process-tree cleanup without opening a network listener. M6-003 makes the entry itself testable: startup settings resolve through the pure `resolveSidecarSettings` module (index.ts stays a thin wiring composition) and the sidecar owns the activation lock with its real pid plus a fail-closed liveness probe, so a crashed sidecar's still-valid lease is reclaimed on restart instead of blocking for the lease window. WebDriver browser-mode tests may replace this seam with deterministic mocked IPC; Windows-shell E2E uses the packaged sidecar. Native tray behavior remains covered by Rust tests and manual acceptance.

## 5. LM Studio Adapter Router

The Router selects an adapter per operation and capability, not a single global adapter.

Adapters:

- `SdkAdapter`
- `RestV1Adapter`
- `CliAdapter`
- `MockAdapter`

Every adapter returns normalized domain objects and structured errors. Raw SDK/REST/CLI objects do not escape the adapter package.

## 6. Independence Boundary

Community repositories are not runtime or build dependencies.

Forbidden:

- product fork based on an upstream app;
- Git submodule or subtree;
- importing source over a URL;
- cloning upstream during build;
- downloading executable code at runtime;
- requiring upstream services or data stores.

Allowed:

- design reference;
- manually reviewed selective port pinned to a commit;
- standard package dependencies;
- official LM Studio SDK/API/CLI.

CC Switch is a Web GUI layout and interaction reference only. It is not a source, asset, build, or runtime dependency of this project.

A selective port becomes locally owned maintenance work and must have local tests, provenance, and license texts.

## 7. Persistence

- Profiles: versioned JSON documents as source of truth.
- Portable import/export: JSON and YAML.
- Backups: immutable snapshots with retention.
- Optional SQLite: index, history, and search acceleration only.
- Secrets: OS credential manager.
- Writes: temp → fsync → atomic rename.

## 8. Activation Transaction

All activation entry points call the same use case. The transaction captures prior state, target state, estimates, steps, applied configuration, errors, and rollback.

The state machine is deterministic and testable with failure injection at each state.

CLI, Core Service, Benchmark, Hook and Proxy activation paths acquire the same filesystem lease (`activation.lock`) through their respective wiring seams. M6-003 verified the cross-process behavior over real child processes — lock contention, the stable `ACTIVATION_LOCK_BUSY` error with a successful retry after release, crash cleanup (a still-valid lease from a dead pid is reclaimed via a fail-closed liveness probe) and the absence of orphan processes; no caller may copy the transaction rules.

## 9. Architecture Fitness Tests

CI should eventually verify:

- presentation packages do not import LM Studio SDK;
- domain has no Node/Tauri dependencies;
- Rust shell does not contain optimizer/profile rules;
- no private `.lmstudio/.internal` path strings in stable source;
- every user-visible key exists in both locales;
- every vendored/ported file has provenance.
