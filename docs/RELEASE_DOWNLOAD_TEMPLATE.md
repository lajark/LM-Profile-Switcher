# Release Download-Page Template / Release 下载页模板（M6-006）

> 供 M6-007 及后续版本在 GitHub Releases 正文复用。原则：**先告诉用户下载哪个文件，再讲工程版本信息**。替换 `{VERSION}`、`{ASSET}` 等占位；数字必须与 `docs/BENCHMARKS.md` 的 v2 实测证据一致，禁止模拟性能声明。
> M7-001 仅更新文档，不改变此模板的发布事实；M7-005 的模型优先 GUI、Windows 壳 Mock 失败/取消/回滚验收和真实 LM Studio 安全启动/加载/切换已在本地完成，真实 GUI 失败注入/回滚仍需证据；M7-006 原创图标族与 Windows 入口、资源、安装生命周期及用户提供的原生 DPI 证据已在本地完成；M7-007 离线 Mock 工作流 GIF 已完成，仅用于界面预览。只有经过对应任务验收与单独授权后，才能新增流程或视觉素材说明。

---

# LM Profile Switcher {VERSION} — Windows

LM Profile Switcher 是一个面向 LM Studio 的本地优先 Profile 管理器：识别硬件、生成配置候选、本机实测，并在可复现 Profile 之间安全切换。

## Download for Windows / 下载

➡️ **`LM Profile Switcher_{VERSION}_x64-setup.exe`**

Windows 10/11 · x86_64 · Per-user installation（按当前用户安装）

> Beta 提示：当前安装包未签名，Windows SmartScreen 可能显示警告。

## Highlights / 亮点

### Hardware-aware optimization / 硬件感知优化
根据本机 GPU、VRAM、RAM 与任务生成配置候选。

### Real-machine benchmark feedback / 真机实测回流
实测 TTFT 与 decode 数据回流到候选排序。

### Hybrid-memory support / 混合内存支持
超出显存的模型以有界 GPU-offload 候选进行评估，而非直接拒绝。

### Safe switching / 安全切换
Profile 激活包含健康检查与自动回滚。

## Tested hardware / 实测硬件

RTX 5060 Ti 16 GB / 32 GB RAM / Windows 11
测试模型：Qwen 9B、27B、35B 级 GGUF。数据与方法学见 `docs/BENCHMARKS.md`（完整表格见仓库文档）。

## Privacy / 隐私

一切本地运行。无遥测。无云账号。

## Known limitations / 已知限制

- 仅 Windows x86_64；当前无 macOS 二进制。
- Beta 安装包未签名。
- 实测数据基于 RTX 5060 Ti 16 GB / Windows 11 的 v2 契约重测（2026-09-13），见 `docs/BENCHMARKS.md`。

## Integrity & open-source compliance / 完整性合规

- `checksums.sha256`
- `release-manifest.json`
- SBOM（CycloneDX）
- 依赖许可证清单
- 第三方声明（THIRD_PARTY_NOTICES）
- MIT 许可证

## Feedback / 反馈

发现缺陷或有希望测试的硬件×模型组合？请打开 GitHub Issue（使用模板）。

---

## Notes for maintainers / 维护者备注

- 正文只写「用户下载页」信息；工程任务编号、内部里程碑等放入正文末尾的折叠区或省略。
- 发布前核对：`release-manifest.json` 的 `sourceCommit`、`checksums.sha256`、`policy:scan --release --strict` 通过。
- 签名状态按实际如实声明（未签名 → SmartScreen 提示），不得虚构。
