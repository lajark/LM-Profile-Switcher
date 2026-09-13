/**
 * Helpers specific to the Windows-shell suite (M6-004 Slice B): the locale of
 * a fresh isolated home follows OS detection, so shell locators accept either
 * language, and the sidecar restart is exercised by killing the REAL sidecar
 * process of the test-spawned desktop shell (newest lmps-desktop.exe tree).
 */
import { execSync } from 'node:child_process';
import { browser } from '@wdio/globals';
import type { ChainablePromiseElement } from 'webdriverio';
import type { Locale } from './labels.js';
import { LABELS } from './labels.js';
import { xpathString } from './page.js';

type Element = ChainablePromiseElement;

export const CONNECTED_RE = /已连接|Connected/;
const NOT_CONNECTED_RE = /正在连接|已断开|Connecting|Disconnected|auth/i;

export function badge(): Element {
  return browser.$('.header .badge');
}

export async function badgeText(): Promise<string> {
  return (await badge().getText()).trim();
}

export async function waitConnected(timeoutMs = 45_000): Promise<void> {
  await browser.waitUntil(async () => CONNECTED_RE.test(await badgeText()), {
    timeout: timeoutMs,
    interval: 500,
    timeoutMsg: 'sidecar badge never reached connected',
  });
}

export async function waitLeavesConnected(timeoutMs = 15_000): Promise<void> {
  await browser.waitUntil(async () => NOT_CONNECTED_RE.test(await badgeText()), {
    timeout: timeoutMs,
    interval: 200,
    timeoutMsg: 'badge never left connected after killing the sidecar',
  });
}

/** Matches a button by either language copy (shell-suite locale is dynamic). */
export function buttonEither(zh: string, en: string): Element {
  return browser.$(
    `//button[normalize-space()=${xpathString(zh)} or normalize-space()=${xpathString(en)}]`,
  );
}

/** Resolves the active UI locale by probing the localized Profiles nav tab. */
export async function detectLocale(): Promise<Locale> {
  const found = await buttonByLabel(LABELS['zh-CN'].nav.profiles).isExisting();
  return found ? 'zh-CN' : 'en';
}

function buttonByLabel(text: string): Element {
  return browser.$(`//nav[contains(@class,'tabs')]//button[normalize-space()=${xpathString(text)}]`);
}

/**
 * Kills the real sidecar SEA belonging to the newest lmps-desktop.exe process
 * (the shell under test is started during this run). Only the newest process
 * tree is touched; any concurrently running dev shell keeps its sidecar.
 * Returns the number of sidecar processes terminated.
 *
 * The probe is delivered via -EncodedCommand: feeding multi-line scripts to
 * `powershell -Command -` stdin uses the interactive parser, which silently
 * drops lines following a trailing-pipe continuation.
 */
export async function killNewestShellSidecar(): Promise<number> {
  const script = [
    "$ErrorActionPreference='Stop'",
    '$app = Get-CimInstance Win32_Process -Filter "Name=\'lmps-desktop.exe\'" |',
    '  Sort-Object CreationDate | Select-Object -Last 1',
    "if (-not $app) { Write-Output 'KILLED=0'; exit 0 }",
    '$procs = @{}; Get-CimInstance Win32_Process | ForEach-Object { $procs[[int]$_.ProcessId] = $_ }',
    '$tree = New-Object System.Collections.Generic.HashSet[int]',
    '$stack = New-Object System.Collections.Stack',
    '$stack.Push([int]$app.ProcessId)',
    'while ($stack.Count -gt 0) {',
    '  $current = $stack.Pop()',
    '  if ($tree.Add($current)) {',
    '    foreach ($p in $procs.Values) { if ([int]$p.ParentProcessId -eq $current) { $stack.Push([int]$p.ProcessId) } }',
    '  }',
    '}',
    "$targets = foreach ($p in $procs.Values) {",
    "  if ($tree.Contains([int]$p.ProcessId) -and ($p.Name -eq 'lmps-sidecar.exe' -or $p.Name -eq 'lmps-sidecar-x86_64-pc-windows-msvc.exe')) { [int]$p.ProcessId }",
    '}',
    '$killed = 0',
    'foreach ($target in $targets) { Stop-Process -Id $target -Force -ErrorAction SilentlyContinue; $killed++ }',
    "Write-Output \"KILLED=$killed\"",
    'if ($killed -eq 0) {',
    '  $apps = Get-CimInstance Win32_Process -Filter "Name=\'lmps-desktop.exe\'" | Sort-Object CreationDate |',
    '    ForEach-Object { "app pid=$($_.ProcessId) start=$($_.CreationDate)" }',
    "  Write-Output ('DIAG ' + ($apps -join ' | '))",
    "  $sides = foreach ($p in $procs.Values) { if ($p.Name -like 'lmps-sidecar*') { \"side pid=$($p.ProcessId) ppid=$($p.ParentProcessId) name=$($p.Name)\" } }",
    "  Write-Output ('DIAG ' + ($sides -join ' | '))",
    '}',
  ].join('\n');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const out = execSync(`powershell -NoProfile -EncodedCommand ${encoded}`, {
    encoding: 'utf8',
    timeout: 20_000,
    // powershell.exe 5.1 may emit one-time "Preparing modules for first use"
    // CLIXML progress records on stderr; they are not test diagnostics.
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  const match = out.match(/^KILLED=(\d+)/m);
  const killed = match ? Number(match[1]) : Number.NaN;
  if (!Number.isFinite(killed)) {
    throw new Error(`sidecar kill probe returned unexpected output: ${out.slice(0, 500)}`);
  }
  if (killed === 0) {
    throw new Error(`no sidecar in newest lmps-desktop tree; diagnostics:\n${out}`);
  }
  return killed;
}
