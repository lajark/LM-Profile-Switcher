// M4-001 CLI ✓ hook subcommand family. Token values are only ever minted by the
// seam at runtime (rotateToken) and read back from FakeFs, never spelled in this
// fixture, so the policy scanner finds no assignment-shaped literal here.
import { describe, expect, it } from 'vitest';

import type { CompositeProfile, HookRulesDocument } from '@lmps/domain';

import { runCli } from '../../apps/cli/src/run.ts';
import { CLI_ROOT, envelopeOf, makeCliHarness } from './helpers';

const HOOKS = `${CLI_ROOT}/hooks`;
const RULES_PATH = `${HOOKS}/rules.json`;

function rulesDocument(overrides: Partial<HookRulesDocument> = {}): HookRulesDocument {
  return {
    schemaVersion: 2,
    version: '2026.09.test',
    enabled: true,
    rules: [
      {
        id: 'editor-code',
        app: 'editor',
        taskKind: 'coding',
        profileId: 'alpha',
        rationale: { 'zh-CN': '编辑器编码任务', en: 'Editor coding.' },
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

describe('lmps hook status', () => {
  it('reports an unconfigured hook when no rules file exists', async () => {
    const { deps } = makeCliHarness();
    const human = await runCli(['hook', 'status'], deps);
    expect(human.exitCode).toBe(0);
    expect(human.stderr).toBe('');
    expect(human.text).toContain('Hook is not configured');

    const json = await runCli(['--json', 'hook', 'status'], deps);
    const envelope = envelopeOf(json.text);
    expect(json.exitCode).toBe(0);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('hook status');
    expect(envelope.data).toMatchObject({
      configured: false,
      enabled: false,
      version: null,
      ruleCount: 0,
      tokenStored: false,
      address: null,
    });
  });

  it('reports the configured state, token presence and loopback address', async () => {
    const { deps, fs } = makeCliHarness();
    deps.hookConfig!.writeRules(rulesDocument());
    deps.hookConfig!.rotateToken();
    fs.mkdirRecursive(HOOKS);
    fs.writeFileUtf8(`${HOOKS}/address.json`, JSON.stringify({ address: 'http://127.0.0.1:4123' }));

    const human = await runCli(['hook', 'status'], deps);
    expect(human.text).toContain('enabled');
    expect(human.text).toContain('1 rules');
    expect(human.text).toContain('stored');
    expect(human.text).toContain('http://127.0.0.1:4123');

    const json = await runCli(['--json', 'hook', 'status'], deps);
    expect(envelopeOf(json.text).data).toMatchObject({
      configured: true,
      enabled: true,
      version: '2026.09.test',
      ruleCount: 1,
      tokenStored: true,
      address: 'http://127.0.0.1:4123',
    });
  });

  it('never leaks the token value into status output', async () => {
    const { deps } = makeCliHarness();
    const token = deps.hookConfig!.rotateToken();
    const result = await runCli(['hook', 'status'], deps);
    expect(result.text).not.toContain(token);
    expect(result.stderr).not.toContain(token);

    const json = await runCli(['--json', 'hook', 'status'], deps);
    expect(json.text).not.toContain(token);
  });

  it('rejects a corrupt rules file with a localized usage error', async () => {
    const { deps, fs } = makeCliHarness();
    fs.mkdirRecursive(HOOKS);
    fs.writeFileUtf8(RULES_PATH, '{ "not": "a rules document" }');

    const human = await runCli(['hook', 'status'], deps);
    expect(human.exitCode).toBe(4);
    expect(human.stderr).toContain('not a valid rules document');

    const json = await runCli(['--json', 'hook', 'status'], deps);
    const envelope = envelopeOf(json.text);
    expect(json.exitCode).toBe(4);
    expect(envelope.ok).toBe(false);
    expect(envelope.error?.code).toBe('USAGE');
  });
});

describe('lmps hook token', () => {
  it('reports no stored token before the first rotation', async () => {
    const { deps } = makeCliHarness();
    const human = await runCli(['hook', 'token', 'show'], deps);
    expect(human.text).toContain('No hook token is stored');

    const json = await runCli(['--json', 'hook', 'token', 'show'], deps);
    const envelope = envelopeOf(json.text);
    expect(envelope.error).toBeUndefined();
    expect((envelope.data as { token: unknown }).token).toBeNull();
  });

  it('prints the stored token on show', async () => {
    const { deps } = makeCliHarness();
    const token = deps.hookConfig!.rotateToken();

    const human = await runCli(['hook', 'token', 'show'], deps);
    expect(human.text).toContain(token);

    const json = await runCli(['--json', 'hook', 'token', 'show'], deps);
    const data = envelopeOf(json.text).data as { token: string; rotated: boolean };
    expect(data.token).toBe(token);
    expect(data.rotated).toBe(false);
  });

  it('rotates the token atomically and replaces the old value', async () => {
    const { deps, fs } = makeCliHarness();
    const first = deps.hookConfig!.rotateToken();

    const rotated = await runCli(['--json', 'hook', 'token', 'rotate'], deps);
    expect(rotated.exitCode).toBe(0);
    const data = envelopeOf(rotated.text).data as { token: string; rotated: boolean };
    expect(data.rotated).toBe(true);
    expect(data.token).toMatch(/^[0-9a-f]{48}$/);

    const stored = JSON.parse(fs.readFileUtf8(`${HOOKS}/token.json`)) as {
      schemaVersion: number;
      token: string;
      createdAt: string;
    };
    expect(stored.schemaVersion).toBe(2);
    expect(stored.token).toBe(data.token);
    expect(stored.token).not.toBe(first);

    const again = await runCli(['--json', 'hook', 'token', 'show'], deps);
    expect((envelopeOf(again.text).data as { token: string }).token).toBe(data.token);
  });

  it('rejects an unknown token action', async () => {
    const { deps } = makeCliHarness();
    const result = await runCli(['hook', 'token', 'frobnicate'], deps);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain('unknown token action');
  });
});

describe('lmps hook rules', () => {
  it('reports no configured rules before any are written', async () => {
    const { deps } = makeCliHarness();
    const human = await runCli(['hook', 'rules'], deps);
    expect(human.exitCode).toBe(0);
    expect(human.text).toContain('No hook rules are configured');

    const json = await runCli(['--json', 'hook', 'rules'], deps);
    expect(envelopeOf(json.text).data).toMatchObject({ configured: false, rules: [] });
  });

  it('renders each mapping with task clause and disabled marker', async () => {
    const { deps } = makeCliHarness();
    deps.hookConfig!.writeRules(
      rulesDocument({
        rules: [
          { id: 'a', app: 'editor', taskKind: 'coding', profileId: 'alpha' },
          { id: 'b', app: 'helper', profileId: 'beta', enabled: false },
        ],
      }),
    );

    const human = await runCli(['hook', 'rules'], deps);
    expect(human.text).toContain('editor (coding) → alpha');
    expect(human.text).toContain('helper → beta (disabled)');

    const json = await runCli(['--json', 'hook', 'rules'], deps);
    const data = envelopeOf(json.text).data as { configured: boolean; rules: unknown[] };
    expect(data.configured).toBe(true);
    expect(data.rules).toHaveLength(2);
  });

  it('validates a document whose profiles exist in the store', async () => {
    const { deps } = makeCliHarness();
    deps.store.create(profile('alpha'));
    deps.hookConfig!.writeRules(rulesDocument());

    const human = await runCli(['hook', 'rules', 'validate'], deps);
    expect(human.exitCode).toBe(0);
    expect(human.text).toContain('Rules document is valid (1 rules)');

    const json = await runCli(['--json', 'hook', 'rules', 'validate'], deps);
    const data = envelopeOf(json.text).data as { valid: boolean; issues: string[]; missingProfiles: string[] };
    expect(data.valid).toBe(true);
    expect(data.issues).toEqual([]);
    expect(data.missingProfiles).toEqual([]);
  });

  it('flags referenced profiles that are missing from the store', async () => {
    const { deps } = makeCliHarness();
    deps.hookConfig!.writeRules(rulesDocument({ rules: [{ id: 'ghost', app: 'editor', profileId: 'ghost' }] }));

    const json = await runCli(['--json', 'hook', 'rules', 'validate'], deps);
    const data = envelopeOf(json.text).data as { valid: boolean; issues: string[]; missingProfiles: string[] };
    expect(data.valid).toBe(false);
    expect(data.missingProfiles).toEqual(['ghost']);
    expect(data.issues.some((issue) => issue.includes('ghost'))).toBe(true);
  });

  it('reports schema issues like duplicate mappings', async () => {
    const { deps } = makeCliHarness();
    deps.hookConfig!.writeRules(
      rulesDocument({
        rules: [
          { id: 'r1', app: 'editor', taskKind: 'coding', profileId: 'alpha' },
          { id: 'r2', app: 'editor', taskKind: 'coding', profileId: 'beta' },
        ],
      }),
    );

    const human = await runCli(['hook', 'rules', 'validate'], deps);
    expect(human.text).toContain('Rules document has issues');

    const json = await runCli(['--json', 'hook', 'rules', 'validate'], deps);
    const data = envelopeOf(json.text).data as { valid: boolean; issues: string[] };
    expect(data.valid).toBe(false);
    expect(data.issues.some((issue) => issue.includes('duplicate mapping'))).toBe(true);
  });

  it('rejects an unknown rules action', async () => {
    const { deps } = makeCliHarness();
    const result = await runCli(['hook', 'rules', 'frobnicate'], deps);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain('unknown rules action');
  });
});

describe('lmps hook enable/disable', () => {
  it('refuses to toggle when no rules are configured', async () => {
    const { deps } = makeCliHarness();
    const human = await runCli(['hook', 'disable'], deps);
    expect(human.exitCode).toBe(4);
    expect(human.text).toBe('');
    expect(human.stderr).toContain('No hook rules to toggle');
  });

  it('flips the top-level enabled switch and persists it', async () => {
    const { deps } = makeCliHarness();
    deps.hookConfig!.writeRules(rulesDocument({ enabled: false }));

    const enabled = await runCli(['--json', 'hook', 'enable'], deps);
    expect(enabled.exitCode).toBe(0);
    expect(envelopeOf(enabled.text).data).toMatchObject({ enabled: true, version: '2026.09.test' });
    expect(deps.hookConfig!.readRules()?.enabled).toBe(true);

    const disabled = await runCli(['--json', 'hook', 'disable'], deps);
    expect(envelopeOf(disabled.text).data).toMatchObject({ enabled: false, version: '2026.09.test' });
    expect(deps.hookConfig!.readRules()?.enabled).toBe(false);
  });
});

describe('lmps hook dispatch', () => {
  it('rejects excess positional arguments', async () => {
    const { deps } = makeCliHarness();
    const result = await runCli(['hook', 'status', 'extra-arg'], deps);
    expect(result.exitCode).toBe(4);
    expect(result.text).toBe('');
    expect(result.stderr).toContain('expected at most 0 positional argument');
  });

  it('rejects an unknown subcommand', async () => {
    const { deps } = makeCliHarness();
    const result = await runCli(['hook', 'bogus'], deps);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain('unknown hook subcommand');
  });

  it('reports CAPABILITY_UNSUPPORTED when the hook config is not wired', async () => {
    const { deps } = makeCliHarness({ hookConfig: null });
    const human = await runCli(['hook', 'status'], deps);
    expect(human.exitCode).toBe(6);
    expect(human.text).toBe('');
    expect(human.stderr).toContain('does not support');

    const json = await runCli(['--json', 'hook', 'status'], deps);
    const envelope = envelopeOf(json.text);
    expect(json.exitCode).toBe(6);
    expect(envelope.ok).toBe(false);
    expect(envelope.error?.code).toBe('CAPABILITY_UNSUPPORTED');
  });
});