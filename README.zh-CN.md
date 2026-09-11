# LM Profile Switcher

[![CI](https://github.com/lajark/LM-Profile-Switcher/actions/workflows/ci.yml/badge.svg)](https://github.com/lajark/LM-Profile-Switcher/actions/workflows/ci.yml)

[English](README.md) · [贡献指南](CONTRIBUTING.md) · [分发渠道](docs/DISTRIBUTION_CHANNELS.md)

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

## 发布状态

截至 **2026-09-11**，源码仓库已经公开，但 GitHub 和 Gitee 均**没有可供终端用户下载的公开 Release**。本机存在一次基于旧源码提交的 Windows 0.1.0 历史打包结果，它只是维护者验证证据，不是当前版本下载包。当前没有任何 macOS 制品。M5 计划从同一源码生成 Windows x86_64、macOS arm64、macOS x86_64 的 `0.2.0-beta.1` 候选制品，并放入 GitHub Draft/Pre-release；在具备 Mac 真机与 Apple 凭据前，macOS 真机安装、签名和公证将明确标为未验证。

## 快速开始

```text
corepack pnpm install
corepack pnpm run build
corepack pnpm run lmps -- --help
corepack pnpm run lmps -- --json profile list
```

`corepack pnpm run check` 依次运行 Lint、类型检查、i18n 门禁、TypeScript 构建、领域 Schema 生成与时效门禁、单元测试与合规汇总；无需连接 LM Studio 或下载模型。

## 真机基准测试

测试于 **2026-09-10** 在本机进行：RTX 5060 Ti 16 GB（驱动 596.36）、Intel Core Ultra 5 225H（14C/14T）、31.4 GiB 内存、Windows 11。LM Studio 服务位于 `127.0.0.1:1234`；每个档案运行在 `8k 上下文 / max 显存卸载`（Q4_K_M 量化）。基准设置为 3 样本 × 64 tokens，通过 `lmps benchmark` 执行；以下数字取自 CLI 实测结果 JSON（原始数据 LOCAL-ONLY，已按发布政策脱敏）。

### Qwen3.5-9B-Q4_K_M（5.2 GB，全量驻留 GPU）

| 指标 | 优化前 | `optimize` 后 | Δ |
| --- | ---: | ---: | ---: |
| 加载时间 (ms) | 6306 | 6315 | +0.1% |
| TTFT (ms) | 169 | **138** | **−18.3%** |
| Prefill (tok/s) | 189 | **219** | **+15.8%** |
| Decode (tok/s) | 65.17 | 64.84 | −0.5% |
| 峰值显存 (GiB) | 6.61 | 6.60 | −0.1% |

优化器选择了低时延候选：context 8192→4096、temperature（缺省）→0.6、卸载策略不变（`max`）。结果：首 token 快约 18%，decode 吞吐基本持平。

### Qwen3.8-27B-Q4_K_M（15.7 GB，临近显存上限）—— 当前优化器拒绝

| 指标 | 优化前基线 |
| --- | ---: |
| 加载时间 (ms) | 49244 |
| TTFT (ms) | 5733 |
| Decode (tok/s) | 2.24 |
| 峰值显存 (GiB) | 6.61* |

`lmps optimize` **拒绝了全部候选**，原因是 quick-chat 草稿当前都保持 `gpuOffload: max`，且估算结果只与显存比较；但该模型实际上借助系统内存成功运行。这是现有优化器/配置生成的已知缺口：M5 将区分 GPU-resident、Hybrid-memory 与 Host-memory，不再把“超过显存”单独等同于不可运行。*峰值是观测到的 GPU 部分，不代表主机内存总用量。

### Qwen3.6-35B-A3B-Q4_K_M（19.7 GB MoE，超出显存）—— 当前优化器拒绝

| 指标 | 优化前基线 |
| --- | ---: |
| 加载时间 (ms) | 45475 |
| TTFT (ms) | 621 |
| Decode (tok/s) | 31.92 |
| 峰值显存 (GiB) | 3.48 |

`lmps optimize` 在此处同样**拒绝了全部候选**，因为 max 卸载估算按 16 GB 显存进行判断；但该模型实测能够运行，峰值显存为 3.48 GiB。M5 将其作为自适应 offload 与 RAM 感知分类的回归场景；当前结果不能再描述为产品预期的最终行为。

### 诚实标注

- 9B 首次基线命中了冷磁盘缓存（峰值 271 MB / 加载 23.5 s）；上表使用干净复测值。
- 27B/35B 的拒绝保留为 M5 回归证据；它们暴露的是资源模型缺口，而不是期望的产品行为。

- 截图：[配置档案](docs/screenshots/screenshot-profiles.png) · [优化向导·接受](docs/screenshots/screenshot-optimize-9b.png) · [优化向导·拒绝](docs/screenshots/screenshot-optimize-27b-rejected.png) · [硬件](docs/screenshots/screenshot-hardware.png)。

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
