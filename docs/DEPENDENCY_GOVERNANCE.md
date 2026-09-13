# Dependency Governance / 依赖治理（M6-005）

> 本文档是依赖与供应链治理的单一事实来源：直接依赖锁定策略、本次锁定记录、已安装树重复版本理由，以及 Dependabot/CI 门禁。基线数据由 `corepack pnpm run audit:deps` 生成。

## 1. 直接依赖锁定策略

- **直接 registry 依赖一律写精确版本**（`"esbuild": "0.25.12"`，不使用 `^`/`~`/`@2`）；`workspace:*` 仅用于 workspace 内部包；禁止通配符。
- 精确版本以**锁定解析版本**为准：先安装、解析、运行验证，再按 `pnpm-lock.yaml` 实际解析结果回填，避免「锁了但从未解析过」的假精确。
- 依赖更新由 Dependabot 以 PR 驱动（见第 4 节），合并前必须通过 CI 全部门禁；**任何依赖更新不得绕过回滚证据或引入未审查的运行时依赖**。

## 2. 本次锁定记录（M6-005，2026-09-13）

审计基线从 **55 specs（21 pinned / 22 workspace / 12 range / 0 wildcard）** 收敛为 **55 specs（33 pinned / 22 workspace / 0 range / 0 wildcard）**。

| 包 | 原 spec | 锁定版本 | 位置/用途 | 分类 |
|---|---|---|---|---|
| `@types/node` | `^26.2.0` | `26.2.0` | 根 dev | registry |
| `esbuild` | `^0.25.2` | `0.25.12` | `apps/core-service` dev（SEA 打包） | registry |
| `postject` | `^1.0.0-alpha.6` | `1.0.0-alpha.6` | `apps/core-service` dev（SEA 注入） | registry |
| `@tauri-apps/api` | `2` | `2.11.1` | `apps/desktop` **prod** | registry |
| `react` | `^19.0.0` | `19.2.8` | `apps/desktop` **prod** | registry |
| `react-dom` | `^19.0.0` | `19.2.8` | `apps/desktop` **prod** | registry |
| `@tauri-apps/cli` | `2` | `2.11.4` | `apps/desktop` dev | registry |
| `@types/react` | `^19.0.0` | `19.2.18` | `apps/desktop` dev | registry |
| `@types/react-dom` | `^19.0.0` | `19.2.7` | `apps/desktop` dev | registry |
| `@vitejs/plugin-react` | `^4.3.4` | `4.7.0` | `apps/desktop` dev | registry |
| `vite` | `^6.0.0` | `6.4.3` | `apps/desktop` dev | registry |
| `@types/node` | `^26.2.0` | `26.2.0` | `apps/desktop-e2e` dev | registry |

严格门禁：`corepack pnpm run audit:deps:strict` 在任一直接 registry 依赖为 range/wildcard 时失败（exit 1）。CI 已接入该步骤（`Strict dependency audit (M6-005)`）。

## 3. 已安装树重复版本理由

`audit:deps` 报告的 **54 组重复版本全部为传递依赖**；直接依赖无重复。按成因归类如下（不在文档中逐一复述版本号，以 `audit:deps --json` 输出为准）：

### 3.1 工具链双版本（SEA 打包 vs 前端工具链）
- `esbuild` / `@esbuild/win32-x64`：`apps/core-service` 的 SEA 打包固定 `0.25.12`；前端工具链（vite 6.4.3 等）解析到 `0.28.2`。两条链路互不混用，统一需要跨包升级或 pnpm override，属于不必要风险。

### 3.2 直接依赖主版本分裂（direct 持有新主版本）
- `zod`：直接依赖 `4.4.3`；`3.25.76` 来自某个仍声明 `^3` 的传递消费者。直接依赖不得降级；传递侧由上游自行升级。
- `@vitest/pretty-format` / `@vitest/snapshot`：直接 `4.1.11`；`2.1.9` 来自较旧传递消费者。
- `react-is`：`18.3.1`（旧传递）与 `19.3.0`（react 19 生态）共存。
- `commander`：`14.0.3` 与 `9.5.0` 分别由不同工具链消费者声明。

### 3.3 WebDriverIO 测试栈传递依赖（仅 `apps/desktop-e2e`，不进入任何产品/发布）
- `chalk`、`minimatch`、`semver`、`string-width`、`wrap-ansi`、`strip-ansi`、`yocto-queue`、`diff`、`decamelize`、`get-stream`、`hosted-git-info`、`is-stream`、`undici`/`undici-types`、`type-fest`、`tinyrainbow` 等大量小工具的双版本由 WDIO 9.x 与其插件的内部依赖区间决定。该包为 `private`，不入构建产物、不入 release。

### 3.4 常见工具类主版本区间（传递侧强制，不做强制去重）
- `ansi-regex`、`ansi-styles`、`brace-expansion`、`balanced-match`、`buffer-crc32`、`emoji-regex`、`entities`、`escape-string-regexp`、`eslint-visitor-keys`、`fast-deep-equal`、`find-up`/`locate-path`/`path-exists`/`p-limit`/`p-locate`、`iconv-lite`、`ignore`、`is-plain-obj`、`is-unicode-supported`、`isexe`、`js-tokens`、`lru-cache`、`normalize-package-data`、`path-key`、`pathe`、`readable-stream`、`safe-buffer`、`string_decoder`、`supports-color`、`which` 等。
- 这些包分别被不同主版本的直接依赖声明为 `^X`，pnpm 按语义正确解析出并存版本。**不引入 pnpm `overrides` 强制去重**：overrides 会绕过上游区间语义，可能破坏运行时兼容性；仅当出现安全公告或真实兼容故障时才评估，且必须走「影响说明 + 回滚方案 + 验证」流程。

## 4. Dependabot 配置（`.github/dependabot.yml`）

- 三个生态周更：`npm`（pnpm lockfile，根目录）、`cargo`（`/apps/desktop/src-tauri`）、`github-actions`（根目录）。
- **patch/minor 分组**为一个 PR；**major 更新不匹配 patch-and-minor 组，单独开 PR**；每生态 **最多 3 个开放 PR**。
- **不配置自动合并**（无 auto-merge workflow、无 `@dependabot merge`）；每次更新 PR 必须通过 CI（含 `check`、coverage ratchet、policy scan、strict 依赖审计）后人工合并。
- GitHub Actions 以完整 commit SHA 固定，Dependabot 在发布新版时原地改写 SHA。

## 5. 验证方式

- `corepack pnpm run audit:deps` — 分类统计 + 重复版本报告。
- `corepack pnpm run audit:deps:strict` — CI 门禁；任一直接 registry 依赖未精确锁定即失败。
- `corepack pnpm install --frozen-lockfile` — lockfile 与 manifest 一致性（CI 同款）。
- `corepack pnpm run compliance` — 许可证扫描、Provenance、SBOM、第三方声明与清单一致。
- 本文件第 3 节依赖 `audit:deps --json` 基线；基线快照为 LOCAL-ONLY（`.workspace/audit-baseline.json`）。
