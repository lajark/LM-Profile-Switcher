import { describe, expect, it } from 'vitest';
import type { CompositeProfile } from '@lmps/domain';

import { runCli } from '../../apps/cli/src/run.ts';
import { envelopeOf, makeCliHarness } from './helpers';
import { ALPHA, BETA, GAMMA, profileJson, validProfile } from '../profile-store/fixtures';

const YAML_DOC = [
  'schemaVersion: 2',
  'id: yamlp',
  'displayName:',
  "  zh-CN: 'Yaml Profile'",
  "  en: 'Yaml Profile'",
  'model:',
  '  modelKey: synthetic/test-model',
  'task:',
  '  type: quick-chat',
  'runtime:',
  '  contextLength: 8192',
  '  gpuOffload: max',
  'generation:',
  '  temperature: 0.7',
  'behavior:',
  '  mode: exclusive',
  '  rollback: best-effort',
  'metadata:',
  '  createdAt: 2026-08-22T01:02:03.000Z',
  '  updatedAt: 2026-08-22T01:02:03.000Z',
].join('\n');

function withSecret(id: string): CompositeProfile {
  return {
    ...validProfile(id),
    apiKey: 'sk-lmps-test-not-a-real-secret',
  } as CompositeProfile & { apiKey: string } as CompositeProfile;
}

describe('profile list', () => {
  it('reports an empty store', async () => {
    const { deps } = makeCliHarness();
    const result = await runCli(['profile', 'list'], deps);
    expect(result.exitCode).toBe(0);
    expect(result.text).toContain('No profiles yet');

    const json = await runCli(['--json', 'profile', 'list'], deps);
    const envelope = envelopeOf(json.text);
    expect(envelope.command).toBe('profile list');
    expect(envelope.data).toEqual({ count: 0, profiles: [] });
  });

  it('lists stable summaries', async () => {
    const { deps, store } = makeCliHarness();
    store.create(ALPHA);
    store.create(BETA);
    const human = await runCli(['profile', 'list'], deps);
    expect(human.text).toContain('alpha · quick-chat · synthetic/test-model');
    expect(human.text).toContain('beta · quick-chat · synthetic/test-model');

    const json = await runCli(['--json', 'profile', 'list'], deps);
    const envelope = envelopeOf(json.text);
    expect((envelope.data as { count: number }).count).toBe(2);
    expect((envelope.data as { profiles: unknown[] }).profiles[0]).toEqual({
      id: ALPHA.id,
      displayName: ALPHA.displayName,
      model: { modelKey: ALPHA.model.modelKey, family: ALPHA.model.family },
      task: { type: ALPHA.task.type },
      updatedAt: ALPHA.metadata.updatedAt,
    });
  });

  it('filters by --model and --task', async () => {
    const { deps, store } = makeCliHarness();
    store.create(ALPHA);
    store.create(GAMMA);
    store.create(validProfile('delta', { task: { type: 'heavy-codegen' } }));

    const model = await runCli(['--json', 'profile', 'list', '--model', 'synthetic/other-model'], deps);
    const modelData = envelopeOf(model.text).data as { profiles: Array<{ id: string }> };
    expect(modelData.profiles.map((p) => p.id)).toEqual(['gamma']);

    const task = await runCli(['--json', 'profile', 'list', '--task', 'heavy-codegen'], deps);
    const taskData = envelopeOf(task.text).data as { profiles: Array<{ id: string }> };
    expect(taskData.profiles.map((p) => p.id)).toEqual(['delta']);
  });
});

describe('profile show', () => {
  it('prints a human summary', async () => {
    const { deps, store } = makeCliHarness();
    store.create(ALPHA);
    const result = await runCli(['profile', 'show', 'alpha'], deps);
    expect(result.exitCode).toBe(0);
    expect(result.text).toContain('alpha · quick-chat · synthetic/test-model');
    expect(result.text).toContain('createdAt:');
    expect(result.text).toContain('updatedAt:');
  });

  it('returns a sanitized document as machine data', async () => {
    const { deps, store } = makeCliHarness();
    store.create(withSecret('sec'));
    const result = await runCli(['--json', 'profile', 'show', 'sec'], deps);
    expect(result.exitCode).toBe(0);
    const envelope = envelopeOf(result.text);
    const doc = (envelope.data as { profile: Record<string, unknown> }).profile;
    expect(doc.schemaVersion).toBe(2);
    expect(doc.apiKey).toBeNull();
    expect(doc.apiKey).not.toBe('sk-lmps-test-not-a-real-secret');
  });

  it('fails with exit 4 for a missing profile', async () => {
    const { deps } = makeCliHarness();
    const result = await runCli(['profile', 'show', 'nope'], deps);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain('Profile not found');
    expect(result.text).toBe('');
  });
});

describe('profile create', () => {
  it('creates from stdin JSON with --file -', async () => {
    const { deps, store } = makeCliHarness({
      readStdin: async () => profileJson(ALPHA),
    });
    const result = await runCli(['profile', 'create', '--name', 'alpha', '--file', '-'], deps);
    expect(result.exitCode).toBe(0);
    expect(result.text).toContain('Created profile alpha');
    expect(store.get('alpha').id).toBe('alpha');

    // A fresh harness avoids a duplicate-collision on the second call.
    const second = makeCliHarness({ readStdin: async () => profileJson(validProfile('alpha')) });
    const json = await runCli(['--json', 'profile', 'create', '--name', 'alpha', '--file', '-'], second.deps);
    const envelope = envelopeOf(json.text);
    expect(envelope.data).toEqual({ id: 'alpha' });
  });

  it('creates from a YAML file', async () => {
    const { deps, fs, store } = makeCliHarness();
    fs.writeFileUtf8('/input/profile.yaml', YAML_DOC);
    const result = await runCli(['profile', 'create', '--name', 'yamlp', '--file', '/input/profile.yaml'], deps);
    expect(result.exitCode).toBe(0);
    expect(store.get('yamlp').id).toBe('yamlp');
  });

  it('rejects a document id that does not match --name', async () => {
    const { deps } = makeCliHarness({ readStdin: async () => profileJson(ALPHA) });
    const result = await runCli(['profile', 'create', '--name', 'other', '--file', '-'], deps);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain('does not match');
  });

  it('rejects an invalid document', async () => {
    const { deps } = makeCliHarness({ readStdin: async () => '{"schemaVersion": 1}' });
    const result = await runCli(['profile', 'create', '--name', 'bad', '--file', '-'], deps);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain('import failed');
  });

  it('reports an unreadable input file', async () => {
    const { deps } = makeCliHarness();
    const result = await runCli(['profile', 'create', '--name', 'alpha', '--file', '/input/nope.json'], deps);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain('Failed to read');
  });

  it('rejects a duplicate id', async () => {
    const { deps, store } = makeCliHarness();
    store.create(ALPHA);
    const result = await runCli(['profile', 'create', '--name', 'alpha', '--file', '-'], deps);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain('already exists');
  });

  it('requires --name and --file', async () => {
    const { deps } = makeCliHarness();
    const result = await runCli(['profile', 'create'], deps);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain('Invalid usage');
  });
});

describe('profile edit', () => {
  it('deep-merges a JSON patch and stamps updatedAt', async () => {
    const { deps, fs, store } = makeCliHarness();
    store.create(ALPHA);
    fs.writeFileUtf8('/patch.json', JSON.stringify({ runtime: { contextLength: 16384 } }));
    const result = await runCli(['profile', 'edit', 'alpha', '--patch', '/patch.json'], deps);
    expect(result.exitCode).toBe(0);
    expect(result.text).toContain('Updated profile alpha');
    const doc = store.get('alpha');
    expect(doc.runtime.contextLength).toBe(16384);
    expect(doc.runtime.gpuOffload).toBe('max'); // untouched by the deep merge
    expect(doc.metadata.updatedAt).not.toBe(ALPHA.metadata.updatedAt);

    const json = await runCli(['--json', 'profile', 'edit', 'alpha', '--patch', '/patch.json'], deps);
    const envelope = envelopeOf(json.text);
    expect((envelope.data as { id: string }).id).toBe('alpha');
  });

  it('prints the current document as a template without --patch', async () => {
    const { deps, store } = makeCliHarness();
    store.create(ALPHA);
    const result = await runCli(['profile', 'edit', 'alpha'], deps);
    expect(result.exitCode).toBe(0);
    const lines = result.text.split('\n');
    expect(lines[0]).toContain('Template for alpha');
    const doc = JSON.parse(lines.slice(1).join('\n')) as { id: string };
    expect(doc.id).toBe('alpha');
  });

  it('rejects a patch that changes the id', async () => {
    const { deps, fs, store } = makeCliHarness();
    store.create(ALPHA);
    fs.writeFileUtf8('/patch.json', JSON.stringify({ id: 'beta' }));
    const result = await runCli(['profile', 'edit', 'alpha', '--patch', '/patch.json'], deps);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain('Invalid profile id');
  });

  it('rejects a non-JSON patch', async () => {
    const { deps, fs, store } = makeCliHarness();
    store.create(ALPHA);
    fs.writeFileUtf8('/patch.json', '{oops');
    const result = await runCli(['profile', 'edit', 'alpha', '--patch', '/patch.json'], deps);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain('Invalid usage');
  });

  it('fails for a missing profile', async () => {
    const { deps, fs } = makeCliHarness();
    fs.writeFileUtf8('/patch.json', JSON.stringify({ task: { type: 'x' } }));
    const result = await runCli(['profile', 'edit', 'nope', '--patch', '/patch.json'], deps);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain('Profile not found');
  });
});

describe('profile clone/delete/import/export', () => {
  it('clones a profile under a new id with fresh metadata', async () => {
    const { deps, store } = makeCliHarness();
    store.create(ALPHA);
    const result = await runCli(['profile', 'clone', 'alpha', 'beta'], deps);
    expect(result.exitCode).toBe(0);
    expect(result.text).toContain('Cloned to beta');
    const cloned = store.get('beta');
    expect(cloned.id).toBe('beta');
    expect(cloned.model.modelKey).toBe(ALPHA.model.modelKey);
    expect(cloned.metadata.createdAt).toBe('2026-08-22T01:02:04.000Z');

    const json = await runCli(['--json', 'profile', 'clone', 'alpha', 'gamma'], deps);
    expect((envelopeOf(json.text).data as { id: string }).id).toBe('gamma');
  });

  it('rejects a clone onto an existing id', async () => {
    const { deps, store } = makeCliHarness();
    store.create(ALPHA);
    store.create(BETA);
    const result = await runCli(['profile', 'clone', 'alpha', 'beta'], deps);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain('already exists');
  });

  it('refuses to delete without --yes', async () => {
    const { deps, store } = makeCliHarness();
    store.create(ALPHA);
    const result = await runCli(['profile', 'delete', 'alpha'], deps);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain('Refusing to delete');
    expect(store.get('alpha').id).toBe('alpha');
  });

  it('deletes with --yes', async () => {
    const { deps, store } = makeCliHarness();
    store.create(ALPHA);
    const result = await runCli(['profile', 'delete', 'alpha', '--yes'], deps);
    expect(result.exitCode).toBe(0);
    expect(result.text).toContain('Deleted profile alpha');

    // A fresh harness keeps the JSON path independent of the human call above.
    const second = makeCliHarness();
    second.store.create(ALPHA);
    const json = await runCli(['--json', 'profile', 'delete', 'alpha', '--yes'], second.deps);
    expect((envelopeOf(json.text).data as { id: string }).id).toBe('alpha');
  });

  it('imports JSON/YAML by extension and renames on collision', async () => {
    const { deps, fs, store } = makeCliHarness();
    store.create(ALPHA);
    fs.writeFileUtf8('/input/new.json', profileJson(validProfile('fresh')));
    const ok = await runCli(['profile', 'import', '/input/new.json'], deps);
    expect(ok.exitCode).toBe(0);
    expect(ok.text).toContain('Imported profile fresh');

    fs.writeFileUtf8('/input/collision.json', profileJson(validProfile('alpha')));
    const renamed = await runCli(['profile', 'import', '/input/collision.json', '--allow-rename'], deps);
    expect(renamed.exitCode).toBe(0);
    expect(renamed.text).toContain('alpha-copy');
    expect(store.get('alpha-copy').id).toBe('alpha-copy');

    fs.writeFileUtf8('/input/dup.json', profileJson(validProfile('alpha')));
    const refused = await runCli(['profile', 'import', '/input/dup.json'], deps);
    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain('already exists');
  });

  it('rejects unsupported import extensions', async () => {
    const { deps, fs } = makeCliHarness();
    fs.writeFileUtf8('/input/p.txt', '{}');
    const result = await runCli(['profile', 'import', '/input/p.txt'], deps);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain('Unsupported import file extension');
  });

  it('exports a literal sanitized document, unaffected by --json', async () => {
    const { deps, store } = makeCliHarness();
    store.create(withSecret('sec'));
    const human = await runCli(['profile', 'export', 'sec'], deps);
    expect(human.exitCode).toBe(0);
    const doc = JSON.parse(human.text) as { apiKey: unknown };
    expect(doc.apiKey).toBeNull();

    const json = await runCli(['--json', 'profile', 'export', 'sec'], deps);
    expect(envelopeOf(json.text).ok).toBeUndefined(); // literal, not an envelope
    const jsonDoc = JSON.parse(json.text) as { id: string };
    expect(jsonDoc.id).toBe('sec');
  });

  it('exports YAML and writes files with -o', async () => {
    const { deps, fs, store } = makeCliHarness();
    store.create(ALPHA);
    const yaml = await runCli(['profile', 'export', 'alpha', '--format', 'yaml'], deps);
    expect(yaml.text).toContain('schemaVersion: 2');

    const written = await runCli(['profile', 'export', 'alpha', '-o', '/out/alpha.json'], deps);
    expect(written.exitCode).toBe(0);
    expect(written.text).toContain('Exported json to /out/alpha.json');
    expect(JSON.parse(fs.readFileUtf8('/out/alpha.json')).id).toBe('alpha');

    const json = await runCli(['--json', 'profile', 'export', 'alpha', '-o', '/out/alpha2.json'], deps);
    expect((envelopeOf(json.text).data as { path: string; format: string }).path).toBe('/out/alpha2.json');
  });

  it('fails to export a missing profile', async () => {
    const { deps } = makeCliHarness();
    const result = await runCli(['profile', 'export', 'nope'], deps);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain('Profile not found');
  });
});