import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = resolve(import.meta.dirname, '..');

describe('repository bootstrap', () => {
  it('keeps the planned application and package boundaries present', () => {
    const boundaries = [
      'apps/cli',
      'apps/core-service',
      'apps/desktop',
      'packages/benchmark',
      'packages/core',
      'packages/domain',
      'packages/hardware',
      'packages/i18n',
      'packages/lmstudio-adapter',
      'packages/logging',
      'packages/optimizer',
      'packages/profile-store',
    ];

    for (const boundary of boundaries) {
      expect(existsSync(resolve(workspaceRoot, boundary, 'package.json'))).toBe(true);
    }
  });

  it('declares a Node.js 20-compatible workspace and exact package manager', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(workspaceRoot, 'package.json'), 'utf8'),
    ) as { engines: { node: string }; packageManager: string };

    expect(packageJson.engines.node).toBe('>=20');
    expect(packageJson.packageManager).toBe('pnpm@10.15.0');
  });
});
