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

### Qwen3.8-27B-Q4_K_M（15.7 GB，临近显存上限）—— 有意拒绝

| 指标 | 优化前基线 |
| --- | ---: |
| 加载时间 (ms) | 49244 |
| TTFT (ms) | 5733 |
| Decode (tok/s) | 2.24 |
| 峰值显存 (GiB) | 6.61* |

`lmps optimize` **拒绝了全部候选**：quick-chat 规则的每个草稿都保持 `gpuOffload: max`，而 15.7 GB 权重 + KV cache 的精确显存估算超出 16 GB 显存，优化器按"默认拒绝"（deny-by-default）原则不推荐不安全配置。*峰值为 GPU/CPU 溢分配额——该模型只有依赖系统内存溢出才能运行。

### Qwen3.6-35B-A3B-Q4_K_M（19.7 GB MoE，超出显存）—— 有意拒绝

| 指标 | 优化前基线 |
| --- | ---: |
| 加载时间 (ms) | 45475 |
| TTFT (ms) | 621 |
| Decode (tok/s) | 31.92 |
| 峰值显存 (GiB) | 3.48 |

`lmps optimize` 在此处同样**拒绝了全部候选**：max 卸载估算将完整 19.7 GB 计入 16 GB 显存。值得注意的是该模型在实践中*能够*运行——MoE 模型只需约 3 B 活跃专家驻留显存（实测峰值 3.48 GiB）——因此这次拒绝是安全门偏保守的一面，不属于本版本可修复的缺陷。

### 诚实标注

- 9B 首次基线命中了冷磁盘缓存（峰值 271 MB / 加载 23.5 s）；上表使用干净复测值。
- 27B/35B 的拒绝是数据点，符合安全门"默认拒绝"的设计意图。

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