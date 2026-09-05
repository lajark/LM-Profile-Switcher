# Architecture / 架构设计

## 1. Decision

The product uses a **TypeScript Core + CLI-first architecture**, with a **React/Web GUI hosted by a thin Tauri 2 desktop shell** added after the core is proven.

选择 TypeScript Core 的原因：

- LM Studio 官方 TypeScript SDK 暴露高级加载配置；
- CLI、Optimizer、Adapter 和 i18n 可在同一运行时复用；
- AI 编程工具对 TypeScript 单元测试和重构支持成熟。

Tauri WebView 承载 React/Web GUI，但不直接执行 Node 业务逻辑，因此桌面端通过打包的 Core Service Sidecar 与 Core 通信。Sidecar 打包方式必须先做技术 Spike，以实际验证 `@lmstudio/sdk` 的兼容性，不能假设“零成本”。

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

## 4. Core Service Sidecar

Responsibilities:

- expose typed local IPC for desktop;
- own the TypeScript Core process;
- enforce a single activation lock;
- authenticate each desktop session with a random token;
- bind only to local IPC or loopback;
- shut down with the desktop unless configured as a background service.

The transport is an implementation decision from task `M0-006`. Candidate transports:

1. stdio JSON-RPC;
2. local named pipe / Unix domain socket;
3. loopback HTTP with random ephemeral port and token.

The Spike must compare packaging, cancellation, streaming status, crash recovery, and Windows support.

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

## 9. Architecture Fitness Tests

CI should eventually verify:

- presentation packages do not import LM Studio SDK;
- domain has no Node/Tauri dependencies;
- Rust shell does not contain optimizer/profile rules;
- no private `.lmstudio/.internal` path strings in stable source;
- every user-visible key exists in both locales;
- every vendored/ported file has provenance.
