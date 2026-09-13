# Pull Request / 拉取请求

> Thanks for contributing! 感谢贡献！请逐项核对（不适用则注明 `not_applicable`）。

## Summary / 摘要

- **Why / 为什么**（problem + intended behavior，不要只写 diff）：

- **What changed / 改了什么**：

## Checklist / 检查清单

- [ ] One logical task per PR；未做范围外重构（unrelated refactor）
- [ ] 中英双语资源同步（zh-CN + en，无硬编码用户可见字符串）
- [ ] 已覆盖正常 / 边界 / 主要失败路径的测试
- [ ] 实际运行并记录结果（未运行的检查明确标注 `not_run`）：
  - [ ] `corepack pnpm run lint`
  - [ ] `corepack pnpm run typecheck`
  - [ ] `corepack pnpm run i18n:check`
  - [ ] `corepack pnpm run check`
  - [ ] `corepack pnpm run policy:scan`（0 blockers）
  - [ ] 其他相关验证（E2E / 真机 / 截图）：
- [ ] 文档/Schema/追踪矩阵/来源台账按需更新；无 Secret、Token、私有路径入库
- [ ] 未引入范围外依赖（新依赖须说明影响与许可证）

## Evidence / 证据

（命令输出、截图、LOCAL-ONLY 记录位置；不得伪造结果）

## Known limits / 已知限制

## Notes for reviewer / 给审阅者的说明
