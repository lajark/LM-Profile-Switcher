// M4-002 CLI ✓ proxy subcommand family. The aliases document is exercised
// through the REAL createAliasConfigStore seam over FakeFs; only local files
// are involved, never LM Studio.
import { describe, expect, it } from 'vitest';

import type { CompositeProfile, VirtualAliasesDocument } from '@lmps/domain';

import { runCli } from '../../apps/cli/src/run.ts';
import { CLI_ROOT, envelopeOf, makeCliHarness } from './helpers';

const CLI_ROOT_HOOK = `${CLI_ROOT}/hooks`;
const ALIASES_PATH = `${CLI_ROOT_HOOK}/aliases.json`;

function aliasesDocument(overrides: Partial<VirtualAliasesDocument> = {}): VirtualAliasesDocument {
  return {
    schemaVersion: 2,
    version: '2026.09.test',
    enabled: true,
    aliases: [
      {
        id: 'coder',
        virtualModel: 'lmps://coder',
        profileId: 'alpha',
        rationale: { 'zh-CN': '编程', en: 'Coding.' },
      },
    ],
    ...overrides,
  };
}

function profile(id: string): CompositeProfile {
  return {
    schemaVersion: 2,
    id,
    displayName: { 'zh-CN': `配置 ${id}`, en: `Profile ${id}` },
    description: { en: 'synthetic profile' },
    model: { modelKey: 'synthetic/alpha', family: 'synthetic', architecture: 'dense' },
    task: { type: 'Coding', kind: 'coding', concurrency: 1 },
    runtime: { contextLength: 8192, gpuOffload: 'max' },
    generation: { temperature: 0.3 },
    behavior: { mode: 'exclusive' },
    metadata: { createdAt: '2026-08-22T01:02:04.000Z', updatedAt: '2026-08-22T01:02:04.000Z' },
  };
}

describe('lmps proxy status', () => {
  it('reports an unconfigured proxy when no aliases file exists', async () => {
    const { deps } = makeCliHarness();
    const human = await runCli(['proxy', 'status'], deps);
    expect(human.exitCode).toBe(0);
    expect(human.stderr).toBe('');
    expect(human.text).toContain('not configured');

    const json = await runCli(['--json', 'proxy', 'status'], deps);
    const envelope = envelopeOf(json.text);
    expect(json.exitCode).toBe(0);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('proxy status');
    expect(envelope.data).toMatchObject({
      configured: false,
      enabled: false,
      version: null,
      sessionLock: null,
      sessionTtlMs: null,
      aliasCount: 0,
      aliases: [],
    });
  });

  it('reports the configured state, session lock and alias count', async () => {
    const { deps } = makeCliHarness();
    deps.aliasConfig!.writeAliases(aliasesDocument());

    const human = await runCli(['proxy', 'status'], deps);
    expect(human.text).toContain('enabled');
    expect(human.text).toContain('1 aliases');
    expect(human.text).toContain('locked');

    const json = await runCli(['--json', 'proxy', 'status'], deps);
    expect(envelopeOf(json.text).data).toMatchObject({
      configured: true,
      enabled: true,
      version: '2026.09.test',
      sessionLock: true,
      sessionTtlMs: 1800000,
      aliasCount: 1,
      aliases: [{ id: 'coder', virtualModel: 'lmps://coder', profileId: 'alpha', enabled: true, activate: false }],
    });
  });

  it('reflects a disabled switch and a document sessionLock:false override', async () => {
    const { deps } = makeCliHarness();
    deps.aliasConfig!.writeAliases(aliasesDocument({ enabled: false, sessionLock: false }));

    const human = await runCli(['proxy', 'status'], deps);
    expect(human.text).toContain('disabled');
    expect(human.text).toContain('inherits document');

    const json = await runCli(['--json', 'proxy', 'status'], deps);
    expect(envelopeOf(json.text).data).toMatchObject({ enabled: false, sessionLock: false });
  });

  it('rejects a corrupt aliases file with a localized usage error', async () => {
    const { deps, fs } = makeCliHarness();
    fs.mkdirRecursive(CLI_ROOT_HOOK);
    fs.writeFileUtf8(ALIASES_PATH, '{ "not": "an aliases document" }');

    const human = await runCli(['proxy', 'status'], deps);
    expect(human.exitCode).toBe(4);
    expect(human.stderr).toContain('not a valid aliases document');

    const json = await runCli(['--json', 'proxy', 'status'], deps);
    const envelope = envelopeOf(json.text);
    expect(json.exitCode).toBe(4);
    expect(envelope.ok).toBe(false);
    expect(envelope.error?.code).toBe('USAGE');
  });
});

describe('lmps proxy aliases show', () => {
  it('reports no configured aliases before any are written', async () => {
    const { deps } = makeCliHarness();
    const human = await runCli(['proxy', 'aliases'], deps);
    expect(human.exitCode).toBe(0);
    expect(human.text).toContain('No proxy aliases are configured');

    const json = await runCli(['--json', 'proxy', 'aliases', 'show'], deps);
    expect(envelopeOf(json.text).data).toMatchObject({ configured: false, aliases: [] });
  });

  it('renders each mapping with activate and disabled markers', async () => {
    const { deps } = makeCliHarness();
    deps.aliasConfig!.writeAliases(
      aliasesDocument({
        aliases: [
          { id: 'coder', virtualModel: 'lmps://coder', profileId: 'alpha' },
          { id: 'helper', virtualModel: 'lmps://helper', profileId: 'beta', activate: true },
          { id: 'off', virtualModel: 'lmps://off', profileId: 'gamma', enabled: false },
        ],
      }),
    );

    const human = await runCli(['proxy', 'aliases'], deps);
    expect(human.text).toContain('lmps://coder → alpha');
    expect(human.text).toContain('lmps://helper → beta (activate)');
    expect(human.text).toContain('lmps://off → gamma (disabled)');

    const json = await runCli(['--json', 'proxy', 'aliases', 'show'], deps);
    const data = envelopeOf(json.text).data as { configured: boolean; aliases: unknown[] };
    expect(data.configured).toBe(true);
    expect(data.aliases).toHaveLength(3);
  });
});

describe('lmps proxy aliases add', () => {
  it('adds an alias atomically and creates the document on first use', async () => {
    const { deps, fs } = makeCliHarness();

    const json = await runCli(['--json', 'proxy', 'aliases', 'add', 'lmps://coder', 'alpha'], deps);
    expect(json.exitCode).toBe(0);
    expect(envelopeOf(json.text).data).toMatchObject({
      added: true,
      replaced: false,
      alias: { id: 'lmps://coder', virtualModel: 'lmps://coder', profileId: 'alpha', enabled: true },
    });

    const stored = JSON.parse(fs.readFileUtf8(ALIASES_PATH)) as VirtualAliasesDocument;
    expect(stored.schemaVersion).toBe(2);
    expect(stored.enabled).toBe(true);
    expect(stored.aliases).toHaveLength(1);
    expect(stored.aliases[0]?.profileId).toBe('alpha');
  });

  it('replaces the mapping when the virtual model is aded again', async () => {
    const { deps } = makeCliHarness();
    await runCli(['proxy', 'aliases', 'add', 'lmps://coder', 'alpha'], deps);

    const json = await runCli(['--json', 'proxy', 'aliases', 'add', 'lmps://coder', 'beta'], deps);
    expect(envelopeOf(json.text).data).toMatchObject({ replaced: true, alias: { profileId: 'beta' } });

    const human = await runCli(['proxy', 'aliases'], deps);
    expect(human.text).toContain('lmps://coder → beta');
    expect(human.text).not.toContain('lmps://coder → alpha');
  });

  it('accepts --params generation overrides and --activate / --no-lock-session', async () => {
    const { deps, fs } = makeCliHarness();
    const json = await runCli(
      [
        '--json',
        'proxy',
        'aliases',
        'add',
        'lmps://coder',
        'alpha',
        '--params',
        '{"temperature":0.2,"maxTokens":64}',
        '--activate',
        '--no-lock-session',
      ],
      deps,
    );
    expect(json.exitCode).toBe(0);
    const alias = (envelopeOf(json.text).data as { alias: Record<string, unknown> }).alias;
    expect(alias.activate).toBe(true);
    expect(alias.lockSession).toBe(false);
    expect(alias.generation).toMatchObject({ temperature: 0.2, maxTokens: 64 });

    const stored = JSON.parse(fs.readFileUtf8(ALIASES_PATH)) as VirtualAliasesDocument;
    expect(stored.aliases[0]?.generation).toMatchObject({ temperature: 0.2, maxTokens: 64 });
  });

  it('rejects malformed --params JSON and unknown generation fields', async () => {
    const { deps } = makeCliHarness();
    const broken = await runCli(['proxy', 'aliases', 'add', 'lmps://coder', 'alpha', '--params', '{nope'], deps);
    expect(broken.exitCode).toBe(4);
    expect(broken.stderr).toContain('--params must be a JSON object');

    const badField = await runCli(
      ['proxy', 'aliases', 'add', 'lmps://coder', 'alpha', '--params', '{"structuredOutputSchema":{}}'],
      deps,
    );
    expect(badField.exitCode).toBe(4);
    expect(badField.stderr).toContain('unknown or out-of-range');
  });

  it('requires both a virtual model and a profile id', async () => {
    const { deps } = makeCliHarness();
    const result = await runCli(['proxy', 'aliases', 'add', 'lmps://coder'], deps);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain('requires a virtual model name and a profile id');
  });
});

describe('lmps proxy aliases remove', () => {
  it('removes an alias by virtual model and keeps the rest of the document', async () => {
    const { deps } = makeCliHarness();
    deps.aliasConfig!.writeAliases(
      aliasesDocument({
        aliases: [
          { id: 'a', virtualModel: 'lmps://a', profileId: 'alpha' },
          { id: 'b', virtualModel: 'lmps://b', profileId: 'beta' },
        ],
      }),
    );

    const json = await runCli(['--json', 'proxy', 'aliases', 'remove', 'lmps://a'], deps);
    expect(json.exitCode).toBe(0);
    expect(envelopeOf(json.text).data).toMatchObject({ removed: true, id: 'lmps://a' });

    const doc = deps.aliasConfig!.readAliases();
    expect(doc?.aliases).toHaveLength(1);
    expect(doc?.aliases[0]?.id).toBe('b');
  });

  it('rejects removing an unknown alias with a usage error', async () => {
    const { deps } = makeCliHarness();
    deps.aliasConfig!.writeAliases(aliasesDocument());
    const result = await runCli(['proxy', 'aliases', 'remove', 'lmps://ghost'], deps);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain('No alias named lmps://ghost');
  });
});

describe('lmps proxy aliases validate', () => {
  it('validates a document whose profiles exist in the store', async () => {
    const { deps } = makeCliHarness();
    deps.store.create(profile('alpha'));
    deps.aliasConfig!.writeAliases(aliasesDocument());

    const human = await runCli(['proxy', 'aliases', 'validate'], deps);
    expect(human.exitCode).toBe(0);
    expect(human.text).toContain('valid (1 aliases)');

    const json = await runCli(['--json', 'proxy', 'aliases', 'validate'], deps);
    const data = envelopeOf(json.text).data as { valid: boolean; issues: string[]; missingProfiles: string[] };
    expect(data.valid).toBe(true);
    expect(data.issues).toEqual([]);
    expect(data.missingProfiles).toEqual([]);
  });

  it('flags a referenced profile missing from the store', async () => {
    const { deps } = makeCliHarness();
    deps.aliasConfig!.writeAliases(
      aliasesDocument({ aliases: [{ id: 'ghost', virtualModel: 'lmps://g', profileId: 'ghost' }] }),
    );

    const human = await runCli(['proxy', 'aliases', 'validate'], deps);
    expect(human.exitCode).toBe(0);
    expect(human.text).toContain('missing from the store');

    const json = await runCli(['--json', 'proxy', 'aliases', 'validate'], deps);
    const data = envelopeOf(json.text).data as { valid: boolean; issues: string[]; missingProfiles: string[] };
    expect(data.valid).toBe(false);
    expect(data.missingProfiles).toEqual(['ghost']);
    expect(data.issues.some((issue) => issue.includes('ghost'))).toBe(true);
  });

  it('flags duplicate enabled virtual models as document issues', async () => {
    const { deps } = makeCliHarness();
    deps.aliasConfig!.writeAliases(
      aliasesDocument({
        aliases: [
          { id: 'dup-a', virtualModel: 'lmps://x', profileId: 'alpha' },
          { id: 'dup-b', virtualModel: 'lmps://x', profileId: 'beta' },
        ],
      }),
    );

    const json = await runCli(['--json', 'proxy', 'aliases', 'validate'], deps);
    const data = envelopeOf(json.text).data as { valid: boolean; issues: string[]; missingProfiles: string[] };
    expect(data.valid).toBe(false);
    expect(data.issues.some((issue) => issue.includes('duplicate virtualModel'))).toBe(true);
  });
});

describe('lmps proxy enable/disable', () => {
  it('refuses to toggle when no aliases are configured', async () => {
    const { deps } = makeCliHarness();
    const human = await runCli(['proxy', 'disable'], deps);
    expect(human.exitCode).toBe(4);
    expect(human.stderr).toContain('No aliases to toggle');
  });

  it('flips the top-level enabled switch and persists it', async () => {
    const { deps, fs } = makeCliHarness();
    deps.aliasConfig!.writeAliases(aliasesDocument({ enabled: false }));

    const enabled = await runCli(['--json', 'proxy', 'enable'], deps);
    expect(enabled.exitCode).toBe(0);
    expect(envelopeOf(enabled.text).data).toMatchObject({ enabled: true, version: '2026.09.test' });
    expect(JSON.parse(fs.readFileUtf8(ALIASES_PATH)) as { enabled: boolean }).toMatchObject({ enabled: true });

    const disabled = await runCli(['--json', 'proxy', 'disable'], deps);
    expect(envelopeOf(disabled.text).data).toMatchObject({ enabled: false });
  });
});

describe('lmps proxy dispatch', () => {
  it('rejects an unknown subcommand', async () => {
    const { deps } = makeCliHarness();
    const result = await runCli(['proxy', 'bogus'], deps);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain('unknown proxy subcommand');
  });

  it('rejects an unknown aliases action', async () => {
    const { deps } = makeCliHarness();
    const result = await runCli(['proxy', 'aliases', 'frobnicate'], deps);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain('unknown aliases action');
  });

  it('reports CAPABILITY_UNSUPPORTED when the alias config is not wired', async () => {
    const { deps } = makeCliHarness({ aliasConfig: null });
    const human = await runCli(['proxy', 'status'], deps);
    expect(human.exitCode).toBe(6);
    expect(human.text).toBe('');
    expect(human.stderr).toContain('does not support');

    const json = await runCli(['--json', 'proxy', 'status'], deps);
    const envelope = envelopeOf(json.text);
    expect(json.exitCode).toBe(6);
    expect(envelope.ok).toBe(false);
    expect(envelope.error?.code).toBe('CAPABILITY_UNSUPPORTED');
  });
});