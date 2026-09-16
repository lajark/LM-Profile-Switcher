# Distribution Channels — Drafts & Go/No-Go (M5-008) / 分发渠道草案与放行清单

> 当前授权（2026-09-16）：执行 Windows x86_64 v0.2.3-beta.1 的 GitHub/Gitee 代码与 Tag 发布，以及 GitHub Release 元数据；macOS 从本轮范围移除。\n\n> 只提供**草稿**与**检查流程/放行清单**。**不发起任何提交**：在获得授权并完成**签名 + 公证/稳定**发布之前，不得向 Winget / Homebrew / 任何远端渠道 submit。远端不会创建 Issue/PR/Tag/包/Release，除非用户显式授权。

## 1. Submit Go/No-Go checklist（渠道提交放行清单）
- [ ] 版本源：`tauri.conf.json` 单一版本源，`release-manifest.json` 的 `sourceCommit` 可溯源到提交。
- [ ] artifact 完整：installer + `checksums.sha256` + `release-manifest.json` + SBOM + licenses + notices + release notes（`release-pack` 允许清单、无 stray）。
- [ ] `check` 与 `coverage:ratchet` 与 `policy:scan --strict` 通过。
- [ ] **Windows installer 已签名**（Authenticode，非 unsiged）；macOS 已公证。
- [ ] 稳定版（非 pre-release）由维护者显式授权；社区 PR 不触发 Release。
- [ ] 用户明确授权该渠道提交；提交前记录 expected 包路径、hash、manifest。
- [ ] 失败管理：任一允许清单产物缺失或任一 gate 失败 → **不发布部分包**（无 partial public Release）。

## 2. Winget 草稿（DRAFT, hold）
参考格式（Microsoft Store 前端 winget-pkgs 清单思路，仅草案；提交前需权威 schema 校验）：
```yaml
Id: Lajark.LMProfileSwitcher
Name: LM Profile Switcher
Version: 0.2.0-beta.1        # 占位；稳定版方可用于提交
Publisher: LM Profile Switcher
InstallerType: nullsoft
License: MIT
LicenseUrl: https://github.com/lajark/LM-Profile-Switcher/LICENSE
AppMoniker: lmps
Tags: [lm-studio, gpu, profile]
Installers:
  - Architecture: x64
    InstallerUrl: <仓内或授权托管 URL 占位>
    InstallerSha256: <来自 checksums.sha256 的 GitHub 分发值，占位>
```
**检查流程**：用 `winget validate` / winget-pkgs 校验器校验 manifest（需提交前在对应工具链可用时执行）；在满足「1. Go/No-Go」前不执行。

## 3. Homebrew 草稿（DRAFT, hold）
参考公式思路（Ruby，仅草案）：
```ruby
class LmProfileSwitcher < Formula
  desc "Independent local-first profile switcher for LM Studio"
  homepage "https://github.com/lajark/LM-Profile-Switcher"
  version "0.2.0-beta.1" # 占位；稳定版方可用于提交
  license "MIT"
  on_macos do
    if Hardware::CPU.arm?
      url "<macOS arm64 tarball URL 占位>"
      sha256 "<占位>"
    else
      url "<macOS x86_64 tarball URL 占位>"
      sha256 "<占位>"
    end
  end
  # 提交前需 macOS 双架构真实产物 + 公证 + Homebrew 安装/卸载自检
end
```
**检查流程**：`brew audit`、`brew install --build-from-source`、卸载自检（需 macOS 工具链与双架构产物，M5-006 blocked 阶段不可执行）。

## 4. 已验证 README 链接
- CI badge 已置于 `README` / `README.zh-CN`（`.github/workflows/ci.yml`）；发布流程 `.github/workflows/release.yml`（Draft/prerelease）与贡献入口 `CONTRIBUTING.md` 已链接。
- 结构：`Contributing` 链接（英文 + 简体中文入口）。

## 5. 限制（如实）
- 未执行任何渠道提交；未验证 `winget validate`/`brew audit`（无对应工具链 / 无 macOS / 无签名公证产物）。
- Winget/Homebrew 草稿为占位，路径与 sha 为占位值；稳定签名版方可填充与提交（以 1. go/no-go 为前提）。
- 未创建远端 Issue/PR/Tag/Release/包。

## 6. Community & discoverability strategy (M6-006, P2) / 社区与可发现性策略

> 策略与节奏说明。**不建立任何社群账号、不创建 Discord/QQ 群、不发布任何帖子**；实际发帖/提交/远端元数据均需单独授权。

### 6.1 定位与渠道优先级
- 定位：贡献「本地大模型配置问题」的解决方案，而不是投放广告（禁止“AI 神器/最强优化”等无法验证的措辞）。
- 第一优先级：**Reddit / r/LocalLLaMA**（问题型标题，正文 = 问题 → 实测硬件 → 解决方式 → Benchmark → 截图 → 末尾附 GitHub）。
- 第二优先级：**V2EX / 知乎 / 掘金 / 少数派** 中选择 1–2 个（主题如「16GB 显存如何管理不同本地大模型配置」，而非「我发布了一个开源项目」）。

### 6.2 内容三型复用（同一素材三种写法）
| 类型 | 示例 | 用途 |
|---|---|---|
| 问题型 | 不同模型 Profile 怎么管理 | 引流与搜索 |
| 实验型（最高优先） | RTX 5060 Ti 16GB：Qwen 9B/27B/35B 实测配置与表现 | 可信资产 |
| Release 型 | vX 发布：解决什么 / 3 个核心功能 / 已知限制 / 下载 | 转化 |

### 6.3 观察指标（不看 Star 数）
GitHub Unique Visitors、Clones、Release Downloads、Issue/PR 质量、Returning users、Star。健康形态：访问量不大但 Clone/Download/Issue 比例较高。

### 6.4 每版本维护节奏（未来 2–3 个月主维护对象）
每个重要版本只额外做三件事：更新 Release（用 `docs/RELEASE_DOWNLOAD_TEMPLATE.md`）、更新一组真机 Benchmark（`docs/BENCHMARKS.md`）、把同一内容改写成中/英各 1 个帖子。不维护大量平台账号。

### 6.5 明确不做
买流量、刷 Star、群发链接、同一内容机械复制到十几个平台、提前建 Discord/QQ 群、为曝光堆无关功能。

### 6.6 首次访问转化（README 侧已落地）
README 首屏 = 一句话定位 → Hero 截图 → Windows 下载 → 为什么有用 → 怎么工作 → 实测摘要 → 隐私 → 工程可信度后移；完整实测在 `docs/BENCHMARKS.md`。远端 About Description / Topics / Social Preview 上传属待授权元数据，见 `docs/tasks/M6-006-completion.md`。
