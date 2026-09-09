# LM Profile Switcher 0.1.0 — Release Notes / 发布说明

> Development/pre-release build. The Windows installer is unsigned; install with
> knowledge of the source and treat it as a pre-release artifact.

## English

**LM Profile Switcher 0.1.0** — independent local profile management for LM Studio.

- Hardware and model probing (nvidia-smi / Mock), Task Profile based candidate
  optimization with bounded benchmarks, versioned Profile storage, and one-click
  activation with transactional rollback.
- CLI (`lmps`), local sidecar service with Loopback HTTP / named-pipe / stdio
  transports, and a Tauri desktop shell (tray menu, minimize-to-tray, apply
  profiles from the GUI).
- Fully local: no telemetry, no account, no cloud. All data stays on this machine.
- Languages: 简体中文 / English.

**Platform**: Windows x64 (x86_64), installer NSIS (current user, no admin needed).

**Known limitations of this build**

- Installer is **unsigned** — SmartScreen / unknown-publisher warnings are expected.
- No auto-update is configured.
- Real LM Studio server validation is pending; the mock adapter drives the
  deterministic flows in this build.

## 简体中文

**LM Profile Switcher 0.1.0** — 面向 LM Studio 的独立本地 Profile 管理。

- 硬件与模型探测（nvidia-smi / Mock）、基于 Task Profile 的有界候选优化与
  Benchmark、版本化 Profile 存储、带事务回滚的一键激活。
- CLI（`lmps`）、本地 sidecar 服务（Loopback HTTP / 命名管道 / stdio 传输），
  以及 Tauri 桌面壳（托盘菜单、最小化到托盘、GUI 应用 Profile）。
- 完全本地：无遥测、无账号、无云端。所有数据仅存于本机。
- 语言：简体中文 / English。

**平台**：Windows x64（x86_64）；安装方式 NSIS（当前用户、无需管理员权限）。

**本版本已知限制**

- 安装包**未签名**——SmartScreen /「未知发布者」警告属预期行为。
- 未配置自动更新。
- 真实 LM Studio 服务器验证待补；本版本确定性流程由 mock 适配器驱动。

## Installation / 安装

- Windows：运行 `LM Profile Switcher_0.1.0_x64-setup.exe`，选择语言后按向导安装。
- 卸载：通过「设置 → 应用」或 `Uninstall LM Profile Switcher.exe`（安装目录内）。
- 环境变量（可选）：`LMPS_LM_URL`、`LMPS_LM_TOKEN`、`LMPS_ADAPTER`。
  数据目录默认 `%LOCALAPPDATA%\LM Profile Switcher\`。

## License / 许可

MIT — see [LICENSE](../LICENSE) and `THIRD_PARTY_NOTICES.generated.md`.