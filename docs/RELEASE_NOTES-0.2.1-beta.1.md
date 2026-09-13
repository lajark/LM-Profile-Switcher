# LM Profile Switcher 0.2.1-beta.1 (Windows x86_64) — Release Notes / 发布说明

- Status / 状态: **Windows x86_64 修复候选（Pre-release，UNSIGNED）** — 候选构建与验证详见 `docs/tasks/M6-007-completion.md`；发布与 Tag 按授权执行。
- Target / 目标: Windows x86_64, NSIS currentUser installer（开发/预发布构建）。
- Source commit / 来源提交: 见 `release-manifest.json` 的 `sourceCommit`（本候选从单一目标提交构建并溯源）。
- Signing / 签名: 无代码签名证书 → 安装包为 **unsigned**；macOS 分发仍 blocked（无硬件/凭据）。依 `PROJECT_DISTRIBUTION_POLICY.md` §5.3。

## What changed since 0.2.0-beta.1 / 相较 0.2.0-beta.1 的变化

- **测量契约修复（M6-002）**：Benchmark 现以「加载前/加载后/每次推理后」的新硬件快照采样同步显存/系统内存增量（`ResourceUsageEvidence` v1），旧绝对 VRAM 与 Total Memory 比较不再参与推荐；校准返回 v2 `CalibrationVerdict`，旧记录保留为历史诊断。
- **入口与集成可靠性（M6-003）**：Sidecar 启动配置收敛为可测试纯模块；真实子进程 stdio/认证/取消/崩溃恢复/跨进程锁/崩溃残留回收均以真实进程测试覆盖。
- **桌面自动化回归（M6-004）**：新增 WebdriverIO browser-mode（20 测试，双语/缩放/窄窗口）与 Windows-shell E2E（真实 sidecar 重启重连）；CI 增加非阻塞 browser job。
- **依赖与供应链治理（M6-005）**：全部直接依赖精确锁定（0 range）、Actions 固定完整 SHA、Dependabot 周更（patch/minor 分组、major 单独、每生态 3 PR、无自动合并）、重复版本理由登记。
- **社区反馈与可发现性（M6-006）**：双语 Issue/PR 模板、CODEOWNERS、私有漏洞报告路由；README 首屏产品化、`docs/BENCHMARKS.md` 实测下沉、Release 下载页模板。
- **CI 稳定性（M6-007 前置修复）**：Sidecar 在发出 `ready` 前注册 SIGTERM/SIGINT 处理器（消除 POSIX 竞态）；e2e-browser job 先构建 workspace dist。

## Benchmark / 校准（v2 契约）

- 0.2.1-beta.1 需以修复后的 v2 契约重新实测 9B/27B/35B；方法见 `docs/BENCHMARKS.md`。
- **状态：外部阻塞（如实）**——真实会话需维护者本机以 `LMPS_LM_TOKEN` 执行（安全策略禁止 AI Agent 触碰该凭据；本候选未包含重测数字）。重测由维护者本地运行后将结果合并回 `docs/BENCHMARKS.md` 与本说明。
- 0.2.0-beta.1 的历史校准仅作问题记录（M6-001 勘误），不参与推荐；未完成 v2 重测前，不得据此提高置信度、放宽安全余量或判断模型可运行。

## Installation / 安装

- 运行 `LM Profile Switcher_0.2.1-beta.1_x64-setup.exe`（当前用户安装，NSIS；未签名 → SmartScreen 可能警告）。
- 校验：`checksums.sha256`（脚本生成）；`sbom.cdx.json` / `THIRD_PARTY_NOTICES.generated.md` / `dependency-licenses.json` 随包提供。
- 支持从 0.2.0-beta.1 升级；升级/回滚/卸载验证见 `docs/tasks/M6-007-completion.md`。

## Known limitations / 已知限制

- 桌面编辑器创建 Profile 时，若 `runtime`/`generation`/`behavior` 三个区段全为空，v2 Schema 会拒绝保存（`PROFILE_INVALID`）；工作区：至少填写一个字段（如上下文长度/温度/行为模式）。修复作为独立工单处理。
- macOS 制品、代码签名、公证仍阻塞；Gitee 仅镜像源码。
- 无自动更新；`main` 为唯一代码主线。
