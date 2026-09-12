# LM Profile Switcher

[![CI](https://github.com/lajark/LM-Profile-Switcher/actions/workflows/ci.yml/badge.svg)](https://github.com/lajark/LM-Profile-Switcher/actions/workflows/ci.yml)

[English](README.md) · [贡献指南](CONTRIBUTING.md) · [分发渠道](docs/DISTRIBUTION_CHANNELS.md)

独立、本地优先的 [LM Studio](https://lmstudio.ai) 伴侣工具：提供硬件感知的模型 Profile 管理、基于任务的配置推荐、有界实测校准与一键安全切换。本项目是**独立、非官方的社区项目**，与 LM Studio 官方不存在隶属、合作或背书关系。

## 功能特性

- **Schema 校验的 Profile**：版本化的 `HardwareProfile` / `ModelProfile` / `TaskProfile` / `RuntimeProfile` / `GenerationProfile` / `BehaviorProfile` 领域契约，以纯 JSON/YAML 持久化在 `LMPS_HOME`（缺省 `~/.lmps`）下，支持原子写入与写前备份。
- **硬件感知的推荐**：本机硬件探测（GPU 优先 `nvidia-smi`、通用回退），确定性候选优化器带显存安全余量，按任务类别排序并附中英双语理由。
- **Benchmark Lite**：有界、可取消、绑定机器指纹的客观基准（加载时间 / TTFT / Prefill / Decode tokens·s⁻¹ / 峰值显存），结束后自动恢复原模型。
- **实测回流闭环**：每次 `benchmark` 运行都会把被测的精确配置（模型、量化、任务类型、六项可调参数以及硬件指纹）写入 `logs/benchmarks.ndjson`。下一次 `optimize` 时，配置与该历史记录逐值匹配的候选会被提升到未实测候选之前；实测组内按真实 decode 吞吐（70%）与逆 TTFT（30%）加权排序。静态评分仅作为冷启动先验保留——本机实测数字永远压过任何估算。
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

**0.2.0-beta.1 Pre-release 已于 2026-09-12 发布**：[GitHub Releases](https://github.com/lajark/LM-Profile-Switcher/releases/tag/v0.2.0-beta.1) 提供 Windows x86_64 NSIS 安装包（按当前用户安装、未签名），随附 `checksums.sha256`、`release-manifest.json`、SBOM、依赖许可证清单、第三方声明、发布说明与 MIT 许可证——由自动化发布流程（M5-007）从本提交构建。发布在 GitHub 打标签为 `v0.2.0-beta.1`；Gitee 镜像源码但不提供下载制品（未配置 Gitee Releases 页）。macOS 分发仍阻塞（无构建硬件 / Apple 凭据）。

## 快速开始

```text
corepack pnpm install
corepack pnpm run build
corepack pnpm run lmps -- --help
corepack pnpm run lmps -- --json profile list
```

`corepack pnpm run check` 依次运行 Lint、类型检查、i18n 门禁、TypeScript 构建、领域 Schema 生成与时效门禁、单元测试与合规汇总；无需连接 LM Studio 或下载模型。

## 真机基准测试

测试于 **2026-09-10**（9B 首表）与 **2026-09-12**（9B 复测 + 27B/35B）在本机真实会话中进行：RTX 5060 Ti 16 GB（驱动 596.36）、Intel Core Ultra 5 225H（14C/14T）、31.4 GiB 内存、Windows 11。LM Studio 服务位于 `127.0.0.1:1234`；9B 运行在 `8k 上下文 / max 显存卸载`，27B/35B 按下方自适应 offload 梯度测评（Q4_K_M 量化）。基准默认 3 样本 × 64 tokens，通过 `lmps benchmark` 执行；以下数字取自 CLI 实测结果 JSON（原始数据由维护者本地留存）。

### Qwen3.5-9B-Q4_K_M（5.2 GB，全量驻留 GPU）

**2026-09-12 复测**（2 样本 × 64 tokens）：

| 指标 | 基线（max/8k/0.7） | `optimize` 后 | Δ |
| --- | ---: | ---: | ---: |
| 加载时间 (ms) | 6295 | 6271 | −0.4% |
| TTFT (ms) | 119 | 120.5 | +1.3% |
| Prefill (tok/s) | 160.1 | 159.1 | −0.6% |
| Decode (tok/s) | 63.6 | 63.5 | −0.1% |
| 峰值显存 (GiB) | 0.253 | 0.253 | 0.0% |

对全量驻留 GPU 的 9B 而言，结论是：`lmps` 自身几乎零开销——decode 稳定在 ~63-65 tok/s、峰值显存与裸机一致、全程本地运行。这类模型上优化器的价值不在提速（模型已跑在 GPU 上限），而在配置治理：记录所选参数、维持 Schema 校验、经 `apply` 可复现。（2026-09-10 曾观测到 context 8192→4096 的候选带来 −18.3% TTFT；该效果依赖所选候选，不作为稳定承诺——仅作背景。）

### Qwen3.8-27B-Q4_K_M（15.7 GB，临近显存上限）—— 从「装不上」到可运行 + 实测校准

没有 `lmps` 时，27B 要么被拒绝、要么靠手工调参。`lmps optimize` 把它变成一次**可运行、可测量的配置搜索**：

- **不再拒绝超显存模型**：GPU offload 梯度（`0 / 0.25 / 0.50 / 0.75 / off`）生成分档候选并做资源适配分类——`offload-0` → `resource-insufficient`，`offload 0.25/0.50/0.75` → `gpu-resident` 且可推荐。用户看到的是每个挡位「为什么适合/不适合」，而不是一个含糊的拒绝。
- **实测校准揭示内存真相**：`benchmark --yes` 实测峰值 **≈0.25 GiB**（服务端报告的 GPU 驻留部分）对比 ≈19.2 GiB 主机内存估算——审计行记录 `ratio≈0.013`、`note:'calibrated'`、`confidence:'measured'`。这就是「我猜它用 19 GB」与「我量过它」的区别——且会回流给优化器（见下方实测排序）。
- **诚实的速度说明**：在这台 16 GB 主机上，优化器可推荐挡位无法比 `max` 更激进驻 GPU，因此更高 offload **不会**提升 decode：显式挡位落在 `max` 基线或略低（≈9.9 → ≈8.0 tok/s）。对超显存模型，价值是可运行性 + 测量，而非提速。

| 27B 指标 | `max`（基线） | offload 0.75 |
| --- | ---: | ---: |
| Decode (tok/s) | ≈9.9 | ≈8.0 |
| TTFT (ms) | ≈1700 | ≈2160 |
| 加载时间 (ms) | ≈36865（冷） | ≈11000（热） |
| 实测峰值显存 (GiB) | ≈0.25 | ≈0.25 |

### Qwen3.6-35B-A3B-Q4_K_M（19.7 GB MoE，超出显存）—— 从「装不上」到可运行 + 实测校准

35B 同样如此：先前硬性拒绝，现在是一次分档、可测量的配置搜索。梯度产出 `offload-0` → `resource-insufficient`、`offload 0.25/0.50` → `gpu-resident`；实测峰值 ≈0.25 GiB 对比 ≈21.4 GiB 估算，审计链记录 `calibration`（`ratio≈0.012`、`confidence:'measured'`）。与 27B 相同，本机更高 offload 不提升 decode（≈27.2 → ≈24.6 tok/s）——可运行性 + 校准，而非提速。

| 35B 指标 | `max`（基线） | offload 0.5 |
| --- | ---: | ---: |
| Decode (tok/s) | ≈27.2 | ≈24.6 |
| TTFT (ms) | ≈596 | ≈710 |
| 加载时间 (ms) | ≈45090（冷） | ≈24000（热） |
| 实测峰值显存 (GiB) | ≈0.25 | ≈0.25 |

> 以上 27B/35B 数字为 2026-09-12 在 RTX 5060 Ti 16 GB + 外接硬盘上的真机实测（LM Studio 本地会话）；实测峰值仅反映服务端报告的 GPU 驻留峰值，不代表主机内存总用量。

### 测量条件与诚实标注

- 9B 首次基线命中冷磁盘缓存（峰值 271 MB / 加载 23.5 s）；上表基线与优化后使用干净复测值。
- 27B/35B 数值为 2026-09-12 会话的真机实测，反映所声明的配置下可复现的行为，而非性能保证。
- 27B/35B 的 `max` 基线是作者手动调出的运行配置，不是 LM Studio 出厂默认；optimizer 推荐的 offload 挡位无法比 `max` 更激进驻 GPU，故本机实测 decode 未因更高 offload 而提升（见各表）。
- 功能修复（2026-09-12）：数值 offload 挡位此前经 REST v1 `/load` 提交的 `gpu_offload` 键会被 LM Studio 以 `400 unrecognized_keys` 拒绝，导致 benchmark 崩溃；已改为对数值挡位走 `lms load --gpu <ratio>` 加载（measure 仍走 REST chat），`max`/`off`/`auto` 维持 REST 加载。
- **实测排序（2026-09-12）**：当某个配置已在本机完成 benchmark，`optimize` 不再按静态启发式评分排序——实测候选被提升到列表顶部，按真实 decode 吞吐与 TTFT 排序。静态评分仅作为未实测配置的冷启动先验。闭环效果：`benchmark --yes` 之后，下一次 `optimize` 会优先展示本机实测最快的配置，而非静态评分最高的配置。真机验证（2026-09-12，RTX 5060 Ti，qwen3.5-9b）：`optimize --yes` 保存头号候选，对该保存配置 benchmark 实测 decode=64.1 tok/s 并记录精确配置快照（`gpuOffload=0, context 36864, temperature 0.2`）；下一次 `optimize` 逐值匹配该候选，标记为 `MEASURED`（`adjustedTotal=0.70, confidence=high`）并提升至列表顶部。

- 截图：[配置档案](docs/screenshots/screenshot-profiles.png) · [优化向导·接受](docs/screenshots/screenshot-optimize-9b.png) · [硬件](docs/screenshots/screenshot-hardware.png)。

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
