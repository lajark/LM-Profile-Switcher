# LM Profile Switcher 0.2.3-beta.1 (Windows x86_64) — Release Notes / 发布说明

- Status / 状态: **Windows x86_64 预发布（UNSIGNED）**。
- Target / 目标: Windows x86_64, NSIS currentUser installer（开发/预发布构建）。
- Source commit / 来源提交: 见 release-manifest.json 的 sourceCommit。
- Signing / 签名: 无代码签名证书，安装包为 **unsigned**；Windows SmartScreen 可能显示警告。
- Platform scope / 平台范围: 本轮优化仅发布 Windows x86_64；macOS arm64/x86_64 已从本轮构建、签名、公证和真机验收范围移除，历史阻塞记录保留。

## What changed / 变化

- **模型优先桌面流程**：按模型查看上下文、场景和 Profile，支持安全默认启动、优化准备、取消、失败禁用保存和激活失败回滚。
- **应用图标族**：以原创 Sliding Models SVG 为唯一生产源，生成 16/20/24/32/48/64/128/256 像素应用资源及浅色/深色托盘资源，并接入窗口、任务栏、快捷方式、安装器与卸载器。
- **双语展示素材**：加入模型列表、Benchmark 与离线 Mock 工作流预览，明确区分本机 LM Studio 只读画面和 Mock 夹具数值。
- **状态文案**：桌面服务连接状态明确标注为“桌面服务已连接”，避免与 LM Studio 状态混淆。

## Verification / 验证

- 综合检查 exit 0：107 个测试文件，1195 passed / 1 skipped；lint、typecheck、i18n、构建、17 个领域 Schema、合规 567 个依赖均通过。
- 图标资源检查 exit 0：SVG 派生资源字节一致，24 PNG 与 ICO 八尺寸均通过 Windows 原生读取和透明边缘检查；release:pack 暂存树 policy-scan --release --strict PASS。
- 真实 LM Studio GUI 的安全启动、加载、Profile 切换和安全基线切回已验证；失败注入/回滚仍未执行。

## Installation / 安装

- 运行 LM Profile Switcher_0.2.3-beta.1_x64-setup.exe（当前用户安装，NSIS；未签名）。
- 使用随包 checksums.sha256 校验文件；release-manifest.json、SBOM、依赖许可证、第三方声明与本说明一并提供。

## Known limitations / 已知限制

- 本轮不提供 macOS 制品；macOS 构建、签名、公证与真机安装留待后续恢复条件满足后单独处理。
- Gitee 镜像源码与 tag；Release 制品按分发政策在 GitHub 提供。
- 真实激活事务的故障注入/回滚 GUI 验收仍待执行。
- 无自动更新；main 为唯一代码主线。