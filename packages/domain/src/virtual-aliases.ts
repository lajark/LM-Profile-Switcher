/**
 * Virtual aliases document (M4-002): the explicit virtual-model → profile
 * mapping that drives the OpenAI-compatible proxy. A client addresses a model
 * by its friendly `virtualModel` name; the server resolves it to a stored
 * profile, injects any `generation` sampling overrides onto the upstream chat
 * request, and serves the completion. Resolution is deny-by-default: a request
 * only resolves when the document is enabled and an enabled alias's
 * `virtualModel` equals the requested model exactly — no semantic router, no
 * confidence scoring, ever.
 *
 * Deliberately separate from `HookRulesDocument` (M4-001): that contract maps
 * an app/task to a profile for the hook.switch API, with no generation
 * overrides and no public model name. The proxy is the inference-time face of
 * the same "rules are data" idea.
 */
import { z } from 'zod';

import { SCHEMA_VERSION } from './version.js';

/** Default same-session lock TTL when the document omits `sessionTtlMs`. */
export const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000;

/**
 * Generation-field subset the proxy is allowed to inject, mirrors the
 * camelCase names of `GenerationProfile` (profile.ts) with the same tri-state
 * semantics: value → override the upstream parameter, null → explicitly clear
 * it (let the upstream default rule), absent → pass the client value through
 * untouched. `reasoning`, `structuredOutputSchema` and `presetReference` are
 * deliberately NOT injectable through the proxy (planned scope).
 */
export const AliasGenerationSchema = z
  .object({
    temperature: z.number().min(0).nullable().optional(),
    topP: z.number().min(0).max(1).nullable().optional(),
    topK: z.number().int().min(0).nullable().optional(),
    minP: z.number().min(0).max(1).nullable().optional(),
    repeatPenalty: z.number().gt(0).nullable().optional(),
    frequencyPenalty: z.number().nullable().optional(),
    presencePenalty: z.number().nullable().optional(),
    maxTokens: z.number().int().min(1).nullable().optional(),
    seed: z.number().int().nullable().optional(),
    systemPrompt: z.string().nullable().optional(),
  })
  .strict();

export type AliasGeneration = z.infer<typeof AliasGenerationSchema>;

export const VirtualAliasSchema = z
  .object({
    /** Stable alias id (referenced by audit rows and CLI tooling). */
    id: z.string().min(1),
    /** Public model name clients address; matched exactly. */
    virtualModel: z.string().min(1),
    /** The profile this alias serves; existence is a store concern. */
    profileId: z.string().min(1),
    /** Optional upstream model key override; absent = profile model key. */
    modelKey: z.string().min(1).optional(),
    /** Per-alias switch; absent means enabled. */
    enabled: z.boolean().optional(),
    /**
     * Opt-in controlled auto-switch: when true, the proxy activates the mapped
     * profile (shared activation runner + lock) before serving, like
     * hook.switch. Default false — the proxy never switches activation on its
     * own by default.
     */
    activate: z.boolean().optional(),
    /** Generation overrides injected onto the upstream chat request. */
    generation: AliasGenerationSchema.optional(),
    /** Per-alias same-session lock override; absent = follow the document. */
    lockSession: z.boolean().optional(),
    /** Why this mapping exists, in both project languages. */
    rationale: z
      .object({
        'zh-CN': z.string().min(1),
        en: z.string().min(1),
      })
      .optional(),
  })
  .passthrough();

export const StrictVirtualAliasSchema = VirtualAliasSchema.strict();

export const VirtualAliasesDocumentSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    /** Alias-pack version (independent of the schema version). */
    version: z.string().min(1),
    /** Global proxy disable switch: false refuses every chat/model request. */
    enabled: z.boolean(),
    /**
     * Same-session default lock (FR-10): when true the proxy latches the
     * resolved profile for a (virtualModel, sessionId) pair. Absent means
     * locked; a deliberate `false` disables latching for every alias.
     */
    sessionLock: z.boolean().optional(),
    /** Latch TTL; absent means DEFAULT_SESSION_TTL_MS. */
    sessionTtlMs: z.number().int().min(1000).optional(),
    aliases: z.array(VirtualAliasSchema),
  })
  .passthrough();

export const StrictVirtualAliasesDocumentSchema = VirtualAliasesDocumentSchema.strict();

export type VirtualAlias = z.infer<typeof VirtualAliasSchema>;
export type VirtualAliasesDocument = z.infer<typeof VirtualAliasesDocumentSchema>;

/** What an OpenAI proxy model request may carry (never a profile id). */
export interface VirtualAliasRequest {
  model: string;
}

/** The resolved target of one proxy model request. */
export interface VirtualAliasTarget {
  profileId: string;
  alias: VirtualAlias;
}

/**
 * Resolve a proxy model request against an aliases document, deny-by-default.
 * Matching is exact-string: the document's `enabled` flag must be true and an
 * enabled alias's `virtualModel` must equal the requested model. Duplicate
 * `virtualModel` across aliases is a configuration error surfaced by
 * validateVirtualAliases; the first enabled match wins.
 */
export function matchVirtualAlias(
  document: VirtualAliasesDocument,
  request: VirtualAliasRequest,
): VirtualAliasTarget | null {
  if (document.enabled === false) return null;
  const alias = document.aliases.find(
    (candidate) => candidate.enabled !== false && candidate.virtualModel === request.model,
  );
  if (alias === undefined) return null;
  return { profileId: alias.profileId, alias };
}

/** Human-listable summary of an aliases document (CLI / aliases.status reuse). */
export function describeVirtualAliases(document: VirtualAliasesDocument): {
  version: string;
  enabled: boolean;
  sessionLock: boolean;
  sessionTtlMs: number;
  aliases: Array<{
    id: string;
    virtualModel: string;
    profileId: string;
    enabled: boolean;
    activate: boolean;
  }>;
} {
  return {
    version: document.version,
    enabled: document.enabled,
    sessionLock: document.sessionLock === false ? false : true,
    sessionTtlMs: document.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS,
    aliases: document.aliases.map((alias) => ({
      id: alias.id,
      virtualModel: alias.virtualModel,
      profileId: alias.profileId,
      enabled: alias.enabled !== false,
      activate: alias.activate === true,
    })),
  };
}

/**
 * Validate an untrusted aliases document: schema conformance plus the
 * mapping-level invariants the matcher relies on (duplicate enabled
 * `virtualModel`). Profile existence is NOT checked here — that is a store
 * concern, validated wherever the profile store is available (core-service
 * proxy seam and the CLI's proxy aliases validator).
 */
export function validateVirtualAliases(input: unknown):
  | { ok: true; document: VirtualAliasesDocument }
  | { ok: false; issues: string[] } {
  const parsed = VirtualAliasesDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'document'}: ${issue.message}`),
    };
  }
  const document = parsed.data;
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const alias of document.aliases) {
    if (alias.enabled === false) continue;
    if (seen.has(alias.virtualModel)) {
      issues.push(
        `duplicate virtualModel "${alias.virtualModel}" for enabled aliases (${alias.id})`,
      );
    }
    seen.add(alias.virtualModel);
  }
  return issues.length === 0 ? { ok: true, document } : { ok: false, issues };
}