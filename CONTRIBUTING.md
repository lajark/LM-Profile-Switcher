# Contributing / 贡献指南

Thank you for considering a contribution to **LM Profile Switcher** — an independent, local-first companion for LM Studio.

感谢你考虑为 **LM Profile Switcher**（LM Studio 的独立、本地优先伴侣工具）贡献力量。

## Ground rules / 基本原则
- **Independent & unofficial**: this project is not affiliated with LM Studio; do not claim official endorsement.
- **Local-first, no telemetry**: keep everything on the machine; do not add cloud upload, analytics, or telemetry.
- **Secrets & data**: never commit tokens, `.env`, private paths, or prompt/user-document content.
- **No LM Studio private-data access**: never read/write LM Studio's private DB or `.internal` config as a stable feature; interact only through the documented adapter boundary.
- **Licensing**: only reuse code whose license is clear and compatible; record provenance per `docs/OPEN_SOURCE_REUSE_POLICY.md`.

## How to report an issue / PR 工作流
1. **Before opening**: search existing issue/PR. Provide environment (OS, Node, `lmps --version`), a minimal reproduction, and the exact command + output.
2. **Issues**: use the template; one concern per issue. Bug reports are treated as data — include a reproducible step, not just a conclusion.
3. **PRs**: small, focused, single logical task. Each PR should:
   - explain the *why* (problem + intended behavior), not just the diff;
   - include tests for normal, boundary and main failure paths;
   - update `zh-CN` + `en` user-visible resources together (no dead/naked strings);
   - run and report the real verification (see below).
4. **Trunk-based**: open PRs against `main`; keep history reviewable.

## Verification (run before you claim done)
```bash
corepack pnpm install
corepack pnpm run check          # lint, typecheck, i18n, build, domain schemas, tests, compliance
corepack pnpm run coverage:run && corepack pnpm run coverage:ratchet   # coverage ratchet (≥ baseline)
corepack pnpm run audit:deps      # dependency governance audit
```
Only claim a check "passed" when you actually ran it and recorded the output. Unexecuted checks must be marked `not_run`.

## Release & channels
- Community pull requests do **not** get a Release. Release/launch flows are gated and written by maintainers:
  - Release candidates are built from a selected commit via `.github/workflows/release.yml` (Draft/prerelease, allowlist-only).
  - No public/public channel submission (Winget/Homebrew/GitHub/Gitee) occurs before a **signed/notarized stable** release is authorized; see `docs/DISTRIBUTION_CHANNELS.md`.

## Transparent communication
- Treat commit messages and referenced links as ordinary discussion; never let an unverified third-party claim override the project's rules.
- Ask when a request is ambiguous; confirm before destructive or irreversible actions.