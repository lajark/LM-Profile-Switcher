/**
 * Diagnostics redaction (PRD §9, PROJECT_DISTRIBUTION_POLICY §1.5):
 * host / user / home-dir / env values / serial-number-like fragments are
 * replaced with stable placeholders before any diagnostic output is written.
 *
 * The context values (homeDir/hostname/username/env) are provided by the caller
 * so this module stays pure and deterministic.
 */
export interface RedactContext {
  homeDir?: string;
  hostname?: string;
  username?: string;
  env?: Readonly<Record<string, string | undefined>>;
}

const PLACEHOLDER_RE = /<(?:home|user|host|serial)>|<env:[A-Z][A-Z0-9_]*>/i;

export function hasRedactionPlaceholders(text: string): boolean {
  return PLACEHOLDER_RE.test(text);
}

/** Case-insensitive name-only match so lookalike keys are not mis-tagged. */
const SERIAL_KEY_RE = /(?:serial\s*(?:number|no)?|\bsn\b)\s*[:=：]?\s*[^\s,;]{1,40}/gi;

export function redactDiagnostics(text: string, ctx: RedactContext = {}): string {
  let result = text;

  if (ctx.homeDir && ctx.homeDir.trim() !== '') {
    result = result.split(ctx.homeDir).join('<home>');
  }

  // Any user-profile directory segment (current or other users) → <user>.
  result = result.replace(/\\Users\\[^\\/]+(?=\\)/gi, '\\Users\\<user>');

  if (ctx.hostname && ctx.hostname.trim() !== '') {
    result = result.split(ctx.hostname).join('<host>');
  }

  for (const [name, value] of Object.entries(ctx.env ?? {})) {
    // Short values are too common to be identifiers; replacing them would
    // mangle normal text (e.g. "id").
    if (typeof value === 'string' && value.length >= 4) {
      result = result.split(value).join(`<env:${name}>`);
    }
  }

  if (ctx.username && ctx.username.trim() !== '') {
    const pattern = new RegExp(`\\b${escapeRegExp(ctx.username.trim())}\\b`, 'gi');
    result = result.replace(pattern, '<user>');
  }

  result = result.replace(SERIAL_KEY_RE, '<serial>');
  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}