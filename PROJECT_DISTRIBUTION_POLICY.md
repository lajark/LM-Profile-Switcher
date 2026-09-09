# LM Profile Switcher 项目分发与可见性政策

> 版本：v1.0  
> 生效日期：2026-08-21  
> 依据：`PROJECT_DISTRIBUTION_POLICY_TEMPLATE.md` v2.0  
> 核心原则：最小必要分发、默认不公开、Secret 永不进入版本历史、Release 仅从明确清单组装。

## 0. 项目参数与当前状态

```yaml
repository_visibility: "local-only"
release_visibility: "none"
planned_release_targets:
  - "windows-installer"
  - "macos-installable-distribution"
project_license: "MIT"
workspace_dir: ".workspace/"
release_dir: "artifacts/releases/"
generated_reports_dir: "reports/"
policy_scan_command: "corepack pnpm run policy:scan"
ci_policy_job: ".github/workflows/ci.yml → Policy and secret scan (corepack pnpm run policy:scan -- --strict)"
existing_verification_command: "corepack pnpm run check"
existing_compliance_command: "corepack pnpm run compliance"
```

当前事实：

- 仓库尚未配置或核验远端，也没有提交历史，因此当前按 `local-only` 管理。
- 尚未建立正式 Release 流程，`release_visibility` 为 `none`。
- MIT 许可证不自动等同于仓库或 Release 已获准公开；可见性必须单独决定。
- `corepack pnpm run check` 和 `corepack pnpm run compliance` 已存在，但它们不是 Secret/路径分发扫描器。
- `policy_scan_command` 和 `ci_policy_job` 为空，首次推送任何远端前必须实现并验证等价的本地与 CI 守门。
- 将仓库或 Release 改为 `public`/`private` 属于政策变更，必须由用户明确授权并同步本文件、`.gitignore`、CI 和发布清单。

本文件是本项目文件分类、仓库可见性和 Release 内容边界的单一事实来源。`AGENTS.md` 仍是项目总规则的权威来源；发生冲突时依次遵循安全与许可证、`AGENTS.md`，并立即修订本文件消除冲突。

## 1. 核心原则

1. 只分发协作、构建、测试、安装或正式交付确实需要的文件。
2. 无法确定分类时先按 `LOCAL-ONLY` 处理，不因“以后可能开源”提前公开。
3. 源码、内部规划、本机状态、真实运行数据和 Release 制品必须分离。
4. Token、密码、私钥、签名材料、真实凭据和恢复材料不得进入 Git、Artifact、Release、Issue、PR、日志或对话。
5. Profile、Benchmark、诊断包和 LM Studio 探测结果必须默认脱敏，不保存完整 Prompt、文档、Token、私有路径或环境变量值。
6. 可重建的构建产物和报告不入库；正式发布所需副本在发布阶段从受控构建流程生成。
7. Release 必须从明确 allowlist 组装，不得把整个工作区、仓库根目录或 `dist/` 整体打包。
8. Windows 与 macOS 制品分别构建、签名、验证和记录，不得用单一平台结果替代另一平台。
9. 社区项目默认只能作为设计参考；任何代码或资产进入仓库前必须满足 Provenance 和许可证流程。
10. 未执行的扫描、签名、公证、安装或发布检查不得写成“已通过”。

## 2. 分类优先级与可见性矩阵

分类优先级：

```text
SECRET > LOCAL-ONLY > INTERNAL > PUBLIC
```

| 分类 | 公开仓库 | 私有仓库 | 公开 Release | 私有 Release | 本机 |
|---|---:|---:|---:|---:|---:|
| PUBLIC | 允许 | 允许 | 按发布 allowlist | 按发布 allowlist | 允许 |
| INTERNAL | 禁止 | 有条件允许 | 禁止 | 仅明确内部交付时允许 | 允许 |
| LOCAL-ONLY | 禁止 | 默认禁止 | 禁止 | 默认禁止 | 允许 |
| SECRET | 禁止 | 禁止 | 禁止 | 禁止 | 仅专用安全存储 |

“有条件允许”必须同时满足明确协作必要、访问控制匹配、不含更高等级信息，并获得对应仓库或交付范围的授权。

## 3. 项目特定分类

### 3.1 PUBLIC｜可公开候选

以下内容在完成内容审查、且仓库可见性获准变更后，可进入公开仓库：

- 产品源码：`apps/`、`packages/`。
- 公共契约与语言资源：`schemas/`、`locales/`。
- 不含真实数据的测试与工具：`tests/`、`scripts/`。
- 构建与 CI 配置：`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、TypeScript/ESLint/Vitest 配置、`.github/workflows/`。
- 公共入口与治理文档：`README*`、`LICENSE`、`LICENSES/`、`THIRD_PARTY_NOTICES.md`、`AGENTS.md`、`AGENTS.en.md`、本文件。
- 经公开审查的工程文档：`docs/ARCHITECTURE.md`、`docs/CLI_SPEC.md`、`docs/SECURITY.md`、`docs/OPEN_SOURCE_REUSE_POLICY.md`、`docs/TRACEABILITY_MATRIX.md`、已接受且适合公开的 ADR。
- `vendor/` 中经固定 Commit、文件级许可证核验、Provenance 登记和本地测试批准的选择性移植文件。

PUBLIC 表示内容具备公开候选资格，不表示当前已经授权上传或发布。

### 3.2 INTERNAL｜仅内部协作

- `TODO.md`、`TASKS.md`、`docs/IMPLEMENTATION_PLAN.md`、`docs/PRD.*`。
- `docs/tasks/` 完成记录、内部追踪和验收记录。
- `docs/COMPARISON_AND_FINAL_DECISIONS.zh-CN.md` 等竞品/方案比较。
- `MANIFEST.sha256.json`、`VALIDATION_REPORT.md` 等历史规格包校验材料。
- `PROJECT_DISTRIBUTION_POLICY_TEMPLATE.md` 等接收的通用模板或一次性输入。
- `.claude/`、`CLAUDE.md`、`trae-project-rules-mirror.md`、`.gitignore.snippet` 等工具专属协作配置。
- 未公开的性能对比、兼容矩阵草稿、发布演练报告和安全评审。

当前 `local-only` 仓库可以保存 INTERNAL 文件。若未来仓库改为公开，必须在首次推送前逐项公开审查、迁移至私有协作空间或从跟踪集合排除。

### 3.3 LOCAL-ONLY｜仅本机或受控环境

- `.workspace/` 下的 Checkpoint、Handoff、临时计划、决策草稿和新对话提示词。
- `node_modules/`、`.pnpm-store/`、`dist/`、`target/`、coverage、缓存和 `*.tsbuildinfo`。
- `reports/` 下生成的许可证报告、SBOM、Notices 和扫描输出；Release 只复制经批准的最终副本。
- `artifacts/` 下的本地构建、安装包、未签名制品、发布暂存和校验演练输出。
- 本机日志、诊断包、崩溃转储、本地数据库、Profile、备份和配置。
- 真实 LM Studio/硬件 Probe 原始输出、Benchmark 原始结果和含本机指纹的兼容性数据。
- 模型权重、GGUF、媒体、真实 Prompt、用户文档、客户资料和未经授权的数据集。
- 本机 IDE 配置、`*.local.*`、原始附件、ZIP/导出包和一次性迁移资料。

如需把 LOCAL-ONLY 信息转成可分发材料，必须先最小化、脱敏、移除本机标识，并将生成后的独立副本重新分类。

### 3.4 SECRET｜秘密或高敏感

- LM Studio/API Token、服务密码、数据库连接串、真实 `.env`。
- Sidecar/Hook 会话 Token、认证密钥和凭据导出。
- Windows 代码签名证书私钥、PFX/P12 密码和硬件令牌访问凭据。
- Apple Developer ID 私钥、App Store Connect/API Key、Notarization 凭据和恢复材料。
- SSH 私钥、云/CI Token、发布账号 Session、密钥种子与恢复码。
- 未授权个人信息、客户秘密或受监管数据。

SECRET 只能进入操作系统凭据管理器、CI Secret、硬件密钥或经批准的 Secrets Manager。示例文件只允许字段名和不可用占位值。

## 4. Git 与远端分发规则

### 4.1 Commit 前

- 用 `git status --short` 检查全部新增和修改文件，包括未跟踪文件。
- 为每个新文件确定分类；不能确定时移入 `.workspace/` 或其他 LOCAL-ONLY 路径。
- 检查没有真实 `.env`、Token、私钥、证书、Profile、模型、日志、诊断包或原始 Benchmark。
- 运行与任务相关的最小验证；治理、依赖或发布相关变更至少运行 `corepack pnpm run check`。
- 未经用户明确要求，不创建 Commit。

### 4.2 首次远端 Push 前的硬门槛

政策/Secret 扫描器已实现并经本地验证（M3-004）：`scripts/policy-scan.mjs`，覆盖未跟踪文件（`git ls-files --others --exclude-standard`）、Secret 模式、禁止路径、大文件和证书/私钥；CI 中已配置等价的 `ci_policy_job`。首次推送前仍须完成：

1. 明确远端 URL 和 `public`/`private` 可见性，并更新 §0。
2. **远端第一次实际运行时，CI 政策扫描 Job 必须真实运行并成功**（本地已验证，远端随后续首次 Push 验证）。
3. 根据目标可见性审查 INTERNAL 文件；公开仓库不得直接推送 INTERNAL 内容。
4. 确认 `.gitignore` 与本政策一致，且没有误排除构建所需 PUBLIC 文件。
5. 运行 `corepack pnpm run check` 和 `corepack pnpm run policy:scan -- --strict`。
6. 获得用户对 Commit 和 Push 的明确授权。

在上述条件满足前，Agent 不得声称仓库已准备好公开或推送。

### 4.3 Git 历史污染

- Secret 进入历史后必须立即轮换/吊销、暂停共享、评估范围、清理历史并重新扫描。
- 受限数据或版权材料进入历史后必须停止分发，并清理仓库、Release、Artifact 和缓存副本。
- 只删除当前文件或更新 `.gitignore` 不构成历史修复。

## 5. Release 组装与平台规则

### 5.1 Release allowlist

最终 Release 只能由 M3-004 建立并审查的 allowlist 组装，至少包含：

- 对应平台的可安装制品：Windows 安装包、macOS 可安装分发包。
- `LICENSE`、必要第三方许可证、`THIRD_PARTY_NOTICES`。
- 发布时重新生成并审阅的 SBOM 与依赖许可证清单。
- `release-manifest.json`、`checksums.sha256`、版本信息和面向用户的变更说明。
- 产品运行所需且已通过许可证、隐私和安全审查的资源。

默认禁止进入 Release：

- `.workspace/`、Git 元数据、内部 PRD/TODO/TASKS、工具专属 Agent 配置。
- 源码仓库全量副本、测试源码、未审阅的 `reports/`、coverage、日志、崩溃转储和调试符号。
- 用户 Profile、模型、真实 Prompt/文档、LM Studio 私有数据、本机路径和环境信息。
- Secret、签名私钥、公证凭据、CI 配置值或任何凭据缓存。
- 未登记的 `vendor/` 文件、社区项目二进制或构建期/运行时下载代码。

### 5.2 完整性与可追溯性

- `release-manifest.json` 至少记录产品版本、源码版本/Commit、构建时间、目标 OS/架构、制品列表、签名/公证状态、SBOM 和 Schema 版本。
- `checksums.sha256` 必须由发布脚本从最终制品生成，不手工维护。
- 每个平台制品必须能追溯到相同的版本化源码；平台差异必须在 Manifest 中显式记录。
- Release 构建不得在运行时克隆社区应用仓库或下载可执行代码。

### 5.3 Windows 与 macOS

- Windows 与 macOS 分别进行干净机安装、卸载、升级/回滚和首次启动验证。
- 正式制品的签名、公证和架构支持必须按实际状态记录；未签名/未公证制品只能作为明确标识的开发或预发布产物。
- Windows 签名私钥和 macOS Developer ID/Notarization 凭据不得写入仓库或构建日志。
- macOS 的 Apple Silicon、Intel 或 Universal 支持范围由 M3-004 的真实构建和测试证据决定。

## 6. 第三方代码、资源与许可证

- 项目代码采用 MIT；每个 Release 必须携带项目 MIT 文本。
- 依赖和选择性移植仍按各自许可证处理，不能因项目采用 MIT 而省略其义务。
- CC Switch 当前仅是 Web GUI 布局/交互设计参考，不得复制其源码、截图、图标或品牌资产。
- 任何选择性移植必须在同一变更更新 `docs/PROVENANCE.yml`、`THIRD_PARTY_NOTICES.md`、`LICENSES/`、SBOM、追踪关系和测试。
- 未核验许可证、Commit 或文件级版权的代码和资源不得进入仓库、Artifact 或 Release。

## 7. 自动化、日志与 Artifact

- `.github/workflows/ci.yml` 当前的 `verify` Job 负责 Lint、类型检查、测试、构建和合规报告，不等同于政策/Secret 扫描。
- CI Artifact 默认按 INTERNAL 处理；设置最短实际需要的保留期，不上传 LOCAL-ONLY 原始数据或 SECRET。
- 合规报告只包含依赖元数据和已脱敏信息；出现完整本机路径、环境变量值或用户数据时必须停止上传。
- Release Workflow、签名、自动更新和商店发布配置只有在 M3-004 获得授权后才能新增或修改。

## 8. 例外与事故处理

任何降低分类、扩大可见性、跳过扫描或把禁止内容纳入 Release 的行为都是政策例外，至少记录：对象、原分类、目标范围、原因、风险、授权依据、生效时间和回滚方式。记录放入 `.workspace/decisions/`；若需要团队共享，再生成不含敏感信息的 INTERNAL 决策副本。

发现疑似 Secret 泄露时，优先轮换/吊销凭据、停止分发并评估历史；不得先输出 Secret 内容或仅通过删除最新文件结案。

## 9. Agent / AI 编程工具规则

Agent 在创建、移动、提交、打包或发布文件时必须：

1. 先按本政策分类，再决定路径和分发范围。
2. 将探索输出、Handoff、临时报告和新对话提示词放入 `.workspace/`。
3. 不读取、输出、提交或记录 `.env`、密钥、Token、私钥和签名材料。
4. 不把真实 Profile、Prompt、文档、模型、Benchmark 原始输入或本机路径做成 fixture。
5. 不因用户要求“全部提交/打包”自动包含 INTERNAL、LOCAL-ONLY 或 SECRET。
6. 发布时只使用 M3-004 的 allowlist，不递归打包工作区或仓库根目录。
7. 不将 `check`/`compliance` 描述成 Secret 扫描，也不声称未执行的远端 CI、签名、公证或干净机测试已通过。
8. 未经用户明确授权，不 Commit、Push、创建 Release、签名、公证、上传商店或部署。
9. 发现政策与目录、`.gitignore` 或 CI 不一致时，先停止相关分发动作并报告。
10. 完成影响分发的任务时同步本文件、发布检查清单、TODO 和追踪矩阵。

## 10. 当前验收状态

- [x] 已填写当前仓库和 Release 可见性参数。
- [x] 项目主要路径已映射到明确分类。
- [x] Secret、生成报告、构建产物和本地工作区已有忽略规则。
- [x] Release 目标明确为 Windows 与 macOS，项目许可证明确为 MIT。
- [x] 已有可执行的代码质量与许可证/Provenance/SBOM 合规命令。
- [x] 政策/Secret 扫描命令已实现并经本地验证（`policy:scan`，M3-004）。
- [x] 等价 CI 政策扫描 Job 已配置；远端首次 Push 时实测。
- [ ] 未来公开仓库的 INTERNAL 文件处置尚未决定。
- [x] M3-004 Release allowlist、Manifest 和 checksum 生成流程已实现（`release:pack`）。
- [x] Windows 制品已构建并经本机安装/卸载/升级回滚验证；macOS blocked，签名/公证未执行。

未完成项是对应分发动作的硬门槛，不阻塞当前本地 M0 开发。

未完成项是对应分发动作的硬门槛，不阻塞当前本地 M0 开发。
