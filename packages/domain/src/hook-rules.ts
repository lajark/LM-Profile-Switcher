/**
 * Hook rules document (M4-001): the explicit app/task → profile mapping that
 * drives the local hook API's `hook.switch`. Rules are data, never scattered
 * constants: one document carries a `version` (independent of the schema
 * version, e.g. "2026.09.1"), a top-level `enabled` switch (the hook's global
 * disable switch) and a list of mapping rules. Matching is deny-by-default: a
 * request only resolves when an enabled rule's `app` matches exactly (and its
 * optional `taskKind` agrees with the request). The client can never pick a
 * profile directly — the server resolves the rule to the target profile.
 *
 * Deliberately separate from `RulesDocument` (M2-001 task rules): that contract
 * is per-taskKind optimizer guidance with no `app` dimension, enforces
 * taskKind-uniqueness, and has no profileId output — the wrong shape for an
 * app→profile switch table.
 */
import { z } from 'zod';

import { TASK_KINDS } from './profile.js';
import { SCHEMA_VERSION } from './version.js';

export const HookRuleSchema = z
  .object({
    /** Stable rule id (referenced by audit rows and CLI tooling). */
    id: z.string().min(1),
    /** Caller identity the local hook request must carry exactly. */
    app: z.string().min(1),
    /** Optional task refinement: the rule only matches this taskKind. */
    taskKind: z.enum(TASK_KINDS).optional(),
    /** The profile this mapping activates; existence is a store concern. */
    profileId: z.string().min(1),
    /** Per-rule switch; absent means enabled. */
    enabled: z.boolean().optional(),
    /** Why this mapping exists, in both project languages. */
    rationale: z
      .object({
        'zh-CN': z.string().min(1),
        en: z.string().min(1),
      })
      .optional(),
  })
  .passthrough();

export const StrictHookRuleSchema = HookRuleSchema.strict();

export const HookRulesDocumentSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    /** Mapping-pack version (independent of the schema version). */
    version: z.string().min(1),
    /** Global hook disable switch: false refuses every hook.switch call. */
    enabled: z.boolean(),
    rules: z.array(HookRuleSchema),
  })
  .passthrough();

export const StrictHookRulesDocumentSchema = HookRulesDocumentSchema.strict();

export type HookRule = z.infer<typeof HookRuleSchema>;
export type HookRulesDocument = z.infer<typeof HookRulesDocumentSchema>;

/** What a local hook switch request may carry (never a profile id). */
export interface HookSwitchRequest {
  app: string;
  taskKind?: string | null;
}

/** The resolved target of one hook.switch request. */
export interface HookSwitchTarget {
  profileId: string;
  ruleId: string;
}

/**
 * Resolve a hook switch request against a rules document, deny-by-default.
 *
 * Matching order:
 *  1. the document's global `enabled` flag is false → never resolves;
 *  2. only rules whose `app` equals the request `app` and whose own
 *     `enabled` is not false are considered;
 *  3. a request carrying a `taskKind` is matched by an enabled rule with the
 *     same `taskKind` first;
 *  4. otherwise a rule with no `taskKind` (the app-wide default) applies;
 *  5. an ambiguous default (more than one task-less rule for one app) or an
 *     unmatched request resolves to null → the caller denies.
 */
export function matchHookRule(
  document: HookRulesDocument,
  request: HookSwitchRequest,
): HookSwitchTarget | null {
  if (document.enabled === false) return null;
  const appRules = document.rules.filter(
    (rule) => rule.enabled !== false && rule.app === request.app,
  );
  if (request.taskKind !== undefined && request.taskKind !== null) {
    const withTask = appRules.filter((rule) => rule.taskKind === request.taskKind);
    if (withTask.length > 0) {
      const rule = withTask[0];
      if (rule === undefined) return null;
      return { profileId: rule.profileId, ruleId: rule.id };
    }
  }
  const generic = appRules.filter((rule) => rule.taskKind === undefined);
  if (generic.length === 1) {
    const rule = generic[0];
    if (rule === undefined) return null;
    return { profileId: rule.profileId, ruleId: rule.id };
  }
  // Zero matches (deny) or ambiguous defaults (multiple task-less rules) both
  // fail closed; ambiguity is a configuration error surfaced by validateHookRules.
  return null;
}

/** Human-listable summary of a rules document (CLI / hook.status reuse). */
export function describeHookRules(document: HookRulesDocument): {
  version: string;
  enabled: boolean;
  rules: Array<{ id: string; app: string; taskKind: string | null; profileId: string; enabled: boolean }>;
} {
  return {
    version: document.version,
    enabled: document.enabled,
    rules: document.rules.map((rule) => ({
      id: rule.id,
      app: rule.app,
      taskKind: rule.taskKind ?? null,
      profileId: rule.profileId,
      enabled: rule.enabled !== false,
    })),
  };
}

/**
 * Validate an untrusted rules document: schema conformance plus the
 * mapping-level invariants the matcher relies on (duplicate keys and ambiguous
 * app-wide defaults). Profile existence is NOT checked here — that is a store
 * concern, validated wherever the profile store is available (core-service
 * hook.switch and the CLI's hook rules validator).
 */
export function validateHookRules(input: unknown):
  | { ok: true; document: HookRulesDocument }
  | { ok: false; issues: string[] } {
  const parsed = HookRulesDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'document'}: ${issue.message}`),
    };
  }
  const document = parsed.data;
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const rule of document.rules) {
    const generic = rule.taskKind === undefined;
    const key = `${rule.app}/${rule.taskKind ?? ''}`;
    if (seen.has(key)) {
      issues.push(`duplicate mapping for app "${rule.app}"${generic ? '' : ` task "${rule.taskKind}"`} (${rule.id})`);
    }
    seen.add(key);
  }
  // Multiple task-less rules for one app are ambiguous defaults.
  const genericCount = new Map<string, number>();
  for (const rule of document.rules) {
    if (rule.taskKind !== undefined) continue;
    genericCount.set(rule.app, (genericCount.get(rule.app) ?? 0) + 1);
  }
  for (const [app, count] of genericCount) {
    if (count > 1) issues.push(`ambiguous default: task-less rules for app "${app}" resolve to more than one profile`);
  }
  return issues.length === 0 ? { ok: true, document } : { ok: false, issues };
}