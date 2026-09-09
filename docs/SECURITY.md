# Security and Privacy / 安全与隐私

## Defaults

- local-only;
- no telemetry;
- loopback-only services;
- explicit model downloads;
- no arbitrary shell from profiles;
- no private LM Studio file access;
- secrets in OS credential storage;
- redacted logs and diagnostics.

## Threats to cover

1. malicious imported profile;
2. path traversal and oversized files;
3. local-hook unauthorized access;
4. sidecar spoofing;
5. concurrent activation races;
6. command injection in CLI arguments;
7. accidental secret or prompt logging;
8. corrupted profile or migration;
9. compromised update channel;
10. unsafe automatic resource use.

## Required controls

- JSON Schema and size limits;
- path canonicalization;
- typed process invocation without shell interpolation;
- random per-session IPC token;
- global activation lock;
- atomic writes and backups;
- structured redaction;
- signed releases when distribution begins;
- dependency and SBOM scanning;
- policy/secret scanning before the first remote push (implemented M3-004: `corepack pnpm run policy:scan`, CI gate `--strict`; remote run verifies on first push);
- allowlist-based release assembly with manifest and checksums (implemented M3-004: `release-pack` is the only write path into `artifacts/releases/`);
- user confirmation for destructive or network actions.

## Incident handling

`lmps doctor --bundle` must preview and redact diagnostic content before export. Security reports must have a documented private channel before public release. Repository, artifact, and release disclosure incidents follow `PROJECT_DISTRIBUTION_POLICY.md`.
