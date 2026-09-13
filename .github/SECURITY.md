# Security Policy / 安全策略

LM Profile Switcher 是独立、本地优先的 LM Studio 伴侣工具。完整威胁模型与安全控制见
[`docs/SECURITY.md`](docs/SECURITY.md)。

LM Profile Switcher is an independent, local-first companion for LM Studio.
The full threat model and security controls live in
[`docs/SECURITY.md`](docs/SECURITY.md).

## Reporting a vulnerability / 报告漏洞

- **请勿在公开 Issue 中披露漏洞细节**（不要粘贴 token、密钥或私有路径）。
- 请通过 GitHub 的**私有漏洞报告**（Repository → Settings → Security →
  Private vulnerability reporting）或邮件联系维护者。
- Please do **not** disclose vulnerability details in a public issue (no
  tokens, secrets or private paths). Use GitHub **private vulnerability
  reporting** instead.

## What is in scope / 范围

- 本地 IPC / Sidecar 认证与机密处理（token、`LMPS_LM_TOKEN`、会话凭据）
- 文件存储原子性、路径穿越、导入安全（`profile-store`、`policy:scan`）
- Hook / OpenAI 兼容代理的认证、回环绑定与越权
- 激活事务的锁、回滚与崩溃残留处理
- 发布供应链：SBOM、Provenance、许可、`checksums.sha256`、Dependabot 更新

## Supported versions / 受支持版本

- 仅维护最新发布版本及其 Pre-release 候选；历史版本仅作证据保留。
- Only the latest release (and its pre-release candidates) is maintained;
  historical versions are kept as evidence only.

## Security tests / 已有安全验证

见 [`docs/SECURITY.md`](docs/SECURITY.md) 与 `docs/tasks/M3-004-privacy-security-review.md`：
日志脱敏、回环绑定、最小权限、无遥测、无云账号、SEA 单文件打包、IPC 常量时间比较。
