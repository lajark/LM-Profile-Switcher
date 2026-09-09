// Policy/secret detection rules for the M3-004 release gate.
//
// Pure module: no Node builtins, no file I/O — unit-tested directly from
// tests/policy-scan.test.ts and driven by scripts/policy-scan.mjs
// (workspace scan) and scripts/release-pack.mjs (staging scan).
//
// Design constraints (see PROJECT_DISTRIBUTION_POLICY.md §4.2):
//   * high-signal shapes only — bare keywords like "password" appear in
//     regex literals (packages/core/src/redact.ts, profile-store/sanitize.ts)
//     and in `` Bearer ${token} `` template strings; those must NOT match;
//   * a finding must be actionable: {path, line, ruleId, severity, message}
//     with a fixed template — matched values are NEVER echoed.
//   * placeholders (example/dummy/change_me/test/xxx) are treated as
//     non-secrets by the assignment rule; fixture files are exempted
//     through the explicit registry (scripts/lib/policy-scan-exemptions.json).

const PLACEHOLDER_MARKERS = /\b(example|dummy|change_me|placeholder|sample|xxxx+|test[y]?|fake|mocktoken)\b/i;

/** Characters that look like a real credential value (mixed classes). */
function credentialLikeness(value) {
  let classes = 0;
  if (/[0-9]/.test(value)) classes += 1;
  if (/[A-Z]/.test(value)) classes += 1;
  if (/[._~+/=:-]/.test(value)) classes += 1;
  if (/[a-z]/.test(value)) classes += 1;
  return classes;
}

/**
 * Content rules: check(lineText, relPath) → boolean.
 * Every rule id must be listed here; ids are the stable contract consumed by
 * the exemptions registry and the scan report.
 */
const CONTENT_RULES = [
  {
    id: 'raw-prefix-token',
    severity: 'error',
    message: 'high-signal secret-prefix token found (value redacted)',
    check(line) {
      // sk-…, GitHub ghp_/gho_/ghu_/ghr_/ghs_, Slack xox[baprs]-, AWS AKIA…,
      // JWT header eyJ… (three dot-separated base64url segments).
      return /(?:^|[^A-Za-z0-9_-])(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{5,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/.test(
        line,
      );
    },
  },
  {
    id: 'private-key-block',
    severity: 'error',
    message: 'private key block found (value redacted)',
    check(line) {
      return /----?BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY----?/.test(line);
    },
  },
  {
    id: 'assignment-secret',
    severity: 'error',
    message: 'credential-in-assignment pattern found (value redacted)',
    check(line) {
      const m = line.match(
        /(?:\bpassword\b|\bpasswd\b|\bsecret\b|\btoken\b|\bapi[_-]?key\b|\baccess_token\b|\bclient_secret\b|\bauthorization\b|\bauth_token\b|\bcredential\b)\s*(?:=|:)\s*(['"])([^'"]{4,})\1/i,
      );
      if (!m) return false;
      const value = m[2];
      // URL-ish / placeholder-ish values that legitimately appear in docs and tests.
      if (PLACEHOLDER_MARKERS.test(value)) return false;
      if (/^Bearer\s/.test(value)) return false;
      if (value.includes('<')) return false;
      return true;
    },
  },
  {
    id: 'bearer-token',
    severity: 'error',
    message: 'hard-coded Bearer credential found (value redacted)',
    check(line) {
      const re = /(?:^|[^A-Za-z0-9_-])Bearer\s+([A-Za-z0-9._~+/=-]{12,})/i;
      const m = line.match(re);
      if (!m) return false;
      const value = m[1];
      // `Bearer ${token}` templates and lowercase prose phrases ("super-secret-token",
      // "bearer authentication") carry a single character class at most.
      if (value.includes('$')) return false;
      return credentialLikeness(value) >= 2;
    },
  },
  {
    id: 'seed-phrase',
    severity: 'error',
    message: 'crypto seed-phrase-shaped line found (value redacted)',
    check(line) {
      return /\b(?:mnemonic|seed phrase)\s*(?:=|:)\s*['"][a-z ]{12,}['"]/i.test(line);
    },
  },
];

/**
 * Path rules: check(relPath, opts) → boolean.
 * opts.largeFileBytes and opts.releaseMode tune the large-file threshold and
 * allow packaged installer extensions when scanning a staged release dir.
 */
const PATH_RULES = [
  {
    id: 'forbidden-path',
    severity: 'error',
    message: 'path is on the distribution-policy forbidden list',
    check(relPath) {
      const lower = relPath.toLowerCase().replace(/\\/g, '/');
      if (/(^|\/)\.ssh($|\/)/.test(lower)) return true;
      if (/(^|\/)secrets?($|\/)/.test(lower)) return true;
      const base = lower.slice(lower.lastIndexOf('/') + 1);
      if (/^(credentials|\.netrc|id_rsa|id_ed25519|id_ecdsa|\.pypirc)$/.test(base)) return true;
      // Tracked `.env` or `.env.*` (but `.env.example` documents the shape).
      if (base.endsWith('.env') || (base.startsWith('.env.') && !base.endsWith('.example'))) return true;
      return false;
    },
  },
  {
    id: 'cert-ext',
    severity: 'error',
    message: 'certificate/private-key extension tracked or staged',
    check(relPath, opts = {}) {
      const base = relPath.toLowerCase().replace(/\\/g, '/').split('/').pop() ?? '';
      if (opts.releaseMode && /\.(exe|msi|dmg|pkg)$/.test(base)) return false; // packaged artifact, not a cert
      return /\.(p12|pfx|p8|pem|key|ppk)$/.test(base);
    },
  },
  {
    id: 'large-file',
    severity: 'warning',
    message: 'file exceeds the distribution-policy size threshold',
    check(_relPath, opts = {}) {
      // Staged packaged installers are expected to exceed the 8 MB default; they
      // are only allowed to reach a release through the allowlist (release-pack.mjs),
      // so release-mode scan gives them a pass here.
      const base = _relPath.toLowerCase().replace(/\\/g, '/').split('/').pop() ?? '';
      if (opts.releaseMode && /\.(exe|msi|dmg|pkg)$/.test(base)) return false;
      const size = Number(opts.size ?? 0);
      const threshold = Number(opts.largeFileBytes ?? 8 * 1024 * 1024);
      return size > threshold;
    },
  },
  {
    id: 'machine-output',
    severity: 'info',
    message: 'untracked non-ignored file: disclose or ignore before a release',
    check() {
      return true; // wired from the git untracked list, not from content
    },
  },
];

export function getContentRules() {
  return CONTENT_RULES;
}

export function getPathRules() {
  return PATH_RULES;
}

/** True when relPath is covered by an explicit exemption registry entry for ruleId. */
export function isRegistryExempt(relPath, ruleId, registry) {
  return (registry?.entries ?? []).some((entry) => {
    const ids = entry.ruleIds ?? [];
    if (!ids.includes('*') && !ids.includes(ruleId)) return false;
    return globMatch(entry.path, relPath);
  });
}

/** Minimal `path` matcher: exact, `dir/**`, or basename `*`/`?` wildcards. */
export function globMatch(pattern, relPath) {
  const p = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
  const r = relPath.replace(/\\/g, '/');
  if (p.endsWith('/**')) {
    const dir = p.slice(0, -3);
    return r === dir || r.startsWith(`${dir}/`);
  }
  if (p.includes('*') || p.includes('?')) {
    const escaped = p
      .split('*')
      .map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&'))
      .join('.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`).test(r);
  }
  return r === p;
}