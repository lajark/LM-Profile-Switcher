# CLI Specification / CLI 规范

> 状态：M1-004/M1-005 已实现；M1-003 读路径已接线。`profile/hardware/lang/doctor` 为完整契约；`models/current/snapshot` 已接线到 LM Studio adapter（REST v1 主路径，`lms` 读回退），离线/认证/超时 → `LM_UNREACHABLE` exit 4；`apply <id> [--yes]` 为完整命令，生产 `activation` 端口已随 M1-005 生产接线接通（默认 `auto`，离线 exit 4，`LMPS_ADAPTER=mock` 显式演示）；`optimize <id> [--yes]` 已随 M2-002 实现并完成生产接线。`estimate/benchmark/server/backup` 与 `--version` 尚未实现。

Command: `lmps`（`corepack pnpm run lmps -- <args>`，先 `build`；或 `node apps/cli/dist/index.js <args>`）

## Data root and environment

- 数据根目录：`LMPS_HOME` 环境变量，缺省为 `<home>/.lmps`。含 profile 存储（`profiles/`、`backups/`）与语言配置 `config.json`。
- `~/.lmps` 可能收纳 passthrough 机密，属 LOCAL-ONLY；`doctor --bundle` 对诊断对象先经脱敏。
- 语言解析顺序：`--lang` → `config.json` 持久化值 → 系统环境（`LMPS_LANG`/`LC_ALL`/`LC_MESSAGES`/`LANG`/`LANGUAGE`）→ 默认 `en`。`zh` 归一化为 `zh-CN`，`en-*` 归一化为 `en`，不支持的语言回退英文。
- LM Studio 适配环境（M1-003 读路径接线后生效）：
  - `LMPS_LM_URL`：LM Studio REST 服务基址，缺省 `http://127.0.0.1:1234`。
  - `LMPS_LM_TOKEN`：REST Bearer Token（可选；SECRET 分类，绝不落输出/日志）。
  - `LMPS_LMS_BIN`：`lms` 可执行路径/命令名，缺省 `lms`。
- 每个命令惰性探测一次能力并缓存（adapter TTL 300s）；REST 不可达但 `lms` 可用时，`models` 回退 CLI 读取，`current/snapshot` 诚实报 `LM_UNREACHABLE`（写路径仍要求 REST）。

## Global flags

- `--json`：机器可读输出（见「Machine envelope」）。人类错误与 `--verbose` 诊断只写 stderr；`--json` 模式 stderr 默认为空。
- `--lang <zh-CN|en>`：覆盖语言（可出现在任意位置，含 `--lang=zh-CN` 形式）。
- `--verbose`：仅人类模式向 stderr 追加一条 `lmps: <command> · <locale> · <ms>ms` 诊断；机器模式忽略。
- `--no-color`：接受并忽略——输出本身无 ANSI 颜色。
- `--timeout <ms>`：对 `apply` 作为激活状态机每阶段超时实际施加（M1-005）；`models/current/snapshot` 由 adapter 内建超时约束（REST HTTP 超时、`lms status` 10s、`lms ls` 30s）。

## Machine envelope （`--json`）

成功：

```json
{ "product": "lmps", "api": 1, "ok": true, "locale": "zh-CN", "command": "profile list", "data": { ... } }
```

失败：

```json
{ "product": "lmps", "api": 1, "ok": false, "locale": "en", "command": "models", "error": { "code": "LM_UNREACHABLE", "detail": "unreachable" } }
```

- 字段名与 `error.code`/`data` 值稳定且不本地化；人类文案永不进入信封。
- `command` 为命令名；`profile <sub>` 渲染为 `profile list` 这种完整标签。裸调用错误时 `command: null`。
- `error.code` 透传底层稳定码：`USAGE`、`CAPABILITY_UNSUPPORTED`、`LM_UNREACHABLE`、`INTERNAL`、`LOCALE_*`、`STORE_*`、`DOMAIN_*`；未知错误折叠为 `INTERNAL`，detail 不泄露路径/Token。
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

真机探测（复用 `@lmps/hardware` 的注入 `ProbeEnv`）；人类输出为双语摘要；`--json` 输出完整 `HardwareProfile`。永不 throw（各节降级为 `null`）。卷富化（M1-001 补测，schema v2）：外接盘追加 `（外接）/ (external)` 标记（`hardware.volumeExternal`）——`DriveType=2` 或配对到 USB/`USBSTOR`/`External hard disk media` 证据的 `DriveType=3` 卷；`--json` 中体现为 `volumes[*].external/bus/driveType/model`，富化缺失时这些列为 `null`。

### lang

`lmps lang` 显示当前；`lmps lang zh-CN|en` 切换并持久化到 `<rootDir>/config.json`；非法语言 → exit 4。机器 `data`: `{ locale }`。

### doctor

检查：store 可用与 `recover()` 结果、config 可读写、locale 资源、Node 版本、discovery 接线状态（未接线 → warn）、hardware 探测快照。检查项执行完退出 **0**（fail 只体现在 `--json` 的 `summary.ok`）；仅「初始化和 i18n/store 不可创建」→ exit 10。`--bundle` 追加 `data.diagnostics`（经脱敏，LOCAL-ONLY）。

### models / current / snapshot（M1-003 接线）

数据源为 adapter 路由（能力探针 → REST v1 优先；REST 不可达且 `lms` 可用时 `models` 回退 CLI 读取；SDK 未安装，不参与读路径）。REST/CLI 不可达、认证失败或超时 → 人类 `error.lmUnreachable`、机器 `LM_UNREACHABLE`、exit **4**；REST 报告的已加载模型通过 store 反查回填 profileId。

数据形状：`models`: `{models:[{key,family,quantization,parametersB}]}`；`current`: `{active:{profileId,modelKey,since}}`；`snapshot`: `{snapshot:{profileId,at,captured}}`。`since` 仅在宿主编排提供时非空（REST v1 当前为 `null`）。

### apply（M1-005）

`lmps apply <id> [--yes]`：对已存储 Profile 执行激活事务（跨入口全局锁、验证、估算、卸载冲突、加载、健康检查、回滚/恢复）。目标与当前激活不同（或无激活）时必须显式 `--yes`（无提示不切换模型）；同目标走幂等路径无需确认。`--timeout` 作为每阶段超时实际施加。

机器 `data`：`{ transaction: <redacted> }`；人类输出为双语结果文案（active/idempotent/canceled/recovered/failed）。退出码 0=active、2=canceled、3=failed-but-recovered、5=failed；lock busy/激活前置失败 → 4（preflight）。

生产 `activation` 端口已随 M1-005 生产接线接通（2026-09-05）：`apply` 走真实激活状态机；适配器因惰性解析并按 seam 生命周期缓存，确保 preflight 与各阶段看到同一宿主视图；互斥经 `<LMPS_HOME>/locks/activation.lock` 文件租约锁（owner=`process.pid`、30 分钟租约，运行结束释放）；事务日志（runner 已脱敏）落盘 `<LMPS_HOME>/logs/transactions.ndjson`。默认 `auto`——未显式设置 `LMPS_ADAPTER=mock` 时绝不静默使用演示适配器；离线/认证/超时 → `LM_UNREACHABLE` exit 4（中文 `无法连接到 LM Studio`）。

### optimize（M2-002）

`lmps optimize <id> [--yes]`：对已存储基线 Profile 运行候选优化（PRD FR-07）——按 `task.kind` 匹配规则（种子目录缺省），硬约束过滤 → 3–6 候选 → 官方 estimate → VRAM 安全余量（exact 且余量 ≥ 0 才 safe）→ 静态评分排序 → 字段级 diff 与双语理由。**不加载模型**（激活走 `apply`），**不自动激活**。

- 无 `--yes`：仅展示候选（分数/置信度/显存余量/字段 diff）与 warnings；`selectedIndex === null` 时输出 `noSafeCandidate`（人类）或空 `candidates`（机器），**exit 0**——读到空推荐同样是成功读取。
- `--yes`：保存头号候选为新 Profile（`validation.source = 'rule-recommended'`、`testedAt = now`；id = `<基线id>-<规则包版本>`）并追加审计到 `<LMPS_HOME>/logs/optimizations.ndjson`；**不激活**。拒绝条件（均 exit 4）：
  - `selectedIndex` 为 null（无安全候选）；
  - 头号候选 `score.confidence !== 'high'`（估算非实测——rough/service 降级或能力未证实均拒）。
- 可信度：`confidence='high'` 仅当 estimate `exact` + 安全余量 safe + 无 `unknown` 能力降级；`rough` 估算永不安全（`unsafe-drop:rough-estimate`），保证「低置信永不静默保存」。
- 机器 `data`：默认 `{ recommendation }`；`--yes` 保存后为 `{ recommendation, savedProfileId }`，`recommendation` 即 domain `Recommendation` 契约（`Candidate`/`Recommendation` JSON Schema 见 `schemas/`）。
- 接线（M2-002）：capability 经 adapter 探针选操作能力最完整的 matrix（回退 REST），estimate 复用 `apply` 的官方估算端口（不可达降级 `rough` → 安全余量自然拒绝），hardware 复用 `lmps hardware` 同源探针。

## Exit codes

| Code | Meaning | 使用 |
|---:|---|---|
| 0 | success | 全部成功路径；doctor 检查完成（含 `summary.ok=false`） |
| 2 | user cancelled | `apply` 取消路径（`ACTIVATION_CANCELED`；M1-005 生效） |
| 3 | activation in progress | `apply` 事务在恢复路径上完成（failed-but-recovered；M1-005 生效） |
| 4 | validation or preflight failed | 参数/校验/Profile 不存在/文档校验失败/delete 无 `--yes`/未知命令/lock busy/激活前置失败/LM Studio 不可达（`LM_UNREACHABLE`） |
| 5 | activation and rollback both failed | `apply` 事务失败且回滚也失败（M1-005 生效） |
| 6 | requested capability unsupported | 尚未实现的能力（`estimate/benchmark/server` 等）；`apply`/`models`/`current`/`snapshot`/`optimize` 已接线，不再返回 6 |
| 10 | internal error | store 损坏/IO 失败/未捕获异常/资源错误 |

## Output stream isolation

- stdout：人类成功文本，或 `--json` 信封（含错误信封）。
- stderr：人类错误与应用诊断；`--json` 模式默认为空。
- 无 ANSI 颜色；`--no-color` 仅为兼容接受。
- 人类文本 100% 来自 i18n key（`zh-CN`/`en` 双语同步）；机器 JSON 不本地化。

## 未实现 / 预留

`estimate/benchmark/server/backup`、`--version`、Shell completion、交互向导均未实现；`apply` 已随 M1-005 实现并完成生产接线（2026-09-05，离线态已实测），`optimize` 已随 M2-002 实现并完成生产接线；`estimate` 等命令在后续任务接线。