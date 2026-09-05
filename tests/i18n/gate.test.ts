import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkGeneratedKeys,
  checkHardcodedStrings,
  checkLocaleParity,
  collectI18nIssues,
} from '../../scripts/check-i18n.mjs';

const workspaceRoot = resolve(import.meta.dirname, '..', '..');

let temporaryRoot: string | undefined;

afterEach(() => {
  if (temporaryRoot) {
    rmSync(temporaryRoot, { recursive: true, force: true });
    temporaryRoot = undefined;
  }
});

function makeTemporaryRoot() {
  temporaryRoot = mkdtempSync(join(tmpdir(), 'lmps-i18n-gate-'));
  return temporaryRoot;
}

function writeFile(filePath: string, content: string) {
  mkdirSync(resolve(filePath, '..'), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}

const zhResource = (extra: Record<string, string>) =>
  JSON.stringify(
    { 'app.name': 'LM Profile Switcher', 'common.cancel': '取消', ...extra },
    undefined,
    2,
  );
const enResource = (extra: Record<string, string>) =>
  JSON.stringify(
    { 'app.name': 'LM Profile Switcher', 'common.cancel': 'Cancel', ...extra },
    undefined,
    2,
  );

describe('repository i18n gate', () => {
  it('passes for the committed locales and generated keys', () => {
    expect(collectI18nIssues(workspaceRoot)).toEqual([]);
  });

  it('reports missing keys from one locale', () => {
    const root = makeTemporaryRoot();
    writeFile(join(root, 'locales/zh-CN/common.json'), zhResource({}));
    writeFile(join(root, 'locales/en/common.json'), enResource({ 'extra.en': 'x' }));

    const issues = checkLocaleParity(root);
    expect(issues).toContainEqual(expect.stringContaining('extra.en'));
  });

  it('reports extra keys in another locale', () => {
    const root = makeTemporaryRoot();
    writeFile(join(root, 'locales/zh-CN/common.json'), zhResource({ 'extra.zh': 'x' }));
    writeFile(join(root, 'locales/en/common.json'), enResource({}));

    const issues = checkLocaleParity(root);
    expect(issues).toContainEqual(expect.stringContaining('extra.zh'));
  });

  it('reports non-string resource values', () => {
    const root = makeTemporaryRoot();
    const invalid = JSON.stringify({
      'app.name': 'LM Profile Switcher',
      'common.cancel': 42,
    });
    writeFile(join(root, 'locales/zh-CN/common.json'), invalid);
    writeFile(join(root, 'locales/en/common.json'), enResource({}));

    const issues = checkLocaleParity(root);
    expect(issues).toContainEqual(expect.stringContaining('string'));
  });

  it('fails when the generated resource keys are out of date', () => {
    const root = makeTemporaryRoot();
    const issues = checkGeneratedKeys(root);
    expect(issues.length).toBeGreaterThan(0);
  });
});

describe('hard-coded string scan', () => {
  const fixtureSource = [
    "console.log('你好，世界');",
    "console.log('User profile saved');",
    "console.log('ok-token');",
    "const message = '已激活配置';",
    "doSomething('model-name');",
    'const lng = "en";',
    "args.includes('--json');",
    "console.log('consoles-cjk-这里也报');",
    "console.log('ignored-by-comment'); // i18n-ignore",
    '// i18n-ignore',
    "console.log('ignored-by-previous-line');",
    "const tpl = `多行${variable}`;",
  ].join('\n');

  it('flags Chinese literals and user-visible console sentences', () => {
    const root = makeTemporaryRoot();
    writeFile(join(root, 'apps/cli/src/hello.ts'), fixtureSource);

    const issues = checkHardcodedStrings(root);

    expect(issues).toContainEqual(expect.stringContaining('你好，世界'));
    expect(issues).toContainEqual(expect.stringContaining('User profile saved'));
    expect(issues).toContainEqual(expect.stringContaining('已激活配置'));
    expect(issues).toContainEqual(expect.stringContaining('consoles-cjk-这里也报'));
    expect(issues).toContainEqual(expect.stringContaining('多行'));
  });

  it('does not flag machine values, single tokens, or ignored lines', () => {
    const root = makeTemporaryRoot();
    writeFile(join(root, 'apps/cli/src/hello.ts'), fixtureSource);

    const issues = checkHardcodedStrings(root);
    const all = issues.join('\n');

    expect(all).not.toContain('ok-token');
    expect(all).not.toContain('model-name');
    expect(all).not.toContain('"en"');
    expect(all).not.toContain('--json');
    expect(all).not.toContain('ignored-by-comment');
    expect(all).not.toContain('ignored-by-previous-line');
  });
});