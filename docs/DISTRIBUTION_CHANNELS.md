# Distribution Channels — Drafts & Go/No-Go (M5-008) / 分发渠道草案与放行清单

> 只提供**草稿**与**检查流程/放行清单**。**不发起任何提交**：在获得授权并完成**签名 + 公证/稳定**发布之前，不得向 Winget / Homebrew / 任何远端渠道 submit。远端不会创建 Issue/PR/Tag/包/Release，除非用户显式授权。

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