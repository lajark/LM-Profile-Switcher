import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES, loadResourceFiles, resourceKeys } from '@lmps/i18n';

const workspaceRoot = resolve(import.meta.dirname, '..', '..');

function writeLocaleFixture(root: string, locale: string, record: Record<string, string>) {
  const directory = join(root, 'locales', locale);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'common.json'), JSON.stringify(record), 'utf8');
}

function validRecord(): Record<string, string> {
  return Object.fromEntries(resourceKeys.map((key) => [key, `value:${key}`]));
}

let temporaryRoot: string | undefined;

afterEach(() => {
  if (temporaryRoot) {
    rmSync(temporaryRoot, { recursive: true, force: true });
    temporaryRoot = undefined;
  }
});

function makeTemporaryRoot() {
  temporaryRoot = mkdtempSync(join(tmpdir(), 'lmps-locales-'));
  return temporaryRoot;
}

describe('locale resource loading', () => {
  it('loads every supported locale from the repository resource files', () => {
    const resources = loadResourceFiles(workspaceRoot);

    expect(Object.keys(resources).sort()).toEqual([...SUPPORTED_LOCALES].sort());
    for (const locale of SUPPORTED_LOCALES) {
      const common = resources[locale]?.common ?? {};
      expect(Object.keys(common).sort()).toEqual([...resourceKeys].sort());
      expect(Object.values(common).every((value) => typeof value === 'string')).toBe(true);
    }
  });

  it('throws when a required locale file is missing', () => {
    const root = makeTemporaryRoot();
    writeLocaleFixture(root, 'en', validRecord());

    expect(() => loadResourceFiles(root)).toThrow(/missing locale file/);
  });

  it('throws when a locale file is not valid JSON', () => {
    const root = makeTemporaryRoot();
    const directory = join(root, 'locales', 'zh-CN');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'common.json'), '{not json', 'utf8');
    writeLocaleFixture(root, 'en', validRecord());

    expect(() => loadResourceFiles(root)).toThrow(/not valid JSON/);
  });

  it('throws when a locale file has missing or extra keys', () => {
    const root = makeTemporaryRoot();
    const partial = validRecord();
    delete partial[resourceKeys[0]!];
    writeLocaleFixture(root, 'zh-CN', partial);
    writeLocaleFixture(root, 'en', { ...validRecord(), 'extra.key': 'x' });

    expect(() => loadResourceFiles(root)).toThrow();
  });

  it('throws when a locale value is not a string', () => {
    const root = makeTemporaryRoot();
    const directory = join(root, 'locales', 'zh-CN');
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, 'common.json'),
      JSON.stringify({ ...validRecord(), 'app.name': 42 }),
      'utf8',
    );
    writeLocaleFixture(root, 'en', validRecord());

    expect(() => loadResourceFiles(root)).toThrow(/value/i);
  });

  it('keeps the resource file as machine-parseable JSON (no localization of keys)', () => {
    const resources = loadResourceFiles(workspaceRoot);
    for (const locale of SUPPORTED_LOCALES) {
      const common = resources[locale]?.common ?? {};
      for (const key of resourceKeys) {
        // key 本身是机器标识，不被本地化；只有值为本地化文本
        expect(common[key]).toBeTypeOf('string');
      }
    }
    expect(existsSync(join(workspaceRoot, 'locales'))).toBe(true);
  });
});