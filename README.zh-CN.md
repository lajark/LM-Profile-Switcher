# LM Profile Switcher

**仓库启动阶段｜版本：0.1.0**

LM Profile Switcher 是一个独立、非官方的 LM Studio 本地模型 Profile 管理工具，与 LM Studio 官方不存在隶属、合作或背书关系。

当前仓库处于启动骨架阶段，产品能力将严格按照 `TASKS.md` 的原子任务逐项加入。

## 开发

要求：Node.js 20 或更高版本，以及 pnpm 10.15.0（支持 Corepack）。

```text
corepack pnpm install
corepack pnpm run check
```

`check` 会依次运行仓库 Lint、类型检查、i18n 门禁（语言 key 一致性、生成文件时效、用户可见硬编码扫描）、TypeScript 构建、单元测试和合规汇总。启动阶段检查不连接 LM Studio，也不下载模型。

最终发布目标：同时提供 Windows 安装包和 macOS 可安装分发包。macOS 支持的具体架构、签名和公证在 M3-004 中通过实测确定。

## 国际化基础（M0-003）

- `packages/i18n` 提供跨 CLI、Core Service 和 React/Web GUI 复用的事件无关 i18next 核心：语言检测与规范化、英文 fallback、即时切换、可注入持久化和类型安全翻译 key。
- 首发语言为 `zh-CN` 与 `en`，资源位于 `locales/<locale>/common.json`；机器 JSON 输出不使用本地化 key。
- `corepack pnpm run i18n:check` 作为 CI 门禁，同时校验语言 key 一致性、生成 key 的时效和用户可见硬编码字符串；改动资源后运行 `corepack pnpm run i18n:generate` 重新生成类型安全 key。

## 领域契约（M0-004）

- `packages/domain` 提供纯领域契约（不依赖 Node/Tauri/文件系统/网络/LM Studio，可在 WebView 复用）：PRD §6 的 10 个核心契约（`HardwareProfile`、`ModelProfile`、`TaskProfile`、`RuntimeProfile`、`GenerationProfile`、`BehaviorProfile`、`LoadEstimate`、`BenchmarkResult`、`ActivationTransaction`、`CapabilityMatrix`）和组合形态 `CompositeProfile`。
- Zod 作为单一事实来源：类型 + 校验器 + 生成的 JSON Schema（`packages/domain/schemas/*.schema.json`，带 `__CHECKSUM__`，不得手工编辑）。字段约束与既有 v1 样例（`schemas/`）保持一致，不修改已发布样本。
- 序列化支持 JSON 与 YAML 往返一致；未知字段策略：默认保留（向前兼容），导入时可用显式 strict 模式拒绝；版本不兼容时报稳定错误码，绝不静默改写。
- 迁移（`packages/domain/src/migrate.ts`）为纯函数：失败不动源对象（可回滚）、未来版本明确拒绝，并提供 Runtime/Generation/Behavior 分离工具。
- `corepack pnpm run domain:generate`（先 `build`）重新生成 Schema；`corepack pnpm run domain:schema:check` 作为 CI 门禁比对产物时效。

## 硬件探测（M1-001）

- `packages/hardware` 探测本机 OS/CPU/RAM/GPU/VRAM/磁盘/电源并返回领域 `HardwareProfile`；所有平台能力经注入的 `ProbeEnv` 进入采集器，纯模块只依赖合成 fixtures 即可跨平台测试。
- GPU 路径优先 `nvidia-smi`，**仅当两个 VRAM 总量都可靠才生成 `gpus` 条目**（2026-08-22 用户确认的策略，WMI `AdapterRAM` 为 uint32 限幅不可信）；否则走通用适配器枚举（WMI + 注册表类键），其名称进入硬件指纹并保持 `gpus: null`。
- 诊断输出经 `redactDiagnostics` 脱敏；指纹（`computeHardwareFingerprint`）只用稳定非身份字段（`os`/`arch`/`cpuModel`/`cores`/`threads`/`totalMemoryBytes`/排序 `gpuNames`/排序 `volumeTotalBytes`）。
- `corepack pnpm run hardware:probe` 输出脱敏机器 JSON 快照，需先 `corepack pnpm run build`；其输出属 LOCAL-ONLY，不得入仓库。

## Profile 存储（M1-002）

- `packages/profile-store` 提供领域 Profile 的持久化：CRUD、原子写（temp + fsync + 同目录 rename，任意一步失败抛稳定 `STORE_IO_FAILED` 且原文件不变）、写前备份（默认保留最新 20 份，1–200 可配）与 `recover()` 启动恢复（损坏主文件→从最新合法备份恢复；备份复活缺失主文件；清理残留 temp）。
- 存储实现经注入的 `Fsys` seam 与时钟（`ctx.now()`）进入，纯模块离线可测；运行时失败映射 `STORE_*` 机器码（`STORE_NOT_FOUND`/`STORE_CORRUPTED`/`STORE_IMPORT_FAILED` 等），配置错误（备份数越界）抛普通 `RangeError`。
- 导入导出支持 JSON 与 YAML：导入默认 strict 拒绝未知字段可用 `allowRename` 处理 id 冲突并限流（`STORE_LIMIT_EXCEEDED`）；导出默认脱敏——未知 token/secret 键置 `null`、绝对私有路径段（`C:\Users\…`、`/home/…`）替换为 `<private>`，领域字段不受影响、往返一致。
- 可选索引接口 `ProfileIndex`（`list/get/upsert/remove/invalidate`）附内存实现 `createMemoryIndex`；SQLite 索引按已确认策略后置，Profile 文件是唯一事实来源。

## CLI（M1-004）

- `apps/cli` 提供产品命令 `lmps`：`profile list/show/create/edit/clone/delete/import/export`、`hardware`、`lang`、`doctor` 为完整实现，`models/current/snapshot` 为注入 seam（M1-003/005 接线前诚实返回 exit 6）。
- 全局 flag `--json/--lang/--verbose/--no-color/--timeout`；机器信封 `{product,api,ok,locale,command,data|error}` 稳定不本地化；人类输出走 i18n key（`zh-CN`/`en` 双语）；退出码 0/2/3/4/5/6/10（2/3/5 为 M1-005 预留）。
- 数据根 `LMPS_HOME`（缺省 `~/.lmps`）含 profile 存储与语言持久化；`doctor --bundle` 的诊断对象先脱敏；详细契约见 `docs/CLI_SPEC.md`。
- 试运行：先 `corepack pnpm run build`，再 `corepack pnpm run lmps -- --help` 或 `corepack pnpm run lmps -- --json profile list`。

以下文件仍是本项目的正式产品与工程基线。

本开发包用于 Claude Code、Codex、Cursor、TRAE 等 AI 编程工具分阶段执行，也供人工开发者和评审者使用。

## 定稿结论

- 正式名称：**LM Profile Switcher**
- 界面简称：**LM Switcher**
- CLI：`lmps`
- 核心路线：**TypeScript Core + CLI 先行，Tauri 2 承载 Web GUI 的桌面薄壳后接入**
- GUI 形态：**React/Web GUI**；布局和交互可参考 CC Switch，但不复制其代码或建立仓库依赖
- 项目许可证：**MIT**（详见 `LICENSE`）
- LM Studio 接入：官方 TypeScript SDK、原生 REST API v1、`lms` CLI 统一封装于 Adapter
- 开源继承：允许选择性移植，但禁止 Fork 主线、Git Submodule、Git Subtree、运行时拉取和跨仓构建依赖
- 首发语言：简体中文、英文；语言包可扩展
- 稳定功能不得读取或修改 LM Studio 私有目录和未公开格式

## AI 编程工具读取顺序

1. `AGENTS.md`：项目级规则的单一事实来源
2. `PROJECT_DISTRIBUTION_POLICY.md`：文件分类、仓库可见性和 Release 内容边界
3. `docs/PRD.zh-CN.md`：完整产品与工程需求
4. `TASKS.md`：原子化任务与验收条件
5. `docs/IMPLEMENTATION_PLAN.md`：里程碑和依赖顺序
6. `docs/ARCHITECTURE.md`：模块、进程和 Adapter 设计
7. `docs/OPEN_SOURCE_REUSE_POLICY.md`：开源代码继承边界
8. `docs/TRACEABILITY_MATRIX.md`：需求—任务—测试追踪

> 本项目是独立、非官方的社区工具，与 LM Studio 官方不存在隶属、合作或背书关系。
