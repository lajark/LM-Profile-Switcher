# CLI Specification / CLI 规范

> 状态：M1-004 已实现（2026-08-22）。`profile/hardware/lang/doctor` 为完整契约；`models/current/snapshot` 的数据源是注入 seam，未接线时诚实返回 `CAPABILITY_UNSUPPORTED`（exit 6），由 M1-003/005 接线。`apply/estimate/optimize/benchmark/server/backup` 与 `--version` 尚未实现。

Command: `lmps`（`corepack pnpm run lmps -- <args>`，先 `build`；或 `node apps/cli/dist/index.js <args>`）

## Data root and environment

- 数据根目录：`LMPS_HOME` 环境变量，缺省为 `<home>/.lmps`。含 profile 存储（`profiles/`、`backups/`）与语言配置 `config.json`。
- `~/.lmps` 可能收纳 passthrough 机密，属 LOCAL-ONLY；`doctor --bundle` 对诊断对象先经脱敏。
- 语言解析顺序：`--lang` → `config.json` 持久化值 → 系统环境（`LMPS_LANG`/`LC_ALL`/`LC_MESSAGES`/`LANG`/`LANGUAGE`）→ 默认 `en`。`zh` 归一化为 `zh-CN`，`en-*` 归一化为 `en`，不支持的语言回退英文。

## Global flags

- `--json`：机器可读输出（见「Machine envelope」）。人类错误与 `--verbose` 诊断只写 stderr；`--json` 模式 stderr 默认为空。
- `--lang <zh-CN|en>`：覆盖语言（可出现在任意位置，含 `--lang=zh-CN` 形式）。
- `--verbose`：仅人类模式向 stderr 追加一条 `lmps: <command> · <locale> · <ms>ms` 诊断；机器模式忽略。
- `--no-color`：接受并忽略——输出本身无 ANSI 颜色。
- `--timeout <ms>`：解析并接受、暂不施加（M1-003 discovery 接线后生效并记录于本规范）。

## Machine envelope （`--json`）

成功：

```json
{ "product": "lmps", "api": 1, "ok": true, "locale": "zh-CN", "command": "profile list", "data": { ... } }
```

失败：

```json
{ "product": "lmps", "api": 1, "ok": false, "locale": "en", "command": "models", "error": { "code": "CAPABILITY_UNSUPPORTED", "detail": "models" } }
```

- 字段名与 `error.code`/`data` 值稳定且不本地化；人类文案永不进入信封。
- `command` 为命令名；`profile <sub>` 渲染为 `profile list` 这种完整标签。裸调用错误时 `command: null`。
- `error.code` 透传底层稳定码：`USAGE`、`CAPABILITY_UNSUPPORTED`、`INTERNAL`、`LOCALE_*`、`STORE_*`、`DOMAIN_*`；未知错误折叠为 `INTERNAL`，detail 不泄露路径/Token。
- 例外（不受 `--json` 影响）：`profile export` 与 `profile edit`（无 `--patch`）把文档字面量本身写在 stdout——编辑模板照常输出首行模板文本但 `literal` 分支保留文档原样。

## Commands（M1-004 已实现）

### profile

```text
lmps profile list [--model <key>] [--task <type>]
lmps profile show <id>
lmps profile create --name <id> --file <json|yaml|yml|->
lmps profile edit <id> [--patch <json-file>]
lmps profile clone <source> <newId>
lmps profile delete <id> --yes
lmps profile import <file> [--allow-rename]
lmps profile export <id> [--format json|yaml] [-o <file>]
```

- `list` 稳定摘要：`{ id, displayName:{'zh-CN',en}, model:{modelKey,family}, task:{type}, updatedAt }`；`--model`/`--task` 过滤。
- `show`：人类三行摘要；`--json` 返回已脱敏完整文档（经 `store.exportJson` sanitize 路径）。
- `create`：`--name` 与文档 `id` 不一致即拒绝（不残留半应用）；默认拒绝重复 id；stdin 用 `--file -`（TTY 下拒绝以免挂死）。
- `edit --patch`：JSON 深合并补丁，`id` 不可变，`updatedAt` 自动盖；无 `--patch` 时把当前文档当模板输出。
- `delete`：必须 `--yes`（非交互安全）。
- `import`：按扩展名路由 JSON/YAML；id 碰撞默认拒绝，`--allow-rename` 生成 `-copy[-n]`。
- `export`：stdout 输出文档字面量（已脱敏）；`--format yaml` 输出 YAML；`-o` 写文件后输出人类确认文本。

机器 `data`：
- `list`: `{ count, profiles: [...] }`；`create`: `{ id }`；`edit`: `{ id, updatedAt }`；`clone`: `{ id }`；`delete`: `{ id }`；`import`: `{ id }`；`show`: `{ profile: <sanitized doc> }`；`export -o`: `{ path, format, sizeBytes }`。

### hardware

真机探测（复用 `@lmps/hardware` 的注入 `ProbeEnv`）；人类输出为双语摘要；`--json` 输出完整 `HardwareProfile`。永不 throw（各节降级为 `null`）。

### lang

`lmps lang` 显示当前；`lmps lang zh-CN|en` 切换并持久化到 `<rootDir>/config.json`；非法语言 → exit 4。机器 `data`: `{ locale }`。

### doctor

检查：store 可用与 `recover()` 结果、config 可读写、locale 资源、Node 版本、discovery 接线状态（未接线 → warn）、hardware 探测快照。检查项执行完退出 **0**（fail 只体现在 `--json` 的 `summary.ok`）；仅「初始化和 i18n/store 不可创建」→ exit 10。`--bundle` 追加 `data.diagnostics`（经脱敏，LOCAL-ONLY）。

### models / current / snapshot（seam）

数据源为注入 seam（`discovery`/`state`/`snapshot` 端口）。未接线 → 人类 `error.capabilityUnsupported`、机器 `CAPABILITY_UNSUPPORTED`、exit **6**。接线后由 M1-003/005 补充数据形状（`models`: `{models:[{key,family,quantization,parametersB}]}`；`current`: `{active:{profileId,modelKey,since}}`；`snapshot`: `{snapshot:{profileId,at,captured}}`）。

## Exit codes

| Code | Meaning | 使用 |
|---:|---|---|
| 0 | success | 全部成功路径；doctor 检查完成（含 `summary.ok=false`） |
| 2 | user cancelled | 预留（M1-005 取消路径） |
| 3 | activation in progress | 预留（M1-005 并发锁） |
| 4 | validation or preflight failed | 参数/校验/Profile 不存在/文档校验失败/delete 无 `--yes`/未知命令 |
| 5 | activation and rollback both failed | 预留（M1-005） |
| 6 | requested capability unsupported | `models/current/snapshot` 未接线；非法 locale 之外的能力缺失 |
| 10 | internal error | store 损坏/IO 失败/未捕获异常/资源错误 |

## Output stream isolation

- stdout：人类成功文本，或 `--json` 信封（含错误信封）。
- stderr：人类错误与应用诊断；`--json` 模式默认为空。
- 无 ANSI 颜色；`--no-color` 仅为兼容接受。
- 人类文本 100% 来自 i18n key（`zh-CN`/`en` 双语同步）；机器 JSON 不本地化。

## 未实现 / 预留

`apply/estimate/optimize/benchmark/server/backup`、`--version`、Shell completion、交互向导均未实现；`apply/estimate/optimize/benchmark/server/backup` 与 exit 2/3/5 在 M1-005 及后续接线。