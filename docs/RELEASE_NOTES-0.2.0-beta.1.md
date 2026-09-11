# LM Profile Switcher 0.2.0-beta.1 (Windows x86_64) — Release Notes / 发布说明

- Status / 状态: **Development / Pre-release (UNSIGNED)** — 未签名、仅本地验证，未上传任何公共 Release。
- Target / 目标: Windows x86_64, NSIS currentUser installer（开发/预发布构建）。
- Source commit / 来源提交: 见 `release-manifest.json` 的 `sourceCommit`（本候选从选定 release commit `67089b0` 构建并溯源）。
- Signing / 签名: 无代码签名证书 → 安装包为 **unsigned**；macOS 分发仍 blocked（无硬件/凭据）。依 `PROJECT_DISTRIBUTION_POLICY.md` §5.3。

## What changed since 0.1.x / 相较 0.1.x 的变化
- **内部：自适应混合内存候选（M5-002）**：有界 GPU offload 梯度，27B/35B 超显存时产出非 max-offload 的 Hybrid/Host 候选并附性能/资源警告与 Benchmark 引导。
- **内部：资源契约与实测校准（M5-003）**：CLI 候选行展示 GPU/总内存/RAM 预算；估测 vs 实测纯校准层（实测峰值不覆盖原估算、不隐藏降级）。
- **工程：覆盖率与依赖治理（M5-004）**：覆盖率基线/棘轮（≥80%）、依赖审计、CI 集成与 badge。

## Installation / 安装
- 运行 `LM Profile Switcher_0.2.0-beta.1_x64-setup.exe`（当前用户安装，NSIS）。
- 校验：`checksums.sha256`（脚本生成，勿手改）；`sbom.cdx.json` / `THIRD_PARTY_NOTICES.generated.md` / `dependency-licenses.json` 随包提供。

## Safety / 说明
- 本地优先、无遥测/云端；数据留在本机。
- 未上传播放：本候选仅用于本地/CI 验证，不构成公开发布。