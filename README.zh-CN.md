# LM Profile Switcher

[English](README.md)

独立、本地优先的 [LM Studio](https://lmstudio.ai) 伴侣工具：提供硬件感知的模型 Profile 管理、基于任务的配置推荐、有界实测校准与一键安全切换。本项目是**独立、非官方的社区项目**，与 LM Studio 官方不存在隶属、合作或背书关系。

## 功能特性

- **Schema 校验的 Profile**：版本化的 `HardwareProfile` / `ModelProfile` / `TaskProfile` / `RuntimeProfile` / `GenerationProfile` / `BehaviorProfile` 领域契约，以纯 JSON/YAML 持久化在 `LMPS_HOME`（缺省 `~/.lmps`）下，支持原子写入与写前备份。
- **硬件感知的推荐**：本机硬件探测（GPU 优先 `nvidia-smi`、通用回退），确定性候选优化器带显存安全余量，按任务类别排序并附中英双语理由。
- **Benchmark Lite**：有界、可取消、绑定机器指纹的客观基准（加载时间 / TTFT / Prefill / Decode tokens·s⁻¹ / 峰值显存），结束后自动恢复原模型。
- **安全激活事务**：带健康检查与自动回滚的状态机；CLI、托盘、Benchmark、Hook 与 Proxy 共用同一把 `activation.lock` 串行化激活。
- **桌面端（Tauri 2）**：React/Web GUI 由轻量 Rust 壳承载——Profile 编辑器、优化向导、基准视图、硬件面板，以及驱动与 CLI 同一激活事务的系统托盘。
- **本机自动化（仅回环）**：
  - `lmps hook`：按应用/任务驱动的模型切换，持久化 token 认证，默认拒绝（deny-by-default）规则；
  - `lmps proxy`：OpenAI 兼容 HTTP 面（`GET /v1/models`、`POST /v1/chat/completions`），经默认拒绝的别名文档把虚拟模型名映射到 Profile，支持会话锁定与显式 opt-in 激活。两者均只绑定 `127.0.0.1`。
- **国际化**：所有用户可见字符串均为 `zh-CN` 与 `en` 双语；`--json` 输出使用稳定、不本地化的机器信封。
- **受治理的分发**：`policy:scan` 结构性策略/Secret 扫描守门每一次提交、发布暂存树与 CI 流水线（strict 模式）。

## 环境要求

- Node.js ≥ 20 与 pnpm 10.15.0（支持 Corepack）。
- 桌面端构建需要 Windows 或 macOS；CLI 可在任意 Node.js 环境运行。

## 快速开始

```text
corepack pnpm install
corepack pnpm run build
corepack pnpm run lmps -- --help
corepack pnpm run lmps -- --json profile list
```

`corepack pnpm run check` 依次运行 Lint、类型检查、i18n 门禁、TypeScript 构建、领域 Schema 生成与时效门禁、单元测试与合规汇总；无需连接 LM Studio 或下载模型。

## 文档

- `docs/ARCHITECTURE.md` — 模块、进程与 Adapter 设计
- `docs/CLI_SPEC.md` — `lmps` 命令契约、机器信封与退出码
- `docs/SECURITY.md` — 威胁模型、Secret 处理与回环绑定策略
- `docs/OPEN_SOURCE_REUSE_POLICY.md` — 借用代码的来源与许可证规则
- `docs/TRACEABILITY_MATRIX.md` — 需求—任务—测试追踪
- `docs/RELEASE_NOTES-0.1.0.md` — 首个打包版本发布说明
- `PROJECT_DISTRIBUTION_POLICY.md` — 文件分类与发布边界
- `AGENTS.md` — 项目规则与已验证命令

## 仓库布局

```text
apps/cli                 lmps CLI（薄入口）
apps/core-service        本地 sidecar：stdio/管道/回环 HTTP IPC、Hook 与 Proxy 面
apps/desktop             Tauri 2 壳 + React/Web GUI 与系统托盘
packages/benchmark       有界客观基准
packages/core            用例编排、状态机与业务规则
packages/domain          纯领域契约 + 生成的 JSON Schema
packages/hardware        本机硬件探测
packages/i18n            语言资源与类型安全 key
packages/lmstudio-adapter  所有 LM Studio 调用（SDK / REST v1 / lms CLI）统一在一个边界之后
packages/optimizer       数据驱动、有界的候选生成
packages/profile-store   原子存储、备份、迁移、导入导出
scripts/                 策略扫描、发布组装、安装验证
```

## 许可证

MIT — 见 [LICENSE](LICENSE)。

> LM Profile Switcher 是独立、非官方的社区工具，与 LM Studio 官方不存在隶属、合作或背书关系。