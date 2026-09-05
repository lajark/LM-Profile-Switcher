import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = resolve(import.meta.dirname, '..');

describe('distribution policy', () => {
  it('records the conservative visibility defaults in policy and machine-readable spec', () => {
    const policy = readFileSync(
      resolve(workspaceRoot, 'PROJECT_DISTRIBUTION_POLICY.md'),
      'utf8',
    );
    const projectSpec = JSON.parse(
      readFileSync(resolve(workspaceRoot, 'project-spec.json'), 'utf8'),
    ) as {
      distributionPolicy: {
        file: string;
        repositoryVisibility: string;
        releaseVisibility: string;
        workspaceDir: string;
        releaseDir: string;
        firstRemotePushRequiresPolicyScan: boolean;
      };
    };

    expect(policy).toContain('repository_visibility: "local-only"');
    expect(policy).toContain('release_visibility: "none"');
    expect(projectSpec.distributionPolicy).toEqual({
      file: 'PROJECT_DISTRIBUTION_POLICY.md',
      repositoryVisibility: 'local-only',
      releaseVisibility: 'none',
      workspaceDir: '.workspace/',
      releaseDir: 'artifacts/releases/',
      firstRemotePushRequiresPolicyScan: true,
    });
  });

  it('keeps local workspace, reports, and release staging out of Git by default', () => {
    const ignoredPaths = new Set(
      readFileSync(resolve(workspaceRoot, '.gitignore'), 'utf8')
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#')),
    );

    expect(ignoredPaths.has('.workspace/')).toBe(true);
    expect(ignoredPaths.has('reports/')).toBe(true);
    expect(ignoredPaths.has('artifacts/')).toBe(true);
  });
});
