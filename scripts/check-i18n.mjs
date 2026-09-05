// i18n CI gate: locale key parity, generated-key freshness, and a hard-coded string scan
// over user-visible sources (default: apps/*/src/**/*.ts).
// Run via `corepack pnpm run i18n:check`; wired into the root `check` and CI.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  DEFAULT_LOCALE,
  RESOURCE_FILE,
  SUPPORTED_LOCALES,
  computeLocalesDigest,
  readLocaleResource,
} from './lib/i18n-locales.mjs';

const GENERATED_PATH = 'packages/i18n/src/resources.generated.ts';
const TARGET_COMPONENTS = ['apps'];
const CONSOLE_METHODS = new Set(['log', 'info', 'warn', 'error']);
const CJK_RE = /[㐀-䶿一-鿿豈-﫿぀-ヿ가-힯]/;

function findTypescriptFiles(directory, output = []) {
  if (!existsSync(directory)) {
    return output;
  }
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      findTypescriptFiles(entryPath, output);
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      output.push(entryPath);
    }
  }
  return output;
}

function setDifference(left, right) {
  return left.filter((item) => !right.has(item));
}

/** Compares every locale file against the shared key set and non-string values. */
export function checkLocaleParity(workspaceRoot) {
  const issues = [];
  const keySets = new Map();
  const firstName = [];
  try {
    for (const locale of SUPPORTED_LOCALES) {
      const resource = readLocaleResource(workspaceRoot, locale);
      keySets.set(locale, new Set(Object.keys(resource)));
      firstName.push(locale);
    }
  } catch (error) {
    return [error.message];
  }

  const referenceLocale = firstName[0];
  const referenceKeys = keySets.get(referenceLocale);
  for (const locale of SUPPORTED_LOCALES) {
    const keys = keySets.get(locale);
    if (!keys || !referenceKeys) {
      continue;
    }
    const missing = setDifference([...referenceKeys], keys);
    const extra = setDifference([...keys], referenceKeys);
    if (missing.length > 0) {
      issues.push(
        `${locale}/${RESOURCE_FILE}.json is missing keys compared with ${referenceLocale}: ${missing.join(', ')}`,
      );
    }
    if (extra.length > 0) {
      issues.push(
        `${locale}/${RESOURCE_FILE}.json has keys absent from ${referenceLocale}: ${extra.join(', ')}`,
      );
    }
  }
  return issues;
}

/** Verifies the generated resource-key file matches the current locale resources. */
export function checkGeneratedKeys(workspaceRoot) {
  const target = resolve(workspaceRoot, GENERATED_PATH);
  if (!existsSync(target)) {
    return [
      `missing generated resource keys file (${relative(workspaceRoot, target)}); run corepack pnpm run i18n:generate`,
    ];
  }
  const content = readFileSync(target, 'utf8');
  const expected = computeLocalesDigest(workspaceRoot);
  const match = content.match(/__CHECKSUM__:\s*([0-9a-f]+)/);
  if (!match || match[1] !== expected) {
    return [
      `generated resource keys are out of date; run corepack pnpm run i18n:generate (expected checksum ${expected.slice(0, 12)}…)`,
    ];
  }
  return [];
}

function isIgnoredLine(lineText, previousLine) {
  return /i18n-ignore/.test(lineText) || (previousLine !== undefined && /^\s*\/\/\s*i18n-ignore/.test(previousLine));
}

function isModuleSpecifier(node) {
  const parent = node.parent;
  return (
    Boolean(parent) &&
    parent.kind === ts.SyntaxKind.ImportDeclaration &&
    parent.moduleSpecifier === node
  );
}

function isRequireArgument(node) {
  const parent = node.parent;
  return (
    Boolean(parent) &&
    parent.kind === ts.SyntaxKind.CallExpression &&
    parent.expression.kind === ts.SyntaxKind.Identifier &&
    parent.expression.text === 'require' &&
    parent.arguments[0] === node
  );
}

function isConsoleUserVisibleArgument(node) {
  let current = node.parent;
  while (current) {
    if (ts.isParenthesizedExpression(current) || ts.isTemplateSpan(current) || ts.isAsExpression(current)) {
      current = current.parent;
      continue;
    }
    if (ts.isCallExpression(current)) {
      const callee = current.expression;
      return (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === 'console' &&
        CONSOLE_METHODS.has(callee.name.text) &&
        current.arguments[0] === node
      );
    }
    return false;
  }
  return false;
}

function isSentence(value) {
  return /\s/.test(value);
}

function scanNode(node, lines, fileIssues, relativePath) {
  const lineAt = (n) => n.getSourceFile().getLineAndCharacterOfPosition(n.getStart()).line;

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    const value = node.text;
    const line = lineAt(node);
    if (value.length === 0 || isIgnoredLine(lines[line] ?? '', lines[line - 1])) {
      return;
    }
    if (isModuleSpecifier(node) || isRequireArgument(node)) {
      return;
    }
    if (CJK_RE.test(value)) {
      fileIssues.push(`${relativePath}:${line + 1}: CJK-hardcoded-string "${preview(value)}"`);
    } else if (isConsoleUserVisibleArgument(node) && isSentence(value)) {
      fileIssues.push(
        `${relativePath}:${line + 1}: user-visible-hardcoded-string "${preview(value)}"`,
      );
    }
    return;
  }

  if (ts.isTemplateExpression(node)) {
    const line = lineAt(node);
    const text = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join('');
    if (text.length > 0 && !isIgnoredLine(lines[line] ?? '', lines[line - 1]) && CJK_RE.test(text)) {
      fileIssues.push(`${relativePath}:${line + 1}: CJK-hardcoded-string "${preview(text)}"`);
    }
  }
}

function preview(value) {
  const trimmed = value.trim();
  return trimmed.length > 24 ? `${trimmed.slice(0, 24)}…` : trimmed;
}

/** Resolves each component's `src` root directory (apps/<name>/src, e.g. apps/cli/src). */
function findComponentSourceRoots(workspaceRoot, componentDirectories) {
  const roots = [];
  for (const component of componentDirectories) {
    const componentRoot = resolve(workspaceRoot, component);
    if (!existsSync(componentRoot)) {
      continue;
    }
    for (const entry of readdirSync(componentRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        roots.push(join(componentRoot, entry.name, 'src'));
      }
    }
  }
  return roots;
}

/** Scans target component sources for hard-coded user-visible strings. */
export function checkHardcodedStrings(workspaceRoot, targetComponents = TARGET_COMPONENTS) {
  const issues = [];
  for (const sourceRoot of findComponentSourceRoots(workspaceRoot, targetComponents)) {
    for (const filePath of findTypescriptFiles(sourceRoot)) {
      const source = readFileSync(filePath, 'utf8');
      const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const lines = source.split(/\r?\n/);
      const fileIssues = [];
      const visit = (node) => {
        scanNode(node, lines, fileIssues, relative(workspaceRoot, filePath));
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
      issues.push(...fileIssues);
    }
  }
  return issues;
}

export function collectI18nIssues(workspaceRoot) {
  return [
    ...checkLocaleParity(workspaceRoot),
    ...checkGeneratedKeys(workspaceRoot),
    ...checkHardcodedStrings(workspaceRoot),
  ];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const workspaceRoot = resolve(import.meta.dirname, '..');
  const issues = collectI18nIssues(workspaceRoot);
  if (issues.length > 0) {
    console.error('i18n gate failed:');
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exitCode = 1;
  } else {
    console.log(
      `i18n gate passed (${SUPPORTED_LOCALES.join(', ')}, fallback ${DEFAULT_LOCALE}, ${TARGET_COMPONENTS.join(', ')} sources scanned).`,
    );
  }
}