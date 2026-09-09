/**
 * `lmps hook <status|token|rules|enable|disable>` — the local hook (M4-001)
 * configuration surface. Everything is LOCAL file management of the files the
 * core-service http transport lives on: rules (app/task → profile mapping), the
 * persistent Bearer token (SECRET) and the loopback rendezvous. The CLI never
 * talks to LM Studio for these and never serves the loopback API itself; a null
 * seam honestly reports CAPABILITY_UNSUPPORTED.
 */
import { describeHookRules, validateHookRules, type HookRulesDocument } from '@lmps/domain';

import { parseCommandArgs, type CommandSpec } from '../options.js';
import { CliError, capabilityUnsupported } from '../errors.js';
import type { CliDeps, CommandOutput, HookConfigPort } from '../seams.js';

const SUBCOMMANDS: Record<string, CommandSpec> = {
  status: { maxPositional: 0 },
  token: { maxPositional: 1 },
  rules: { maxPositional: 1 },
  enable: { maxPositional: 0 },
  disable: { maxPositional: 0 },
};

function usage(message: string): CliError {
  return new CliError('USAGE', message, { detail: message });
}

function requireHook(deps: CliDeps): HookConfigPort {
  if (deps.hookConfig === null) throw capabilityUnsupported('hook');
  return deps.hookConfig;
}

export async function runHookCommand(deps: CliDeps, args: readonly string[]): Promise<CommandOutput> {
  const raw = args[0];
  if (raw === undefined || raw.startsWith('-')) {
    throw usage('hook requires a subcommand (status|token|rules|enable|disable)');
  }
  const spec = SUBCOMMANDS[raw];
  if (spec === undefined) {
    throw usage(`unknown hook subcommand: ${raw}`);
  }
  const sub = parseCommandArgs(spec, args.slice(1));

  switch (raw) {
    case 'status':
      return runStatus(deps);
    case 'token':
      return runToken(deps, sub.positionals[0]);
    case 'rules':
      return runRules(deps, sub.positionals[0]);
    case 'enable':
      return runSetEnabled(deps, true);
    case 'disable':
      return runSetEnabled(deps, false);
  }
  throw usage(`unknown hook subcommand: ${raw}`);
}

function runStatus(deps: CliDeps): CommandOutput {
  const hook = requireHook(deps);
  const doc = hook.readRules(); // may throw USAGE when the file is non-conforming
  const tokenStored = hook.readToken() !== null;
  const addressRaw = hook.readAddress();
  const address =
    addressRaw !== null && typeof addressRaw.address === 'string' ? addressRaw.address : null;
  const t = deps.t;

  if (doc === null) {
    return {
      text: [t('hook.status.unconfigured'), ...(address === null ? [] : [t('hook.status.address', { address })])].join('\n'),
      data: {
        configured: false,
        enabled: false,
        version: null,
        ruleCount: 0,
        tokenStored,
        address,
      },
    };
  }

  const state = doc.enabled ? t('hook.state.enabled') : t('hook.state.disabled');
  const tokenWord = tokenStored ? t('hook.token.stored') : t('hook.token.missing');
  const lines = [
    t('hook.status.line', {
      state,
      version: doc.version,
      ruleCount: String(doc.rules.length),
      token: tokenWord,
    }),
  ];
  if (address !== null) lines.push(t('hook.status.address', { address }));
  return {
    text: lines.join('\n'),
    data: {
      configured: true,
      enabled: doc.enabled,
      version: doc.version,
      ruleCount: doc.rules.length,
      tokenStored,
      address,
    },
  };
}

const TOKEN_ACTIONS = ['show', 'rotate'] as const;
type TokenAction = (typeof TOKEN_ACTIONS)[number];

function runToken(deps: CliDeps, position: string | undefined): CommandOutput {
  const raw = position ?? 'show';
  if (!TOKEN_ACTIONS.includes(raw as TokenAction)) {
    throw usage(`unknown token action: ${raw}`);
  }
  const action = raw as TokenAction;
  const hook = requireHook(deps);
  const t = deps.t;

  if (action === 'show') {
    const token = hook.readToken();
    if (token === null) {
      return { text: t('hook.token.notStored'), data: { token: null, rotated: false } };
    }
    return { text: t('hook.token.show', { token }), data: { token, rotated: false } };
  }

  const token = hook.rotateToken();
  return {
    text: `${t('hook.token.rotated')}\n${t('hook.token.show', { token })}`,
    data: { token, rotated: true },
  };
}

const RULE_ACTIONS = ['show', 'validate'] as const;
type RuleAction = (typeof RULE_ACTIONS)[number];

function runRules(deps: CliDeps, position: string | undefined): CommandOutput {
  const raw = position ?? 'show';
  if (!RULE_ACTIONS.includes(raw as RuleAction)) {
    throw usage(`unknown rules action: ${raw}`);
  }
  const hook = requireHook(deps);
  const t = deps.t;

  if (raw === 'validate') {
    const rawDocument = hook.readRulesRaw();
    if (rawDocument === null) {
      return { text: t('hook.rules.show.none'), data: { valid: false, issues: [], missingProfiles: [] } };
    }
    const verdict = validateHookRules(rawDocument);
    const storeIds = new Set(deps.store.list().map((profile) => profile.id));
    const missingProfiles =
      verdict.ok === false
        ? []
        : [...new Set(verdict.document.rules.map((rule) => rule.profileId))].filter(
            (id) => !storeIds.has(id),
          );
    const issues = [
      ...(verdict.ok ? [] : verdict.issues),
      ...missingProfiles.map((id) => t('hook.rules.missingProfile', { id })),
    ];
    const valid = verdict.ok && issues.length === 0;
    const text = valid
      ? t('hook.rules.valid', {
          ruleCount: String(verdict.ok ? verdict.document.rules.length : 0),
        })
      : [t('hook.rules.invalid'), ...issues.map((issue) => `  - ${issue}`)].join('\n');
    return { text, data: { valid, issues, missingProfiles } };
  }

  const doc = hook.readRules(); // may throw USAGE when the file is non-conforming
  if (doc === null) {
    return { text: t('hook.rules.show.none'), data: { configured: false, rules: [] } };
  }
  const summary = describeHookRules(doc);
  const lines = summary.rules.map((rule) => {
    const target =
      rule.taskKind === null
        ? rule.app
        : `${rule.app} ${t('hook.rules.taskClause', { taskKind: rule.taskKind })}`;
    const stateClause = rule.enabled ? '' : ` ${t('hook.rules.disabledMark')}`;
    return t('hook.rules.rule', { target, profileId: rule.profileId, stateClause });
  });
  return { text: lines.join('\n'), data: { configured: true, ...summary } };
}

function runSetEnabled(deps: CliDeps, enabled: boolean): CommandOutput {
  const hook = requireHook(deps);
  const doc = hook.readRules();
  if (doc === null) {
    throw new CliError('USAGE', 'no hook rules to toggle', {
      params: { key: 'hook.error.notConfigured' },
    });
  }
  const updated: HookRulesDocument = { ...doc, enabled };
  hook.writeRules(updated);
  return {
    text: deps.t(enabled ? 'hook.enable.updated' : 'hook.disable.updated', {
      version: doc.version,
    }),
    data: { enabled, version: doc.version },
  };
}