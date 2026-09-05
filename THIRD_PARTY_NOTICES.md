# Third-Party Notices / 第三方软件声明

## Current status

This repository does **not** incorporate source code from the evaluated community applications. The projects below are candidates for design reference or future selective ports only.

当前仓库**未纳入**下列社区应用的源代码。它们仅作为设计参考或未来选择性移植候选。

## Dependency notices

The installed pnpm dependency graph is scanned from package metadata. Generate the release-ready dependency inventory and notices with:

```text
corepack pnpm run compliance
```

This writes ignored, generated artifacts under `reports/`: `dependency-licenses.json`, `sbom.cdx.json` (CycloneDX 1.5), and `THIRD_PARTY_NOTICES.generated.md`. The generated files are not hand-edited and should be included in release artifacts by the release workflow.

依赖许可证清单、CycloneDX SBOM 和生成式第三方声明由已安装的 pnpm 依赖图生成，不手工猜测。运行 `corepack pnpm run compliance` 可生成发布产物；生成文件位于被忽略的 `reports/` 目录，由发布流程打包。

## Evaluated projects

- `farion1231/cc-switch` — Web GUI layout/interaction, tray and configuration-management patterns; public repository `LICENSE` reviewed as MIT on 2026-08-21, but no source or assets are incorporated
- `raketenkater/ggrun` — hardware fit, safety headroom, bounded tuning, recovery
- `ghaffaria/lmstudio-config-wizard` — hardware/task wizard and baseline recommendation ideas
- `LM-Client/client-universal` — documented LM Studio REST integration patterns
- `lmstudio-ai/configs` — historical configuration-format reference

Before any code is incorporated, the exact commit, file-level notices, license text, local mapping, and modifications must be added to `docs/PROVENANCE.yml` and this document.

The implementation is expected to use the official LM Studio SDK and general-purpose software packages. Actual dependency notices must be generated from the implemented lockfile, not guessed in advance.
