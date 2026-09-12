# LM Profile Switcher 0.2.0-beta.1 (Windows x86_64) — Release Notes / 发布说明

- Status / 状态: **GitHub Pre-release (UNSIGNED)** — 2026-09-12 已发布 Windows x86_64 预发布；Gitee 仅镜像源码，不承载下载制品。
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
- **校准勘误（M6-001）**：0.2.0-beta.1 的 Benchmark 在加载后和推理后复用了加载前硬件快照，并将绝对 VRAM 使用量与 GPU+系统内存 Total Memory 估算比较。因此历史 calibration 仅作问题记录，不是有效的资源证据，也不会自动迁移到新推荐。升级到 0.2.1-beta.1 后必须重新 Benchmark；在重新测量前不要据此提高置信度、放宽安全余量或判断模型可运行。
- 原始审计记录与发布制品保留，勘误不删除历史证据。修复版本目标为 `0.2.1-beta.1`，仅在 M6-002～M6-007 验收且获授权后发布；macOS、签名和公证不以 Windows 结果代替。
