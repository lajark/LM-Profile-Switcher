/**
 * `lmps doctor [--bundle]`: runs offline environment checks. Checks always
 * complete; a failing check never changes the exit code (still 0), it is
 * reported in the output and machine `summary.ok`. Only fatal orchestration
 * faults (store unavailable) surface as internal errors.
 *
 * `--bundle` appends a diagnostics object that is redacted through the hardware
 * redactor (private paths → placeholders) and is LOCAL-ONLY by policy.
 */
import { probeHardware, redactDiagnostics } from '@lmps/hardware';
import type { ResourceKey } from '@lmps/i18n';

import { parseCommandArgs } from '../options.js';
import type { CliDeps, CommandOutput } from '../seams.js';

const SPEC = { flags: { bundle: 'boolean' }, maxPositional: 0 } as const;

type CheckId = 'store' | 'config' | 'locale' | 'node' | 'discovery' | 'hardware';

interface CheckResult {
  id: CheckId;
  ok: boolean;
  wired?: boolean;
  detail?: Record<string, unknown>;
}

export async function runDoctorCommand(deps: CliDeps, args: readonly string[]): Promise<CommandOutput> {
  const sub = parseCommandArgs(SPEC, args);
  const bundle = sub.flags.bundle === true;

  const checks: CheckResult[] = [
    await checkStore(deps),
    checkConfig(deps),
    checkLocale(deps),
    checkNode(deps),
    checkDiscovery(deps),
    await checkHardware(deps),
  ];

  const warnings = checks.filter((check) => check.wired === false).map((check) => check.id);
  const summary = { ok: checks.every((check) => check.ok) };

  const lines: string[] = [deps.t('doctor.title')];
  for (const check of checks) {
    if (check.wired === false) {
      lines.push(
        `[${deps.t('doctor.status.warn')}] ${tCheckName(deps, check.id)}: ${deps.t('doctor.warn.discovery')}`,
      );
      continue;
    }
    const status = check.ok ? deps.t('doctor.status.ok') : deps.t('doctor.status.fail');
    lines.push(`[${status}] ${tCheckName(deps, check.id)}`);
  }
  if (bundle) lines.push(deps.t('doctor.bundleNotice'));

  const data: Record<string, unknown> = { checks, warnings, summary };
  if (bundle) {
    const hardware = await probeHardware(deps.probeEnv).catch(() => null);
    const diag = { nodeVersion: deps.nodeVersion, hardware };
    const redacted = redactDiagnostics(JSON.stringify(diag, null, 2));
    data.diagnostics = JSON.parse(redacted);
  }

  return { text: lines.join('\n'), data };
}

function tCheckName(deps: CliDeps, id: CheckId): string {
  return deps.t(`doctor.check.${id}` as ResourceKey);
}

async function checkStore(deps: CliDeps): Promise<CheckResult> {
  try {
    const result = deps.store.recover();
    return {
      id: 'store',
      ok: true,
      detail: {
        restored: result.restored.length,
        removed: result.removed.length,
        cleanedTemp: result.cleanedTemp.length,
      },
    };
  } catch {
    return { id: 'store', ok: false };
  }
}

function checkConfig(deps: CliDeps): CheckResult {
  let readable = true;
  let writable = true;
  try {
    deps.storedLocale();
  } catch {
    readable = false;
  }
  try {
    deps.applyLocale(deps.getLocale()); // same-value switch is a no-op at the store level
  } catch {
    writable = false;
  }
  return { id: 'config', ok: readable && writable, detail: { readable, writable } };
}

function checkLocale(deps: CliDeps): CheckResult {
  const rendered = deps.t('app.name');
  const missing = rendered === 'app.name';
  return { id: 'locale', ok: !missing, detail: { missing } };
}

function checkNode(deps: CliDeps): CheckResult {
  const major = Number(deps.nodeVersion?.split('.')[0] ?? -1);
  return { id: 'node', ok: major >= 20, detail: { major } };
}

function checkDiscovery(deps: CliDeps): CheckResult {
  return { id: 'discovery', ok: true, wired: deps.discovery !== null };
}

async function checkHardware(deps: CliDeps): Promise<CheckResult> {
  try {
    const profile = await probeHardware(deps.probeEnv);
    return { id: 'hardware', ok: true, detail: { probedAt: profile.probedAt } };
  } catch {
    return { id: 'hardware', ok: false };
  }
}