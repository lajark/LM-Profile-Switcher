# LM Profile Switcher 0.2.2-beta.1 (Windows x86_64) — Release Notes / 发布说明

- Status / 状态: **Windows x86_64 修复候选（Pre-release，UNSIGNED）** — 从 0.2.2-beta.1 版本源（`tauri.conf.json` 单一版本源）构建；发布与 Tag 按用户授权执行。
- Target / 目标: Windows x86_64, NSIS currentUser installer（开发/预发布构建）。
- Source commit / 来源提交: 见 `release-manifest.json` 的 `sourceCommit`（本候选从单一目标提交构建并溯源；tag `v0.2.2-beta.1` 标记版本号提升提交）。
- Signing / 签名: 无代码签名证书 → 安装包为 **unsigned**；macOS 分发仍 blocked（无硬件/凭据）。依 `PROJECT_DISTRIBUTION_POLICY.md` §5.3。

## What changed since 0.2.1-beta.1 / 相较 0.2.1-beta.1 的变化

- **修复：桌面编辑器最小字段创建被拒（`PROFILE_INVALID`）**：编辑器此前在 `runtime`/`generation`/`behavior` 区段未被触及时不挂载这些键，而领域契约要求 `behavior.mode` 必填（`exclusive|coexist`），真实 sidecar 因此拒绝保存。现编辑器始终输出三个区段并默认 `behavior.mode = exclusive`。0.2.1 发布说明中的「三个区段全空无法保存」限制**已解除**。
- **新增：应用内“帮助”标签**：同窗口双语（zh-CN/en）介绍应用用途、安装步骤、使用流程、数据隐私与已知限制；提供 A−/A+ 字号调节（12–20px，带 aria-label）。
- **修复：CLI 模型发现丢失量化信息**：`lms ls --json`（lms 0.3.x）原生提供的 `quantization.name` 与 `paramsString` 此前被丢弃，CLI 回退路径下量化/参数量恒为 null；现保留 host 报告值并优先于文件名启发式（真机复验：27B→Q4_K_M/27B、9B→Q4_K_M/9B）。
- **修复：真机冒烟脚本模型匹配**：`scripts/smoke-real.mjs` 误用 `key` 字段（契约字段为 `modelKey`），导致在线冒烟长期误报 “model not found”。
- **真实 LM Studio 在线冒烟闭环（2026-09-13）**：Developer Server 在线 + Bearer 认证下，`lmps models/current/snapshot` 均 exit 0（9 个模型；无加载时 active 全 null、snapshot 为 `profileId:"none"`）；`lms load --estimate-only --yes` 对 9B 返回 exact 6.10 GiB；`smoke:real` 全链（list → current → readEffectiveConfig → load echo → unload）exit 0，宿主恢复无模型加载，记录脱敏落盘。

## Verification / 验证

- 综合门禁 `pnpm run check` exit 0：Lint、类型检查、i18n 门禁、构建、领域 Schema 门禁、**100 个测试文件 / 1160 passed（1 skipped）**、合规汇总（567 包许可证 + CycloneDX SBOM）。
- 桌面 E2E：browser 模式 **24/24**（headless Edge，双语/缩放/窄窗口）；Windows-shell 模式 **5/5**（tauri-driver 驱动真实 debug 壳 + 真实 sidecar SEA，含最小字段创建落盘断言与 sidecar 被杀后监督重启）。
- `policy:scan --strict` 0 blockers；发布暂存树经 `policy-scan --release --strict` 纯 fs 扫描。
- NSIS 安装→升级→回滚→sidecar 握手→启动无孤儿进程→卸载验证结果见本轮发布记录（LOCAL-ONLY 报告目录）。

## Installation / 安装

- 运行 `LM Profile Switcher_0.2.2-beta.1_x64-setup.exe`（当前用户安装，NSIS；未签名 → SmartScreen 可能警告，选择“仍要运行”即可）。
- 支持从 0.2.0-beta.1 / 0.2.1-beta.1 在当前用户内直接升级。
- 校验：随包的 `checksums.sha256`（脚本生成）；`sbom.cdx.json` / `THIRD_PARTY_NOTICES.generated.md` / `dependency-licenses.json` 一并提供。

## Known limitations / 已知限制

- macOS 制品、代码签名、公证仍阻塞；Gitee 仅镜像源码与 tag，Release 制品在 GitHub。
- 无自动更新；`main` 为唯一代码主线。
- 在线冒烟覆盖 adapter 全链（含真实加载 echo 与卸载），但经完整激活事务（加锁 → 健康检查 → 失败自动回滚）的真实 `apply` 在线验收仍待执行。
- `smoke:real` 失败退出路径存在已知 Node/libuv 进程拆解断言，仅影响失败路径的进程收尾，不影响成功路径。
