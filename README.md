# LM Profile Switcher

**Bootstrap workspace · 0.1.0**

[简体中文](README.zh-CN.md) | [English](README.en.md)

LM Profile Switcher is an independent, unofficial community tool for managing local LM Studio model profiles. It is not affiliated with or endorsed by LM Studio.

The repository is currently at the bootstrap stage. Product behavior is added one atomic task at a time from `TASKS.md`.

## Development

Requirements: Node.js 20 or newer and pnpm 10.15.0 (Corepack is supported).

```text
corepack pnpm install
corepack pnpm run check
```

`check` runs the repository lint, typecheck, unit tests, and TypeScript build. No LM Studio connection or model download is required for the bootstrap checks.

The desktop GUI is a React/Web GUI hosted by a thin Tauri 2 shell. The final release target includes both a Windows installer and an installable macOS distribution. The project is MIT-licensed; see `LICENSE`.

Recommended reading order:

1. `AGENTS.md`
2. `PROJECT_DISTRIBUTION_POLICY.md`
3. `docs/PRD.zh-CN.md` or `docs/PRD.en.md`
4. `TASKS.md`
5. `docs/IMPLEMENTATION_PLAN.md`
6. `docs/ARCHITECTURE.md`
7. `docs/OPEN_SOURCE_REUSE_POLICY.md`
8. `docs/TRACEABILITY_MATRIX.md`

> LM Profile Switcher is an independent, unofficial community tool. It is not affiliated with or endorsed by LM Studio.
