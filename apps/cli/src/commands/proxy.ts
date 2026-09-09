/**
 * `lmps proxy <status|aliases|enable|disable>` — the virtual-alias (M4-002)
 * configuration surface for the OpenAI-compatible proxy. Everything is LOCAL
 * file management of `<rootDir>/hooks/aliases.json`, the one document the
 * core-service proxy front reads; the CLI never talks to LM Studio for it and
 * never serves the loopback API itself. A null seam honestly reports
 * CAPABILITY_UNSUPPORTED.
 */
import {
  AliasGenerationSchema,
  SCHEMA_VERSION,
  describeVirtualAliases,
  validateVirtualAliases,
  type VirtualAlias,
  type VirtualAliasesDocument,
} from '@lmps/domain';

import { parseCommandArgs, type CommandSpec } from '../options.js';
import { CliError, capabilityUnsupported } from '../errors.js';
import type { AliasConfigPort, CliDeps, CommandOutput } from '../seams.js';

/** Long flags `aliases add` accepts. */
const ALIAS_ADD_FLAGS: Record<string, 'boolean' | 'string'> = {
  params: 'string',
  activate: 'boolean',
  'no-lock-session': 'boolean',
};

const SUBCOMMANDS: Record<string, CommandSpec> = {
  status: { maxPositional: 0 },
  // add <virtualModel> <profileId> carries two extra positionals and the
  // generation/activation flags; show/remove/validate just ignore them.
  aliases: { maxPositional: 3, flags: ALIAS_ADD_FLAGS },
  enable: { maxPositional: 0 },
  disable: { maxPositional: 0 },
};

/** `aliases` sub-actions. */
const ALIAS_ACTIONS = ['show', 'add', 'remove', 'validate'] as const;
type AliasAction = (typeof ALIAS_ACTIONS)[number];

function usage(message: string): CliError {
  return new CliError('USAGE', message, { detail: message });
}

function requireAlias(deps: CliDeps): AliasConfigPort {
  if (deps.aliasConfig === null) throw capabilityUnsupported('proxy');
  return deps.aliasConfig;
}

export async function runProxyCommand(deps: CliDeps, args: readonly string[]): Promise<CommandOutput> {
  const raw = args[0];
  if (raw === undefined || raw.startsWith('-')) {
    throw usage('proxy requires a subcommand (status|aliases|enable|disable)');
  }
  const spec = SUBCOMMANDS[raw];
  if (spec === undefined) {
    throw usage(`unknown proxy subcommand: ${raw}`);
  }
  const sub = parseCommandArgs(spec, args.slice(1));

  switch (raw) {
    case 'status':
      return runStatus(deps);
    case 'aliases':
      return runAliases(deps, sub);
    case 'enable':
      return runSetEnabled(deps, true);
    case 'disable':
      return runSetEnabled(deps, false);
  }
  throw usage(`unknown proxy subcommand: ${raw}`);
}

function runStatus(deps: CliDeps): CommandOutput {
  const alias = requireAlias(deps);
  const doc = alias.readAliases(); // may throw USAGE on a non-conforming file
  const described = doc === null ? null : describeVirtualAliases(doc);
  const t = deps.t;

  if (doc === null || described === null) {
    return {
      text: t('proxy.status.unconfigured'),
      data: {
        configured: false,
        enabled: false,
        version: null,
        sessionLock: null,
        sessionTtlMs: null,
        aliasCount: 0,
        aliases: [],
      },
    };
  }

  const state = doc.enabled ? t('proxy.state.enabled') : t('proxy.state.disabled');
  return {
    text: t('proxy.status.line', {
      state,
      version: doc.version,
      aliasCount: String(described.aliases.length),
      session: described.sessionLock ? t('proxy.state.locked') : t('proxy.state.unlocked'),
    }),
    data: {
      configured: true,
      enabled: doc.enabled,
      version: doc.version,
      sessionLock: described.sessionLock,
      sessionTtlMs: described.sessionTtlMs,
      aliasCount: described.aliases.length,
      aliases: described.aliases,
    },
  };
}

function runAliases(
  deps: CliDeps,
  sub: { command: string; positionals: string[]; flags: Record<string, string | boolean> },
): CommandOutput {
  const action = (sub.command === '' ? 'show' : sub.command) as AliasAction;
  if (!ALIAS_ACTIONS.includes(action)) {
    throw usage(`unknown aliases action: ${action}`);
  }
  const alias = requireAlias(deps);

  switch (action) {
    case 'show':
      return runShow(deps, alias);
    case 'add':
      return runAdd(deps, alias, sub.positionals.slice(1), sub.flags);
    case 'remove':
      return runRemove(deps, alias, sub.positionals.slice(1));
    case 'validate':
      return runValidate(deps, alias);
  }
  throw usage(`unknown aliases action: ${action}`);
}

function runShow(deps: CliDeps, alias: AliasConfigPort): CommandOutput {
  const doc = alias.readAliases(); // may throw USAGE on a non-conforming file
  const t = deps.t;
  if (doc === null) {
    return {
      text: t('proxy.aliases.show.none'),
      data: { configured: false, aliases: [] },
    };
  }
  const summary = describeVirtualAliases(doc);
  const lines = summary.aliases.map((item) => {
    const clauses = [
      ...(item.activate ? [t('proxy.aliases.activateMark')] : []),
      ...(item.enabled ? [] : [t('proxy.aliases.disabledMark')]),
    ];
    return t('proxy.aliases.alias', {
      virtualModel: item.virtualModel,
      profileId: item.profileId,
      clauses: clauses.length === 0 ? '' : ` ${clauses.join(' ')}`,
    });
  });
  return {
    text: lines.length === 0 ? t('proxy.aliases.show.empty') : lines.join('\n'),
    data: { configured: true, version: doc.version, aliases: summary.aliases },
  };
}

function runAdd(
  deps: CliDeps,
  alias: AliasConfigPort,
  positionals: readonly string[],
  flags: Record<string, string | boolean>,
): CommandOutput {
  const virtualModel = positionals[0];
  const profileId = positionals[1];
  if (virtualModel === undefined || profileId === undefined) {
    throw usage('aliases add requires a virtual model name and a profile id');
  }

  const doc = alias.readAliases() ?? defaultDocument();
  const existingIndex = doc.aliases.findIndex((candidate) => candidate.virtualModel === virtualModel);

  let generation: VirtualAlias['generation'] | undefined;
  const params = flags['params'];
  if (typeof params === 'string') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(params) as unknown;
    } catch {
      throw usage('--params must be a JSON object');
    }
    const generationResult = AliasGenerationSchema.safeParse(parsed);
    if (!generationResult.success) {
      throw usage('--params carries unknown or out-of-range generation fields');
    }
    generation = generationResult.data;
  }

  const entry: VirtualAlias = {
    id: existingIndex === -1 ? virtualModel : doc.aliases[existingIndex]?.id ?? virtualModel,
    virtualModel,
    profileId,
    ...(typeof params === 'string' ? { generation } : {}),
    ...(flags['activate'] === true ? { activate: true } : {}),
    ...(flags['no-lock-session'] === true ? { lockSession: false } : {}),
    enabled: true,
  };

  const replaced = existingIndex !== -1;
  const aliases = [...doc.aliases];
  if (replaced) aliases[existingIndex] = entry;
  else aliases.push(entry);
  alias.writeAliases({ ...doc, aliases });

  const t = deps.t;
  return {
    text: t(replaced ? 'proxy.aliases.added.replaced' : 'proxy.aliases.added.new', {
      virtualModel,
      profileId,
    }),
    data: { added: true, replaced, alias: entry },
  };
}

function runRemove(deps: CliDeps, alias: AliasConfigPort, positionals: readonly string[]): CommandOutput {
  const target = positionals[0];
  if (target === undefined) {
    throw usage('aliases remove requires a virtual model name or alias id');
  }
  const doc = alias.readAliases();
  if (doc === null) {
    throw new CliError('USAGE', 'no aliases document to remove from', {
      params: { key: 'proxy.error.notConfigured' },
    });
  }
  const remaining = doc.aliases.filter((candidate) => candidate.virtualModel !== target && candidate.id !== target);
  if (remaining.length === doc.aliases.length) {
    throw new CliError('USAGE', `no alias named ${target}`, {
      params: { key: 'proxy.error.aliasMissing', values: { id: target } },
    });
  }
  alias.writeAliases({ ...doc, aliases: remaining });
  return { text: deps.t('proxy.aliases.removed', { id: target }), data: { removed: true, id: target } };
}

function runValidate(deps: CliDeps, alias: AliasConfigPort): CommandOutput {
  const rawDocument = alias.readAliasesRaw();
  const t = deps.t;
  if (rawDocument === null) {
    return { text: t('proxy.aliases.show.none'), data: { valid: false, issues: [], missingProfiles: [] } };
  }
  const verdict = validateVirtualAliases(rawDocument);
  const storeIds = new Set(deps.store.list().map((profile) => profile.id));
  const missingProfiles =
    verdict.ok === false
      ? []
      : [...new Set(verdict.document.aliases.map((item) => item.profileId))].filter((id) => !storeIds.has(id));
  const issues = [
    ...(verdict.ok ? [] : verdict.issues),
    ...missingProfiles.map((id) => t('proxy.aliases.missingProfile', { id })),
  ];
  const valid = verdict.ok && issues.length === 0;
  const text = valid
    ? t('proxy.aliases.valid', {
        aliasCount: String(verdict.ok ? verdict.document.aliases.length : 0),
      })
    : [t('proxy.aliases.invalid'), ...issues.map((issue) => `  - ${issue}`)].join('\n');
  return { text, data: { valid, issues, missingProfiles } };
}

function runSetEnabled(deps: CliDeps, enabled: boolean): CommandOutput {
  const alias = requireAlias(deps);
  const doc = alias.readAliases();
  if (doc === null) {
    throw new CliError('USAGE', 'no aliases to toggle', {
      params: { key: 'proxy.error.notConfigured' },
    });
  }
  const updated: VirtualAliasesDocument = { ...doc, enabled };
  alias.writeAliases(updated);
  return {
    text: deps.t(enabled ? 'proxy.enable.updated' : 'proxy.disable.updated', {
      version: doc.version,
    }),
    data: { enabled, version: doc.version },
  };
}

/** A fresh, enabled document for the first alias (schemaVersion pinned by SCHEMA_VERSION). */
function defaultDocument(): VirtualAliasesDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    version: '2026.09.initial',
    enabled: true,
    aliases: [],
  };
}